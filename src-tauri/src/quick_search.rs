use tauri::{AppHandle, Emitter, Manager};

pub const WINDOW_LABEL: &str = "quick-search";
const OPENED_EVENT: &str = "quick-search-opened";

pub fn show_quick_search(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or_else(|| "找不到快捷搜索窗口，请重启应用。".to_string())?;

    window
        .center()
        .map_err(|error| format!("无法将快捷搜索窗口居中：{error}"))?;
    window
        .show()
        .map_err(|error| format!("无法显示快捷搜索窗口：{error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("无法聚焦快捷搜索窗口：{error}"))?;
    app.emit_to(WINDOW_LABEL, OPENED_EVENT, ())
        .map_err(|error| format!("无法激活快捷搜索输入框：{error}"))?;

    Ok(())
}

pub fn hide_quick_search(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or_else(|| "找不到快捷搜索窗口，请重启应用。".to_string())?;
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
