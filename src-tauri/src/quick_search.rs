use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::selection_capture;
use crate::target_window;

pub const WINDOW_LABEL: &str = "quick-search";
const OPENED_EVENT: &str = "quick-search-opened";
/// 库数据变更（导入 / 删除 / 收藏 / 分组 / 标签等）后发给浮层，让它重载当前搜索。
pub const LIBRARY_CHANGED_EVENT: &str = "library-changed";

/// `quick-search-opened` 事件载荷。`selected_text` 是打开浮层时前台窗口
/// 选中的文字（Phase 15 选中文字搜索），读不到为 `None`。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickSearchOpenedPayload {
    pub selected_text: Option<String>,
}

/// 通知快捷搜索浮层"库数据变了"。失败仅 log（沿用 `image-copied` 模式）。
/// 不需要在 lib.rs 注册：Tauri 事件是自由形式；quick-search 窗口 `visible:false`
/// 但始终存在（`on_window_event` 拦截关闭改隐藏），事件可安全投递。
pub fn notify_library_changed(app: &AppHandle) {
    if let Err(error) = app.emit_to(WINDOW_LABEL, LIBRARY_CHANGED_EVENT, ()) {
        log::warn!("无法通知快捷搜索窗口刷新：{error}");
    }
}

/// 显示浮层的唯一路径（托盘 / 主窗口 / 全局快捷键共用）。泛型 Runtime 以便
/// 快捷键注册表（`ShortcutRegistry<R>`）也能调用。
pub fn show_quick_search<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let window = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or_else(|| "找不到快捷搜索窗口，请重启应用。".to_string())?;

    // 必须先抓取前台窗口，再 center/show/set_focus，
    // 否则 Tauri 会先把自己设为前台，丢失目标 HWND。
    // capture_from_foreground 内部先 clear 再 write，
    // 避免上一次会话的 HWND 被跨会话复用。
    target_window::capture_from_foreground(app);

    // 选中文字也必须在浮层抢焦点前读取（UIA 读的是"焦点控件"）。
    let selected_text = selection_capture::capture_selected_text(app);

    window
        .center()
        .map_err(|error| format!("无法将快捷搜索窗口居中：{error}"))?;
    window
        .show()
        .map_err(|error| format!("无法显示快捷搜索窗口：{error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("无法聚焦快捷搜索窗口：{error}"))?;
    app.emit_to(
        WINDOW_LABEL,
        OPENED_EVENT,
        QuickSearchOpenedPayload { selected_text },
    )
    .map_err(|error| format!("无法激活快捷搜索输入框：{error}"))?;

    Ok(())
}

pub fn hide_quick_search<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let window = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or_else(|| "找不到快捷搜索窗口，请重启应用。".to_string())?;
    // 注意：这里**不**清空 TargetWindowState。前端自动粘贴链是
    // 「先 hideQuickSearch 再 pasteToTargetWindow」——浮层必须先隐藏
    // （alwaysOnTop 会阻塞 SetForegroundWindow），粘贴目标必须在隐藏后
    // 仍然可用。跨会话复用由 capture_from_foreground 的"打开即先 clear"
    // 防住，另有 60 秒 TTL 与粘贴失败 clear 兜底（Phase 15 修复：原先
    // 在这里 clear 会让每次自动粘贴都 noTarget 降级）。
    window
        .hide()
        .map_err(|error| format!("无法隐藏快捷搜索窗口：{error}"))
}

pub fn normalize_shortcut(shortcut_text: &str) -> Result<String, String> {
    let parts = shortcut_text
        .split('+')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();

    if parts.len() < 2 || !parts.iter().any(is_modifier) {
        return Err("全局快捷键必须包含 Ctrl、Alt、Shift 或 Win 修饰键。".to_string());
    }

    Ok(parts.join("+"))
}

pub fn shortcut_parser_text(shortcut_text: &str) -> String {
    shortcut_text
        .split('+')
        .map(|part| match part.to_ascii_lowercase().as_str() {
            "win" | "meta" => "Super",
            _ => part,
        })
        .collect::<Vec<_>>()
        .join("+")
}

fn is_modifier(part: &&str) -> bool {
    matches!(
        part.to_ascii_lowercase().as_str(),
        "ctrl"
            | "control"
            | "alt"
            | "shift"
            | "win"
            | "super"
            | "meta"
            | "cmd"
            | "command"
            | "commandorcontrol"
            | "cmdorctrl"
    )
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use tauri_plugin_global_shortcut::Shortcut;

    use super::{normalize_shortcut, shortcut_parser_text};

    #[test]
    fn normalizes_supported_shortcut() {
        assert_eq!(
            normalize_shortcut(" Ctrl + Alt + Space ").as_deref(),
            Ok("Ctrl+Alt+Space")
        );
    }

    #[test]
    fn converts_windows_modifier_for_parser() {
        let parser_text = shortcut_parser_text("Win+Space");
        assert_eq!(parser_text, "Super+Space");
        assert!(Shortcut::from_str(&parser_text).is_ok());
    }

    #[test]
    fn rejects_unmodified_key() {
        assert!(normalize_shortcut("Space").is_err());
    }

    #[test]
    fn rejects_modifier_only_shortcut() {
        assert!(normalize_shortcut("Ctrl").is_err());
    }
}
