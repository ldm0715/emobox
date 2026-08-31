// Phase 7: after the target window is brought to the foreground, hand
// keyboard focus back to its input control. Windows does not restore the
// *control-level* focus when a window is re-activated — it only restores the
// top-level window. Without this step, a synthesized Ctrl+V lands on whatever
// control happens to hold focus (often the chat list / sidebar), and the
// paste silently does nothing.
//
// Strategy (all user32 / UIA, no IM-specific code):
//   1. UI Automation: find the first Edit control under the target window,
//      then simulate a real left-click at its center. A real click is the
//      only thing guaranteed to hand focus to the control.
//   2. Fallback: EnumChildWindows looking for classic `Edit` / `RichEdit*`
//      class names, then click its center.
//   3. If neither finds an input control, return NotFound — the caller still
//      sends Ctrl+V (existing behavior) in case focus was already correct.

use std::time::Duration;

use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElementArray, TreeScope_Subtree,
    UIA_EditControlTypeId,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, GetClassNameW, GetWindowRect, IsWindow,
};
use windows::core::BOOL;

use super::input_simulation;

/// Result of attempting to hand focus to an input control.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusRestoreResult {
    /// An input control was found and clicked.
    Clicked,
    /// No Edit control could be located under the target window.
    NotFound,
    /// UIA or COM failed (e.g. target window vanished mid-call).
    Error,
}

pub fn restore_input_focus(target_hwnd: isize) -> FocusRestoreResult {
    if target_hwnd == 0 {
        return FocusRestoreResult::NotFound;
    }
    let hwnd = HWND(target_hwnd as *mut _);
    if unsafe { IsWindow(Some(hwnd)) }.0 == 0 {
        return FocusRestoreResult::Error;
    }

    // 1. UIA path.
    match uia_click_edit_center(hwnd) {
        FocusRestoreResult::Clicked => {
            log::info!("[auto-paste] focus restored by UIA click");
            return FocusRestoreResult::Clicked;
        }
        FocusRestoreResult::Error => {
            log::debug!("[auto-paste] UIA click failed; falling back to child-window scan");
        }
        FocusRestoreResult::NotFound => {
            log::debug!("[auto-paste] UIA found no Edit control; trying child-window scan");
        }
    }

    // 2. Fallback: classic Edit / RichEdit* child windows.
    if let Some((cx, cy)) = child_edit_center(hwnd) {
        let sent = unsafe { input_simulation::click_at(cx, cy) };
        if sent > 0 {
            log::info!("[auto-paste] focus restored by child-window click");
            return FocusRestoreResult::Clicked;
        }
        return FocusRestoreResult::Error;
    }

    log::debug!("[auto-paste] no input control found; sending Ctrl+V anyway");
    FocusRestoreResult::NotFound
}

/// Use UI Automation to locate the first Edit control under `hwnd` and click
/// its center. Returns NotFound when UIA finds nothing (normal for apps whose
/// accessibility tree is not exposed).
fn uia_click_edit_center(hwnd: HWND) -> FocusRestoreResult {
    // Initialize COM once per call. RPC_E_CHANGED_MODE means another
    // apartment already initialized this thread — ignore and continue.
    let com_state = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    let initialized = com_state.is_ok();
    let result = uia_click_edit_center_inner(hwnd);
    if initialized {
        unsafe { CoUninitialize() };
    }
    result
}

