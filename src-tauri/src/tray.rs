use tauri::{
    App, AppHandle, Manager,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};

use crate::quick_search;

pub const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "main-tray";
const OPEN_MAIN_MENU_ID: &str = "open-main";
const OPEN_SEARCH_MENU_ID: &str = "open-search";
const EXIT_MENU_ID: &str = "exit";

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let open_main = MenuItem::with_id(app, OPEN_MAIN_MENU_ID, "打开主窗口", true, None::<&str>)?;
    let open_search =
        MenuItem::with_id(app, OPEN_SEARCH_MENU_ID, "打开搜索浮层", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, EXIT_MENU_ID, "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_main, &open_search, &exit])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("表情匣 EmoBox");
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            OPEN_MAIN_MENU_ID => {
                if let Err(error) = show_main_window(app) {
                    log::error!("托盘打开主窗口失败：{error}");
                }
            }
            OPEN_SEARCH_MENU_ID => {
                if let Err(error) = quick_search::show_quick_search(app) {
                    log::error!("托盘打开搜索浮层失败：{error}");
                }
            }
            EXIT_MENU_ID => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

pub fn show_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "找不到主窗口，请重启应用。".to_string())?;
    window
        .unminimize()
        .map_err(|error| format!("无法恢复主窗口：{error}"))?;
    window
        .show()
        .map_err(|error| format!("无法显示主窗口：{error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("无法聚焦主窗口：{error}"))
}
