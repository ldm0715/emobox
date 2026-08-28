// Phase 7: in-memory record of the window that was foreground when the user
// triggered the quick-search overlay. Lifecycle:
//
//   show_quick_search   -> capture_from_foreground clears, then writes
//   copySelectedImage   -> paste_to_target_window peeks (does NOT consume on success)
//   paste fails         -> state cleared by the command
//   hide_quick_search   -> state cleared
//   TTL exceeded        -> peek/take return None
//
// The record is never persisted. We deliberately do NOT keep the target
// across floating-window sessions to avoid cross-session mis-paste.

use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// How long a captured target remains valid. After this TTL the entry is
/// treated as expired and `peek`/`take` return `None`.
pub const TARGET_TTL: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TargetWindowInfo {
    pub hwnd: isize,
    pub pid: u32,
    pub title: String,
    pub process_name: String,
    /// Unix epoch milliseconds when the foreground was captured.
    pub captured_at_ms: i64,
}

impl TargetWindowInfo {
    pub fn is_expired(&self, now_ms: i64) -> bool {
        now_ms.saturating_sub(self.captured_at_ms) > TARGET_TTL.as_millis() as i64
    }
}

#[derive(Default)]
pub struct TargetWindowState {
    inner: Mutex<Option<TargetWindowInfo>>,
}

