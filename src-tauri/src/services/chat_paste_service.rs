// Phase 7: orchestrate the "copy then auto-paste" flow.
//
// The service never panics and never returns `Err` to the Tauri layer —
// every failure mode is mapped to a `PasteResult` variant so the frontend
// can render a single toast and we keep the same `Result<T, String>`
// protocol used by the rest of the app.
//
// Lifecycle contract: this service does NOT touch the TargetWindowState.
// The command layer is responsible for `peek` (success path) and `clear`
// (failure path) so the state machine stays in one place.

use serde::Serialize;

use crate::target_window::TargetWindowInfo;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PasteKind {
    /// The shortcut sent Ctrl+V to the target window successfully.
    Success,
    /// The clipboard already has the image, but we could not auto-paste.
    ClipboardOnly,
    /// Auto-paste is not supported on this platform build.
    #[allow(dead_code)] // only constructed on non-Windows
    Disabled,
}

/// Outcome of a `paste_to_target_window` call. The frontend dispatches on
/// `kind` and shows a single toast. `processName` is included for
/// debugging / user feedback; it may be `null` if no target was ever
/// captured.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteResult {
    pub kind: PasteKind,
    pub reason: String,
    pub process_name: Option<String>,
    pub message: String,
}

impl PasteResult {
    pub fn success(process_name: &str) -> Self {
        Self {
            kind: PasteKind::Success,
            reason: "success".into(),
            process_name: Some(process_name.to_string()),
            message: format!("已发送粘贴快捷键到 {process_name}"),
        }
    }

    #[allow(dead_code)] // only called from the non-Windows Tauri command
    pub fn disabled() -> Self {
        Self {
            kind: PasteKind::Disabled,
            reason: "disabled".into(),
            process_name: None,
            message: "表情已复制到剪贴板".into(),
        }
    }

    /// Build a clipboardOnly result. The `reason` value is a short
    /// machine-readable string that the frontend can also forward to
    /// telemetry; `message` is the human-readable text shown in the toast.
    pub fn clipboard_only(reason: &str, process_name: Option<String>) -> Self {
        let message = match reason {
            "noTarget" => "表情已复制，请手动粘贴".to_string(),
            "targetClosed" => "目标窗口已关闭，表情已复制到剪贴板".to_string(),
            "pidMismatch" => "目标窗口已被系统回收或复用，表情已复制到剪贴板".to_string(),
            "activationFailed" => "无法恢复目标窗口，表情已复制到剪贴板".to_string(),
            "inputFailed" => "自动粘贴失败，表情已复制到剪贴板，请手动粘贴".to_string(),
            "invisible" => "目标窗口不可见，表情已复制到剪贴板".to_string(),
            "ipcFailed" => "自动粘贴调用失败，表情已复制到剪贴板".to_string(),
            "hideFailed" => "表情已复制，请手动粘贴".to_string(),
            other => format!("自动粘贴未执行（{other}），表情已复制到剪贴板"),
        };
        Self {
            kind: PasteKind::ClipboardOnly,
            reason: reason.to_string(),
            process_name,
            message,
        }
    }
}

pub struct ChatPasteService;

impl ChatPasteService {
    /// Non-Windows stub — never sends input.
    #[cfg(not(windows))]
    pub fn paste(_target: TargetWindowInfo) -> PasteResult {
        PasteResult::disabled()
    }

