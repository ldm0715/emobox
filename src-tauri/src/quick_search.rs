use std::{str::FromStr, sync::Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const WINDOW_LABEL: &str = "quick-search";
const OPENED_EVENT: &str = "quick-search-opened";

#[derive(Default)]
struct RegisteredShortcut {
    shortcut: Option<Shortcut>,
    display: Option<String>,
}

#[derive(Default)]
pub struct QuickSearchShortcutState(Mutex<RegisteredShortcut>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutRegistrationStatus {
    pub shortcut: Option<String>,
    pub registered: bool,
}

pub fn register_shortcut(
    app: &AppHandle,
    state: &QuickSearchShortcutState,
    shortcut_text: &str,
) -> Result<ShortcutRegistrationStatus, String> {
    let normalized = normalize_shortcut(shortcut_text)?;
    let parser_text = shortcut_parser_text(&normalized);
    let parsed =
        Shortcut::from_str(&parser_text).map_err(|error| format!("快捷键格式无效：{error}"))?;
    let manager = app.global_shortcut();
    let mut registered = state
        .0
        .lock()
        .map_err(|_| "快捷键状态不可用，请重启应用后重试。".to_string())?;

    if registered.shortcut.as_ref() == Some(&parsed) {
        registered.display = Some(normalized);
        return Ok(status_from(&registered));
    }

    manager
        .on_shortcut(parsed, |app, _, event| {
            if event.state() == ShortcutState::Pressed
                && let Err(error) = toggle_quick_search(app)
            {
                log::error!("全局快捷键切换搜索浮层失败：{error}");
            }
        })
        .map_err(|error| {
            format!("无法注册快捷键 {normalized}。它可能已被 Windows 或其他应用占用：{error}")
        })?;

    if let Some(previous) = registered.shortcut
        && let Err(error) = manager.unregister(previous)
    {
        let _ = manager.unregister(parsed);
        return Err(format!(
            "新快捷键已注册，但旧快捷键无法注销，已回滚修改：{error}"
        ));
    }

    registered.shortcut = Some(parsed);
    registered.display = Some(normalized);
    Ok(status_from(&registered))
}

pub fn registration_status(
    state: &QuickSearchShortcutState,
) -> Result<ShortcutRegistrationStatus, String> {
    let registered = state
        .0
        .lock()
        .map_err(|_| "快捷键状态不可用，请重启应用后重试。".to_string())?;
    Ok(status_from(&registered))
}

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

fn toggle_quick_search(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or_else(|| "找不到快捷搜索窗口，请重启应用。".to_string())?;
    let visible = window
        .is_visible()
        .map_err(|error| format!("无法读取快捷搜索窗口状态：{error}"))?;

    if visible {
        hide_quick_search(app)
    } else {
        show_quick_search(app)
    }
}

fn status_from(registered: &RegisteredShortcut) -> ShortcutRegistrationStatus {
    ShortcutRegistrationStatus {
        shortcut: registered.display.clone(),
        registered: registered.shortcut.is_some(),
    }
}

fn normalize_shortcut(shortcut_text: &str) -> Result<String, String> {
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

fn shortcut_parser_text(shortcut_text: &str) -> String {
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
