// Phase 15: read the text currently selected in the foreground window via
// UI Automation's TextPattern. This runs while the target app still holds
// focus (before the overlay calls show/set_focus), so `GetFocusedElement`
// refers to the user's input control.
//
// This is the *non-intrusive* channel: it never touches the clipboard and
// never synthesises keystrokes. It only succeeds when the focused control
// exposes a TextPattern — Electron apps (QQNT / Feishu) do so once their
// Chromium accessibility tree is up; native WeChat's custom-rendered input
// usually does not, in which case the caller falls back to the Ctrl+C
// clipboard snapshot (selection_capture.rs).

use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationTextPattern, UIA_TextPatternId,
};

/// Read the current selection of the focused element via UIA TextPattern.
/// Returns `None` on any failure — that is the normal case for apps whose
/// accessibility tree is not exposed, and the caller should degrade to the
/// Ctrl+C fallback rather than treat it as an error.
pub fn read_selection_uia() -> Option<String> {
    // Initialize COM once per call. RPC_E_CHANGED_MODE means another
    // apartment already initialized this thread — ignore and continue.
    let com_state = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    let initialized = com_state.is_ok();
    let result = read_selection_uia_inner();
    if initialized {
        unsafe { CoUninitialize() };
    }
    result
}

fn read_selection_uia_inner() -> Option<String> {
    let automation: IUIAutomation =
        unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_ALL) }.ok()?;

    let focused = unsafe { automation.GetFocusedElement() }.ok()?;

    let pattern: IUIAutomationTextPattern =
        unsafe { focused.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId) }
            .ok()?;

    let ranges = unsafe { pattern.GetSelection() }.ok()?;

    let length = unsafe { ranges.Length() }.ok()?;
    if length == 0 {
        return None;
    }

    let mut parts: Vec<String> = Vec::new();
    for index in 0..length {
        let range = match unsafe { ranges.GetElement(index) } {
            Ok(range) => range,
            Err(err) => {
                log::debug!("[selection] GetElement({index}) failed: {err}");
                continue;
            }
        };
        // -1 = no length limit, per the UIA TextRange::GetText contract.
        match unsafe { range.GetText(-1) } {
            Ok(text) => parts.push(text.to_string()),
            Err(err) => {
                log::debug!("[selection] GetText({index}) failed: {err}");
            }
        }
    }

    let joined = parts.join(" ");
    if joined.trim().is_empty() {
        return None;
    }
    Some(joined)
}
