mod clipboard;
mod clipboard_collect;
mod commands;
mod database;
mod quick_search;
mod recent;
mod repositories;
mod scanner;
mod services;
mod shortcut_registry;
mod thumbnail;
mod tray;

use tauri::Manager;

pub fn run() {
    let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };

    let shortcut_registry = shortcut_registry::ShortcutRegistry::initialize();

    tauri::Builder::default()
        .manage(shortcut_registry)
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_log::Builder::new().level(log_level).build())
        .setup(|app| {
            let database_state =
                database::DatabaseState::initialize(app.handle()).map_err(std::io::Error::other)?;
            app.manage(database_state);
            let recent_state =
                recent::RecentImagesState::load(app.handle()).map_err(std::io::Error::other)?;
            app.manage(recent_state);
            tray::setup(app)?;

            // 启动清理全局快捷键（D5 reconcile），确保 OS 层面没有上次的残留
            if let Err(error) = app
                .state::<shortcut_registry::ShortcutRegistry>()
                .reconcile(app.handle())
            {
                log::warn!("启动时清理全局快捷键失败：{error}");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_directory,
            commands::import_managed_paths,
            commands::load_thumbnail,
            commands::get_indexed_images,
            commands::get_storage_info,
            commands::open_assets_directory,
            commands::copy_image_to_clipboard,
            commands::get_recent_images,
            commands::update_quick_search_shortcut,
            commands::get_quick_search_shortcut_status,
            commands::update_clipboard_collect_shortcut,
            commands::get_clipboard_collect_shortcut_status,
            commands::show_quick_search,
            commands::hide_quick_search,
            commands::collect_image_from_clipboard,
            commands::list_groups,
            commands::create_group,
            commands::rename_group,
            commands::delete_group,
            commands::list_tags,
            commands::create_tag,
            commands::rename_tag,
            commands::delete_tag,
            commands::add_emojis_to_group,
            commands::remove_emojis_from_group,
            commands::add_tags_to_emojis,
            commands::remove_tags_from_emojis,
            commands::set_emojis_favorite,
            commands::search_emojis,
            commands::soft_delete_to_trash,
            commands::restore_from_trash,
            commands::permanently_delete_emojis,
            commands::empty_trash,
            commands::list_deleted_emojis,
            commands::show_in_explorer,
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