fn uia_click_edit_center_inner(hwnd: HWND) -> FocusRestoreResult {
    let automation: IUIAutomation =
        match unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_ALL) } {
            Ok(automation) => automation,
            Err(err) => {
                log::debug!("[auto-paste] CoCreateInstance(CUIAutomation) failed: {err}");
                return FocusRestoreResult::Error;
            }
        };

    let root = match unsafe { automation.ElementFromHandle(hwnd) } {
        Ok(root) => root,
        Err(err) => {
            log::debug!("[auto-paste] ElementFromHandle failed: {err}");
            return FocusRestoreResult::Error;
        }
    };

    // 不用 CreatePropertyCondition（需要构造 VARIANT union，edition 2024 下
    // 撞 E0133）：CreateTrueCondition 匹配全部元素，再逐个比对 ControlType。
    let condition = match unsafe { automation.CreateTrueCondition() } {
        Ok(condition) => condition,
        Err(err) => {
            log::debug!("[auto-paste] CreateTrueCondition failed: {err}");
            return FocusRestoreResult::Error;
        }
    };

    let elements: IUIAutomationElementArray =
        match unsafe { root.FindAll(TreeScope_Subtree, &condition) } {
            Ok(elements) => elements,
            Err(err) => {
                log::debug!("[auto-paste] FindAll failed: {err}");
                return FocusRestoreResult::Error;
            }
        };

    let length = match unsafe { elements.Length() } {
        Ok(length) => length,
        Err(err) => {
            log::debug!("[auto-paste] element array Length failed: {err}");
            return FocusRestoreResult::Error;
        }
    };

    let mut edit = None;
    for index in 0..length {
        let element = match unsafe { elements.GetElement(index) } {
            Ok(element) => element,
            Err(err) => {
                log::debug!("[auto-paste] GetElement({index}) failed: {err}");
                continue;
            }
        };
        match unsafe { element.CurrentControlType() } {
            Ok(control_type) if control_type == UIA_EditControlTypeId => {
                edit = Some(element);
                break;
            }
            Ok(_) => continue,
            Err(err) => {
                log::debug!("[auto-paste] CurrentControlType failed: {err}");
                continue;
            }
        }
    }

    let Some(edit) = edit else {
        return FocusRestoreResult::NotFound;
    };

    let rect = match unsafe { edit.CurrentBoundingRectangle() } {
        Ok(rect) => rect,
        Err(err) => {
            log::debug!("[auto-paste] CurrentBoundingRectangle failed: {err}");
            return FocusRestoreResult::Error;
        }
    };

    // Click the center. Guard against degenerate zero-area rects.
    let width = rect.right.saturating_sub(rect.left);
    let height = rect.bottom.saturating_sub(rect.top);
    if width <= 0 || height <= 0 {
        return FocusRestoreResult::NotFound;
    }
    let cx = rect.left + width / 2;
    let cy = rect.top + height / 2;
    let sent = unsafe { input_simulation::click_at(cx, cy) };
    if sent == 0 {
        return FocusRestoreResult::Error;
    }
    // Give the target app a beat to re-focus its caret.
    std::thread::sleep(Duration::from_millis(60));
    FocusRestoreResult::Clicked
}

/// Scan the child-window tree for classic Edit / RichEdit* controls and
/// return the screen-space center of the first one found.
fn child_edit_center(parent: HWND) -> Option<(i32, i32)> {
    struct Ctx {
        found: Option<(i32, i32)>,
    }
    let mut ctx = Ctx { found: None };

    // SAFETY: callback only reads window handles supplied by the OS; `ctx`
    // lives for the duration of the enumeration.
    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = unsafe { &mut *(lparam.0 as *mut Ctx) };
        let mut class_buf = [0u16; 128];
        let len = unsafe { GetClassNameW(hwnd, &mut class_buf) };
        if len > 0 {
            let class = String::from_utf16_lossy(&class_buf[..len as usize]);
            if is_editable_class(&class) {
                let mut rect = RECT::default();
                if unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok() {
                    let width = rect.right.saturating_sub(rect.left);
                    let height = rect.bottom.saturating_sub(rect.top);
                    if width > 0 && height > 0 {
                        ctx.found = Some((rect.left + width / 2, rect.top + height / 2));
                        return BOOL(0); // stop enumerating
                    }
                }
            }
        }
        BOOL(1)
    }

    unsafe {
        let _ = EnumChildWindows(
            Some(parent),
            Some(enum_proc),
            LPARAM(&mut ctx as *mut Ctx as isize),
        );
    }
    ctx.found
}

fn is_editable_class(class: &str) -> bool {
    let lower = class.to_ascii_lowercase();
    lower == "edit" || lower.starts_with("richedit")
}
