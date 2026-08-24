mod commands;
mod quick_search;
mod scanner;
mod thumbnail;

pub fn run() {
    let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };

    tauri::Builder::default()
        .manage(commands::LibraryIndexState::default())
        .manage(quick_search::QuickSearchShortcutState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_log::Builder::new().level(log_level).build())
        .invoke_handler(tauri::generate_handler![
            commands::scan_directory,
            commands::load_thumbnail,
            commands::get_indexed_images,
            commands::update_quick_search_shortcut,
            commands::get_quick_search_shortcut_status,
            commands::show_quick_search,
            commands::hide_quick_search
        ])
        .on_window_event(|window, event| {
            if window.label() != quick_search::WINDOW_LABEL {
                return;
            }

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    log::error!("隐藏快捷搜索窗口失败：{error}");
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run EmoBox");
}