    /// Validate, restore + activate, then send Ctrl+V. The target is
    /// borrowed; the caller decides whether to consume it.
    #[cfg(windows)]
    pub fn paste(target: &TargetWindowInfo) -> PasteResult {
        use crate::platform::windows::focus_restore;
        use crate::platform::windows::input_simulation;
        use crate::platform::windows::window_activation::{self, ActivationError};

        // 1. Validate — re-checks PID and visibility on every call.
        if let Err(err) = unsafe { window_activation::validate(target.hwnd, target.pid) } {
            let reason = match err {
                ActivationError::Closed => "targetClosed",
                ActivationError::PidMismatch { .. } => "pidMismatch",
                ActivationError::Invisible => "invisible",
                ActivationError::CouldNotActivate => "activationFailed",
            };
            return PasteResult::clipboard_only(reason, Some(target.process_name.clone()));
        }

        // 2. Restore + activate.
        if let Err(err) = unsafe { window_activation::activate(target.hwnd) } {
            let reason = match err {
                ActivationError::Closed => "targetClosed",
                ActivationError::PidMismatch { .. } => "pidMismatch",
                ActivationError::Invisible => "invisible",
                ActivationError::CouldNotActivate => "activationFailed",
            };
            log::warn!("激活目标窗口失败：{err}");
            return PasteResult::clipboard_only(reason, Some(target.process_name.clone()));
        }

        // 3. Hand focus back to the target's input control. Windows restores
        //    only the top-level window on re-activation; without this the
        //    Ctrl+V lands on the wrong control. Failure here is NOT fatal —
        //    we still send Ctrl+V (it may work if focus was already correct).
        let focus_result = focus_restore::restore_input_focus(target.hwnd);
        if focus_result != focus_restore::FocusRestoreResult::Clicked {
            log::debug!("[auto-paste] focus restore result: {focus_result:?}");
        }

        // 4. Send Ctrl+V. SendInput returns the number of events the OS
        //    accepted; a return of 0 means the input was rejected.
        let sent = unsafe { input_simulation::send_ctrl_v() };
        if sent == 0 {
            log::warn!("SendInput 失败，未发送任何键盘事件");
            return PasteResult::clipboard_only("inputFailed", Some(target.process_name.clone()));
        }
        // We deliberately do NOT check that the target app actually
        // received the paste — that would require reading window state
        // (out of scope) or waiting for a clipboard-change event.
        PasteResult::success(&target.process_name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::target_window::now_ms;

    fn target() -> TargetWindowInfo {
        TargetWindowInfo {
            hwnd: 0xDEAD_BEEF_isize,
            pid: 99999,
            title: "Test".into(),
            process_name: "test.exe".into(),
            captured_at_ms: now_ms(),
        }
    }

    #[test]
    fn clipboard_only_variants_have_human_messages() {
        let cases = [
            ("noTarget", None, "手动粘贴"),
            ("targetClosed", Some("notepad.exe".into()), "目标窗口已关闭"),
            ("pidMismatch", Some("qq.exe".into()), "已被系统回收或复用"),
            (
                "activationFailed",
                Some("qq.exe".into()),
                "无法恢复目标窗口",
            ),
            ("inputFailed", Some("wechat.exe".into()), "自动粘贴失败"),
            ("invisible", Some("qq.exe".into()), "目标窗口不可见"),
            ("ipcFailed", Some("qq.exe".into()), "自动粘贴调用失败"),
            ("hideFailed", Some("qq.exe".into()), "手动粘贴"),
        ];
        for (reason, process, needle) in cases {
            let r = PasteResult::clipboard_only(reason, process);
            assert_eq!(r.kind, PasteKind::ClipboardOnly);
            assert_eq!(r.reason, reason);
            assert!(
                r.message.contains(needle),
                "reason={reason} got={}",
                r.message
            );
        }
    }

    #[test]
    fn success_message_includes_process_name() {
        let result = PasteResult::success("notepad.exe");
        assert_eq!(result.kind, PasteKind::Success);
        assert_eq!(result.reason, "success");
        assert_eq!(result.process_name.as_deref(), Some("notepad.exe"));
        assert!(result.message.contains("notepad.exe"));
    }

    #[test]
    fn disabled_is_distinct_variant() {
        let result = PasteResult::disabled();
        assert_eq!(result.kind, PasteKind::Disabled);
        assert_eq!(result.reason, "disabled");
        assert!(result.process_name.is_none());
    }

    #[test]
    #[cfg(windows)]
    fn paste_with_invalid_hwnd_does_not_panic() {
        // Passing a clearly-invalid HWND must not crash and must produce
        // a `clipboardOnly` result.
        let result = ChatPasteService::paste(&target());
        assert_eq!(result.kind, PasteKind::ClipboardOnly);
    }

    #[test]
    fn result_serialises_with_camel_case_kind() {
        let json = serde_json::to_string(&PasteResult::success("qq.exe")).unwrap();
        // kind is "success" (single word, no change), but must be lowercase
        assert!(json.contains("\"kind\":\"success\""));
        // processName is camelCase
        assert!(json.contains("\"processName\":\"qq.exe\""));
        // field names are camelCase
        assert!(json.contains("\"reason\":\"success\""));

        let json = serde_json::to_string(&PasteResult::clipboard_only(
            "pidMismatch",
            Some("qq.exe".into()),
        ))
        .unwrap();
        // CamelCase multi-word variant
        assert!(json.contains("\"kind\":\"clipboardOnly\""));
        assert!(json.contains("\"processName\":\"qq.exe\""));
        assert!(json.contains("\"reason\":\"pidMismatch\""));

        let json = serde_json::to_string(&PasteResult::disabled()).unwrap();
        assert!(json.contains("\"kind\":\"disabled\""));
        // processName must serialise as null in the disabled case
        assert!(json.contains("\"processName\":null"));
    }

    #[test]
    fn clipboard_only_result_shape_matches_typescript() {
        // Snapshot of the JSON shape the frontend PasteResult expects.
        let r = PasteResult::clipboard_only("noTarget", None);
        let v: serde_json::Value = serde_json::to_value(&r).unwrap();
        assert_eq!(v["kind"], "clipboardOnly");
        assert!(v["reason"].is_string());
        assert!(v["processName"].is_null());
        assert!(v["message"].is_string());
    }
}
