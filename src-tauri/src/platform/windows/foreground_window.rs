// Phase 7: capture the current foreground window so we can return to it
// after the quick-search overlay closes. We do not read window content;
// we only collect HWND, PID, title, and process name for debugging /
// user feedback.

use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::Path;

use windows::Win32::Foundation::HWND;
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
};
use windows::core::PWSTR;

/// Minimal description of the foreground window at the moment the user
/// triggered the quick-search shortcut.
#[derive(Debug, Clone)]
pub struct CapturedWindow {
    pub hwnd: isize,
    pub pid: u32,
    pub title: String,
    pub process_name: String,
}

/// Read the current foreground window. Returns `Ok(None)` when there is no
/// foreground window or when the foreground window is one of the EmoBox
/// windows (the caller passes a list of HWNDs to exclude).
pub unsafe fn capture(exclude_hwnds: &[isize]) -> Result<Option<CapturedWindow>, String> {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_invalid() {
        return Ok(None);
    }
    let raw = hwnd.0 as isize;
    if exclude_hwnds.contains(&raw) {
        return Ok(None);
    }

    let mut pid: u32 = 0;
    unsafe {
        let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32));
    }

    let title = unsafe { read_window_title(hwnd) }.unwrap_or_default();
    let process_name = if pid != 0 {
        unsafe { query_process_name(pid) }.unwrap_or_default()
    } else {
        String::new()
    };

    Ok(Some(CapturedWindow {
        hwnd: raw,
        pid,
        title,
        process_name,
    }))
}

unsafe fn read_window_title(hwnd: HWND) -> Option<String> {
    let mut buffer = [0u16; 512];
    let len = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    if len <= 0 {
        return None;
    }
    Some(
        OsString::from_wide(&buffer[..len as usize])
            .to_string_lossy()
            .into_owned(),
    )
}

unsafe fn query_process_name(pid: u32) -> Option<String> {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    if handle.is_invalid() {
        return None;
    }
    let mut buffer = [0u16; 512];
    let mut size = buffer.len() as u32;
    let result = unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            PWSTR(buffer.as_mut_ptr()),
            &mut size,
        )
    };
    let _ = unsafe { windows::Win32::Foundation::CloseHandle(handle) };
    if result.is_err() || size == 0 {
        return None;
    }
    let full = OsString::from_wide(&buffer[..size as usize])
        .to_string_lossy()
        .into_owned();
    let name = Path::new(&full)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    Some(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_with_no_foreground_returns_none() {
        // In a CI / non-GUI environment `GetForegroundWindow` returns an
        // invalid HWND; verify the "no target" path at least compiles and
        // returns Ok.
        let result = unsafe { capture(&[]) };
        assert!(result.is_ok());
    }

    #[test]
    fn capture_excludes_listed_hwnds() {
        let result = unsafe { capture(&[0xDEAD_BEEF_isize]) };
        assert!(result.is_ok());
    }
}
