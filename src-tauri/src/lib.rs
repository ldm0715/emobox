mod clipboard;
mod clipboard_collect;
mod close_behavior;
mod commands;
mod database;
mod perceptual_hash;
mod platform;
mod quick_search;
mod recent;
mod repositories;
mod scanner;
mod selection_capture;
mod services;
mod shortcut_registry;
mod target_window;
mod thumbnail;
mod tray;

use tauri::{Emitter, Manager};

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
            app.manage(selection_capture::SelectionSearchState::new());
            app.manage(close_behavior::CloseBehaviorState::new());
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

            // 浮层是透明圆角窗口：Windows 10 上 DWM 默认阴影若未清除，会在
            // 圆角外留下直角色块（tauri#11321）。tauri.conf.json 的 shadow:false
            // 与 set_shadow(false)（tao 标志位）都存在时序不稳的记录，这里再经
            // Win32 直接禁用 DWM 非客户区渲染（属性级设置，不触发样式重算/重绘，
            // 幂等）——三重保险里真正确定性生效的是这一道。
            if let Some(overlay) = app.get_webview_window(quick_search::WINDOW_LABEL) {
                if let Err(error) = overlay.set_shadow(false) {
                    log::warn!("关闭浮层窗口阴影失败：{error}");
                }
                #[cfg(windows)]
                if let Ok(hwnd) = overlay.hwnd() {
                    if let Err(error) =
                        platform::windows::dwm::disable_nc_rendering(hwnd.0 as isize)
                    {
                        log::warn!("禁用浮层 DWM 非客户区渲染失败：{error}");
                    }
                    // OS 级圆角裁剪：区域外像素（DWM 残余阴影 / WebView2 底边
                    // 透明残片）一律无法绘制。
                    platform::windows::dwm::apply_rounded_region(hwnd.0 as isize);
                }
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
            commands::set_selection_search_enabled,
            commands::collect_image_from_clipboard,
            commands::list_groups,
            commands::create_group,
            commands::rename_group,
            commands::delete_group,
            commands::set_group_pinned,
            commands::set_group_icon,
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
            commands::open_external_url,
            commands::set_close_to_tray,
            commands::exit_application,
            commands::paste_to_target_window,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                match window.label() {
                    quick_search::WINDOW_LABEL => {
                        api.prevent_close();
                        if let Err(error) = window.hide() {
                            log::error!("隐藏窗口 {} 失败：{error}", window.label());
                        }
                    }
                    tray::MAIN_WINDOW_LABEL => {
                        // Phase 25：主窗口关闭行为由 CloseBehaviorState 决定
                        // （None=弹询问窗 / Some(true)=驻留托盘 / Some(false)=退出）。
                        api.prevent_close();
                        let app = window.app_handle();
                        match app.state::<close_behavior::CloseBehaviorState>().get() {
                            Some(true) => {
                                if let Err(error) = window.hide() {
                                    log::error!("隐藏主窗口失败：{error}");
                                }
                            }
                            Some(false) => {
                                log::info!("用户已记住直接退出，应用关闭");
                                app.exit(0);
                            }
                            // 未做出选择：窗口保持可见，交给前端弹「最小化到托盘 /
                            // 直接退出」询问窗（Esc 关闭弹窗即取消关闭）。
                            None => {
                                if let Err(error) =
                                    app.emit_to(tray::MAIN_WINDOW_LABEL, "main-close-requested", ())
                                {
                                    log::error!("发送主窗口关闭询问事件失败：{error}");
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run EmoBox");
}
