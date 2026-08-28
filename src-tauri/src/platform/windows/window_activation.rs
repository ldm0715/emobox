// Phase 7: validate and restore the previously-foreground window. Uses
// AttachThreadInput with a Drop guard so we always detach on every path,
// including early returns and errors.

use std::time::{Duration, Instant};

use windows::Win32::Foundation::HWND;
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetForegroundWindow, GetWindowThreadProcessId, IsIconic, IsWindow,
    IsWindowVisible, SetForegroundWindow, ShowWindow, SW_RESTORE,
};

/// Maximum time we are willing to wait for the target window to actually
/// become the foreground window. Polled, not slept.
pub const MAX_FOREGROUND_WAIT: Duration = Duration::from_millis(500);

/// Re-validate a captured target against the current process / window
/// state. The PID check guards against HWND reuse: if another process
/// happened to receive the same raw handle value, we must not paste into
/// it. Visibility + IsIconic catch the "invisible window" case where
/// pasting would land in the void.
pub unsafe fn validate(hwnd_raw: isize, expected_pid: u32) -> Result<(), ActivationError> {
    let hwnd = HWND(hwnd_raw as *mut _);
    if unsafe { IsWindow(Some(hwnd)) }.0 == 0 {
        return Err(ActivationError::Closed);
    }
    if expected_pid != 0 {
        let mut actual_pid: u32 = 0;
        let _ = unsafe { GetWindowThreadProcessId(hwnd, Some(&mut actual_pid as *mut u32)) };
        if actual_pid != expected_pid {
            return Err(ActivationError::PidMismatch {
                expected: expected_pid,
                actual: actual_pid,
            });
        }
    }
    if unsafe { IsWindowVisible(hwnd) }.0 == 0 && unsafe { IsIconic(hwnd) }.0 == 0 {
        return Err(ActivationError::Invisible);
    }
    Ok(())
}

/// Restore a minimised window and bring it to the foreground. Uses the
/// `AttachThreadInput` trick so `SetForegroundWindow` is allowed by the
/// Windows foreground lock. The thread attachment is **always** undone
/// before this function returns, regardless of outcome — the `Guard` Drop
/// impl is the only place that calls the second `AttachThreadInput`.
pub unsafe fn activate(hwnd_raw: isize) -> Result<(), ActivationError> {
    let hwnd = HWND(hwnd_raw as *mut _);
    if unsafe { IsWindow(Some(hwnd)) }.0 == 0 {
        return Err(ActivationError::Closed);
    }
    if unsafe { IsIconic(hwnd) }.0 != 0 {
        let _ = unsafe { ShowWindow(hwnd, SW_RESTORE) };
    }

    let current_tid = unsafe { GetCurrentThreadId() };
    let mut target_tid: u32 = 0;
    let _ = unsafe { GetWindowThreadProcessId(hwnd, Some(&mut target_tid as *mut u32)) };

    // AttachThreadInput returns BOOL — non-zero means success. We only
    // attempt a detach if the attach actually succeeded.
    let need_attach = target_tid != 0 && target_tid != current_tid;
    let attached = if need_attach {
        unsafe { AttachThreadInput(target_tid, current_tid, true) }.0 != 0
    } else {
        false
    };

    struct AttachGuard {
        target: u32,
        current: u32,
        active: bool,
    }
    impl Drop for AttachGuard {
        fn drop(&mut self) {
            if self.active && self.target != 0 {
                unsafe {
                    let _ = AttachThreadInput(self.target, self.current, false);
                }
            }
        }
    }
    let _guard = AttachGuard {
        target: target_tid,
        current: current_tid,
        active: attached,
    };

    // Ignore the SetForegroundWindow return value — it can fail transiently
    // (e.g. when UAC prompts) but we still want the polling to confirm the
    // foreground transition.
    let _ = unsafe { SetForegroundWindow(hwnd) };
    log::info!(
        "[auto-paste] SetForegroundWindow issued, target={} current={}",
        hwnd_raw,
        unsafe { GetForegroundWindow() }.0 as isize
    );

    let deadline = Instant::now() + MAX_FOREGROUND_WAIT;
    while Instant::now() < deadline {
        if unsafe { GetForegroundWindow() }.0 as isize == hwnd_raw {
            // 给目标窗口额外的 80ms 完成焦点切换：很多 IM 在 WM_SETFOCUS
            // 之后还要做异步布局/Caret 恢复，等到下一次消息泵空闲之后
            // 再 SendInput 才不会被丢。
            std::thread::sleep(Duration::from_millis(80));
            log_focus_diagnostics(hwnd_raw);
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    log::warn!(
        "[auto-paste] failed to bring target {} to foreground; current={}",
        hwnd_raw,
        unsafe { GetForegroundWindow() }.0 as isize
    );
    Err(ActivationError::CouldNotActivate)
}

/// Log which control inside the target window currently owns the keyboard
/// focus. Because we are AttachThreadInput'd to the target thread here, the
/// focused HWND is the target's real focus control. This is the single most
/// useful line for debugging "picture didn't get pasted".
fn log_focus_diagnostics(hwnd_raw: isize) {
    use windows::Win32::UI::Input::KeyboardAndMouse::GetFocus;
    let focus = unsafe { GetFocus() };
    if focus.is_invalid() || focus.0.is_null() {
        log::warn!(
            "[auto-paste] target {} is foreground but has NO focus control — Ctrl+V will be lost",
            hwnd_raw
        );
        return;
    }
    let mut class_buf = [0u16; 128];
    let len = unsafe { GetClassNameW(focus, &mut class_buf) };
    let class_name = if len > 0 {
        String::from_utf16_lossy(&class_buf[..len as usize])
    } else {
        "<unknown>".to_string()
    };
    log::info!(
        "[auto-paste] focus control hwnd={:p} class={}",
        focus.0,
        class_name
    );
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActivationError {
    Closed,
    PidMismatch { expected: u32, actual: u32 },
    Invisible,
    CouldNotActivate,
}

impl std::fmt::Display for ActivationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ActivationError::Closed => write!(f, "目标窗口已关闭"),
            ActivationError::PidMismatch { expected, actual } => {
                write!(f, "目标窗口 PID 不匹配（期望 {expected}，实际 {actual}）")
            }
            ActivationError::Invisible => write!(f, "目标窗口不可见且未最小化"),
            ActivationError::CouldNotActivate => write!(f, "无法将目标窗口设为前台"),
        }
    }
}

impl std::error::Error for ActivationError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_invalid_hwnd_returns_closed() {
        let result = unsafe { validate(0xDEAD_BEEF_isize, 0) };
        assert_eq!(result, Err(ActivationError::Closed));
    }

    #[test]
    fn activate_invalid_hwnd_returns_closed() {
        let result = unsafe { activate(0xDEAD_BEEF_isize) };
        assert_eq!(result, Err(ActivationError::Closed));
    }

    #[test]
    fn activation_error_displays_pid_mismatch() {
        let err = ActivationError::PidMismatch {
            expected: 100,
            actual: 200,
        };
        let s = format!("{err}");
        assert!(s.contains("100"));
        assert!(s.contains("200"));
    }
}
