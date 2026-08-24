mod clipboard;
mod commands;
mod quick_search;
mod recent;
mod scanner;
mod thumbnail;
mod tray;

use tauri::Manager;

pub fn run() {
    let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };

    tauri::Builder::default()
        .manage(commands::LibraryIndexState::default())
        .manage(quick_search::QuickSearchShortcutState::default())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_log::Builder::new().level(log_level).build())
        .setup(|app| {
            let recent_state =
                recent::RecentImagesState::load(app.handle()).map_err(std::io::Error::other)?;
            app.manage(recent_state);
            tray::setup(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_directory,
            commands::load_thumbnail,
            commands::get_indexed_images,
            commands::copy_image_to_clipboard,
            commands::get_recent_images,
            commands::update_quick_search_shortcut,
            commands::get_quick_search_shortcut_status,
            commands::show_quick_search,
            commands::hide_quick_search
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                match window.label() {
                    quick_search::WINDOW_LABEL | tray::MAIN_WINDOW_LABEL => {
                        api.prevent_close();
                        if let Err(error) = window.hide() {
                            log::error!("隐藏窗口 {} 失败：{error}", window.label());
                        }
                    }
                    _ => {}
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run EmoBox");
}
