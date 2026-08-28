mod clipboard;
mod clipboard_collect;
mod commands;
mod database;
mod perceptual_hash;
mod platform;
mod quick_search;
mod recent;
mod repositories;
mod scanner;
mod services;
mod shortcut_registry;
mod target_window;
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
            app.manage(target_window::TargetWindowState::new());
            tray::setup(app)?;

            // 启动一次性回填存量无标签表情的"文件名"标签（纯 DB，幂等，失败不阻塞）。
            let db_path = app
                .state::<database::DatabaseState>()
                .database_path()
                .to_path_buf();
            match database::open_connection(&db_path) {
                Ok(mut connection) => {
                    const BACKFILL_BATCH: i64 = 500;
                    let mut total = 0usize;
                    loop {
                        match services::import_service::ImportService::backfill_filename_tags(
                            &mut connection,
                            BACKFILL_BATCH,
                        ) {
                            Ok(batch) => {
                                total += batch;
                                if (batch as i64) < BACKFILL_BATCH {
                                    break;
                                }
                            }
                            Err(error) => {
                                log::warn!("文件名标签启动回填失败：{error}");
                                break;
                            }
                        }
                    }
                    if total > 0 {
                        log::info!("已回填 {total} 条文件名标签");
                    }
                }
                Err(error) => log::warn!("打开数据库做标签回填失败：{error}"),
            }

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
            commands::import_folder,
            commands::import_managed_paths,
            commands::load_thumbnail,
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
            commands::paste_to_target_window,
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
