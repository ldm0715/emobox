use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::{
    clipboard, clipboard_collect, database, quick_search, recent,
    repositories::emoji_repository::EmojiRepository,
    scanner,
    services::{
        asset_service::AssetService,
        import_service::{ImportContext, ImportService, ManagedImportSummary},
    },
    shortcut_registry::{
        SetOutcome, ShortcutOwner, ShortcutRegistrationStatus, ShortcutRegistry, ShortcutSyncState,
    },
    thumbnail,
};

const IMAGE_COPIED_EVENT: &str = "image-copied";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageCopiedPayload {
    item: scanner::IndexedImage,
    outcome: clipboard::ClipboardCopyOutcome,
    recent: recent::RecentImageRecord,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    assets_directory: String,
    emojis_directory: String,
    thumbnails_directory: String,
    supported_formats: Vec<&'static str>,
}

#[tauri::command]
pub async fn scan_directory(
    database_state: State<'_, database::DatabaseState>,
    path: String,
) -> Result<scanner::ScanSummary, String> {
    let requested_path = PathBuf::from(path);
    let database_path = database_state.database_path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        scanner::scan_and_persist(&database_path, &requested_path)
    })
    .await
    .map_err(|error| format!("扫描任务意外中止：{error}"))?
}

#[tauri::command]
pub async fn import_managed_paths(
    database_state: State<'_, database::DatabaseState>,
    paths: Vec<String>,
) -> Result<ManagedImportSummary, String> {
    let context = ImportContext {
        database_path: database_state.database_path().to_path_buf(),
        emojis_directory: database_state.emojis_directory().to_path_buf(),
        thumbnails_directory: database_state.thumbnails_directory().to_path_buf(),
    };
    let requested_paths = paths.into_iter().map(PathBuf::from).collect::<Vec<_>>();

    tauri::async_runtime::spawn_blocking(move || {
        ImportService::import_paths(&context, &requested_paths)
    })
    .await
    .map_err(|error| format!("图片导入任务意外中止：{error}"))?
}

#[tauri::command]
pub async fn load_thumbnail(path: String, max_size: Option<u32>) -> Result<String, String> {
    let requested_path = PathBuf::from(path);
    let requested_size = max_size.unwrap_or(240).clamp(64, 512);

    tauri::async_runtime::spawn_blocking(move || {
        thumbnail::load_thumbnail_data_url(&requested_path, requested_size)
    })
    .await
    .map_err(|error| format!("缩略图任务意外中止：{error}"))?
}

#[tauri::command]
pub fn get_indexed_images(
    database_state: State<'_, database::DatabaseState>,
) -> Result<Vec<scanner::IndexedImage>, String> {
    let connection = database_state.connect()?;
    EmojiRepository::list_available(&connection)
}

#[tauri::command]
pub fn get_storage_info(
    database_state: State<'_, database::DatabaseState>,
) -> Result<StorageInfo, String> {
    let emojis_directory = database_state.emojis_directory();
    let assets_directory = emojis_directory
        .parent()
        .ok_or_else(|| "素材库目录无效。".to_string())?;
    Ok(StorageInfo {
        assets_directory: assets_directory.to_string_lossy().into_owned(),
        emojis_directory: emojis_directory.to_string_lossy().into_owned(),
        thumbnails_directory: database_state
            .thumbnails_directory()
            .to_string_lossy()
            .into_owned(),
        supported_formats: vec!["PNG", "JPG", "JPEG", "GIF", "WebP"],
    })
}

#[tauri::command]
pub fn open_assets_directory(
    database_state: State<'_, database::DatabaseState>,
) -> Result<(), String> {
    AssetService::open_in_explorer(database_state.emojis_directory())
}

#[tauri::command]
pub fn copy_image_to_clipboard(
    app: AppHandle,
    database_state: State<'_, database::DatabaseState>,
    recent_state: State<'_, recent::RecentImagesState>,
    path: String,
) -> Result<clipboard::ClipboardCopyOutcome, String> {
    let connection = database_state.connect()?;
    let indexed_item = EmojiRepository::find_by_source_path(&connection, &path)?;
    let item = match indexed_item {
        Some(item) => item,
        None => recent_state.find_item(&path)?.ok_or_else(|| {
            "这张图片不在当前索引或最近使用记录中，请重新导入后再试。".to_string()
        })?,
    };

    let outcome = clipboard::copy_image(&app, Path::new(&item.path))?;
    let recent = recent_state.record(item.clone())?;

    let payload = ImageCopiedPayload {
        item,
        outcome: outcome.clone(),
        recent,
    };
    if let Err(error) = app.emit_to("main", IMAGE_COPIED_EVENT, payload) {
        log::warn!("图片已复制，但无法通知主窗口更新最近使用：{error}");
    }

    Ok(outcome)
}

#[tauri::command]
pub fn get_recent_images(
    recent_state: State<'_, recent::RecentImagesState>,
) -> Result<Vec<recent::RecentImageRecord>, String> {
    recent_state.records()
}

#[tauri::command]
pub fn update_quick_search_shortcut(
    app: AppHandle,
    registry: State<'_, ShortcutRegistry>,
    shortcut: String,
) -> Result<SetOutcome, String> {
    Ok(registry.try_set(&app, ShortcutOwner::QuickSearch, &shortcut))
}

#[tauri::command]
pub fn get_quick_search_shortcut_status(
    registry: State<'_, ShortcutRegistry>,
) -> Result<ShortcutRegistrationStatus, String> {
    let display = registry.current_display(ShortcutOwner::QuickSearch);
    let state = registry.sync_state();
    Ok(ShortcutRegistrationStatus {
        shortcut: display,
        registered: matches!(state, ShortcutSyncState::Synced),
    })
}

#[tauri::command]
pub fn update_clipboard_collect_shortcut(
    app: AppHandle,
    registry: State<'_, ShortcutRegistry>,
    shortcut: String,
) -> Result<SetOutcome, String> {
    Ok(registry.try_set(&app, ShortcutOwner::ClipboardCollect, &shortcut))
}

#[tauri::command]
pub fn get_clipboard_collect_shortcut_status(
    registry: State<'_, ShortcutRegistry>,
) -> Result<ShortcutRegistrationStatus, String> {
    let display = registry.current_display(ShortcutOwner::ClipboardCollect);
    let state = registry.sync_state();
    Ok(ShortcutRegistrationStatus {
        shortcut: display,
        registered: matches!(state, ShortcutSyncState::Synced),
    })
}

#[tauri::command]
pub fn show_quick_search(app: AppHandle) -> Result<(), String> {
    quick_search::show_quick_search(&app)
}

#[tauri::command]
pub fn hide_quick_search(app: AppHandle) -> Result<(), String> {
    quick_search::hide_quick_search(&app)
}

/// 从剪贴板读取图片并保存到素材库。返回 `ClipboardCollectOutcome`（不抛 Err）。
/// `read_image` 在非主线程调用，所以这里用 `spawn_blocking` 包装。
#[tauri::command]
pub async fn collect_image_from_clipboard(
    app: AppHandle,
    database_state: State<'_, database::DatabaseState>,
) -> Result<clipboard_collect::ClipboardCollectOutcome, String> {
    let db_state = database_state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        clipboard_collect::collect_image_from_clipboard(&app, &db_state)
    })
    .await
    .map_err(|error| format!("剪贴板收藏任务意外中止：{error}"))
}