impl TargetWindowState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Replace the current record unconditionally. Use this for capture.
    pub fn set(&self, info: Option<TargetWindowInfo>) {
        if let Ok(mut guard) = self.inner.lock() {
            *guard = info;
        }
    }

    /// Read the current record without removing it, returning `None` for
    /// "never set", "already cleared", or "TTL exceeded". This is the
    /// primary read path for the paste command — keeping the target lets
    /// the same session reuse it across multiple selections.
    pub fn peek(&self) -> Option<TargetWindowInfo> {
        let guard = self.inner.lock().ok()?;
        let info = guard.as_ref()?.clone();
        if info.is_expired(now_ms()) {
            return None;
        }
        Some(info)
    }

    /// Read the current record and clear it in the same step. Used when
    /// the floating window hides (end of session) and when paste validation
    /// fails (so the next selection does not retry the same dead target).
    #[allow(dead_code)] // exposed for tests + future callers
    pub fn take(&self) -> Option<TargetWindowInfo> {
        let mut guard = self.inner.lock().ok()?;
        let info = guard.take()?;
        if info.is_expired(now_ms()) {
            return None;
        }
        Some(info)
    }

    /// Force-clear. Used defensively when a new capture is about to begin.
    pub fn clear(&self) {
        if let Ok(mut guard) = self.inner.lock() {
            *guard = None;
        }
    }

    /// Returns `true` when no valid (non-expired) record is held.
    #[allow(dead_code)] // used in tests
    pub fn is_empty(&self) -> bool {
        self.peek().is_none()
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

/// Capture the current foreground window into the managed
/// `TargetWindowState`. This is invoked by `quick_search::show_quick_search`
/// every time the overlay is about to be shown. The contract:
///
/// - **Always start by clearing** any stale record from a previous session.
/// - **Exclude EmoBox's own windows** so the user never pastes into
///   EmoBox itself.
/// - **Reject system processes** (desktop, DWM, logon) which the user
///   can never meaningfully paste into.
/// - **On any capture failure** (no foreground, API error, filtered out)
///   leave the state empty. The paste command will then return
///   `noTarget` and the user is shown a downgrade toast.
pub fn capture_from_foreground(app: &AppHandle) {
    let state = match app.try_state::<TargetWindowState>() {
        Some(s) => s,
        None => return,
    };

    // Defensive: drop any leftover from a previous session before writing
    // the new value. This guarantees "open -> clear -> write" semantics.
    state.clear();

    #[cfg(windows)]
    let captured = capture_inner(app, &state);
    #[cfg(not(windows))]
    let captured: Option<TargetWindowInfo> = None;

    state.set(captured);
}

#[cfg(windows)]
fn capture_inner(app: &AppHandle, _state: &TargetWindowState) -> Option<TargetWindowInfo> {
    let exclude = collect_emobox_hwnds(app);
    let result = unsafe { crate::platform::windows::foreground_window::capture(&exclude) };
    match result {
        Ok(Some(c)) => {
            // Filter out system processes that the user can never paste into.
            let lower = c.process_name.to_ascii_lowercase();
            if is_system_process(&lower) {
                log::debug!("跳过系统前台窗口：{}", c.process_name);
                return None;
            }
            Some(TargetWindowInfo {
                hwnd: c.hwnd,
                pid: c.pid,
                title: c.title,
                process_name: c.process_name,
                captured_at_ms: now_ms(),
            })
        }
        Ok(None) => {
            // Either no foreground or the foreground was one of our windows.
            log::debug!("前台窗口被排除（EmoBox 自身或无效）");
            None
        }
        Err(err) => {
            log::warn!("捕获前台窗口失败：{err}");
            None
        }
    }
}

fn is_system_process(name_lower: &str) -> bool {
    // Process names that cannot meaningfully receive a Ctrl+V paste.
    matches!(
        name_lower,
        "explorer.exe"        // Windows desktop / file explorer
        | "dwm.exe"           // Desktop Window Manager
        | "winlogon.exe"
        | "csrss.exe"
        | "lsass.exe"
        | "services.exe"
        | "smss.exe"
        | "taskhostw.exe"
        | "taskmgr.exe"       // Task Manager — still useful to skip
        | "lockapp.exe" // Lock screen
    )
}

fn collect_emobox_hwnds(app: &AppHandle) -> Vec<isize> {
    let mut out = Vec::new();
    for (_, window) in app.webview_windows() {
        if let Ok(hwnd) = window.hwnd() {
            out.push(hwnd.0 as isize);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(hwnd: isize, pid: u32) -> TargetWindowInfo {
        TargetWindowInfo {
            hwnd,
            pid,
            title: "test".into(),
            process_name: "test.exe".into(),
            captured_at_ms: now_ms(),
        }
    }

    #[test]
    fn set_then_take_returns_value() {
        let state = TargetWindowState::new();
        state.set(Some(info(123, 1)));
        assert_eq!(state.take().map(|i| i.hwnd), Some(123));
        assert!(state.take().is_none());
    }

    #[test]
    fn peek_does_not_clear() {
        let state = TargetWindowState::new();
        state.set(Some(info(7, 1)));
        assert!(state.peek().is_some());
        assert!(state.peek().is_some());
    }

    #[test]
    fn set_none_clears_existing_record() {
        let state = TargetWindowState::new();
        state.set(Some(info(1, 1)));
        state.set(None);
        assert!(state.peek().is_none());
    }

    #[test]
    fn expired_record_treated_as_missing() {
        let state = TargetWindowState::new();
        let mut record = info(1, 1);
        record.captured_at_ms = now_ms() - 10 * 60 * 1000; // 10 min ago
        state.set(Some(record));
        assert!(state.take().is_none());
        assert!(state.peek().is_none());
    }

    #[test]
    fn is_expired_boundary() {
        let mut record = info(1, 1);
        record.captured_at_ms = now_ms() - (TARGET_TTL.as_millis() as i64) - 1;
        assert!(record.is_expired(now_ms()));
    }

    #[test]
    fn clear_removes_record() {
        let state = TargetWindowState::new();
        state.set(Some(info(99, 1)));
        state.clear();
        assert!(state.is_empty());
    }

    #[test]
    fn is_empty_initially_and_after_take() {
        let state = TargetWindowState::new();
        assert!(state.is_empty());
        state.set(Some(info(1, 1)));
        assert!(!state.is_empty());
        let _ = state.take();
        assert!(state.is_empty());
    }

    #[test]
    fn system_process_filter() {
        assert!(is_system_process("explorer.exe"));
        assert!(is_system_process("dwm.exe"));
        assert!(is_system_process("taskmgr.exe"));
        assert!(!is_system_process("notepad.exe"));
        assert!(!is_system_process("qq.exe"));
        assert!(!is_system_process("wechat.exe"));
    }

    #[test]
    fn same_session_reuse_via_peek() {
        // Simulate the same floating-window session: capture, peek
        // (paste attempt), peek again (second paste), then close (clear).
        let state = TargetWindowState::new();
        state.set(Some(info(1, 100)));
        // First selection
        let first = state.peek();
        assert!(first.is_some());
        // Second selection — peek should still return the same target.
        let second = state.peek();
        assert_eq!(first, second);
        // Third selection
        let third = state.peek();
        assert_eq!(first, third);
        // Session ends — clear.
        state.clear();
        assert!(state.peek().is_none());
    }

    #[test]
    fn capture_failure_leaves_state_empty() {
        // Simulate capture_inner returning None by directly writing None.
        let state = TargetWindowState::new();
        // Pretend a previous session left a record; the new capture clears
        // it first, then writes None.
        state.set(Some(info(99, 100)));
        state.clear();
        state.set(None);
        assert!(state.is_empty());
    }
}
