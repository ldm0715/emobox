use std::{
    path::{Path, PathBuf},
    sync::RwLock,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::{clipboard, quick_search, scanner, thumbnail};

const RECENT_IMAGE_LIMIT: usize = 50;
const IMAGE_COPIED_EVENT: &str = "image-copied";

#[derive(Default)]
pub struct LibraryIndexState {
    items: RwLock<Vec<scanner::IndexedImage>>,
}

#[derive(Default)]
pub struct RecentImagesState {
    paths: RwLock<Vec<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageCopiedPayload {
    item: scanner::IndexedImage,
    outcome: clipboard::ClipboardCopyOutcome,
}

#[tauri::command]
pub async fn scan_directory(
    state: State<'_, LibraryIndexState>,
    path: String,
) -> Result<scanner::ScanSummary, String> {
    let requested_path = PathBuf::from(path);
    let summary =
        tauri::async_runtime::spawn_blocking(move || scanner::scan_directory(&requested_path))
            .await
            .map_err(|error| format!("扫描任务意外中止：{error}"))??;

    let mut indexed_items = state
        .items
        .write()
        .map_err(|_| "索引状态不可用，请重启应用后重新导入。".to_string())?;
    *indexed_items = summary.items.clone();

    Ok(summary)
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
    state: State<'_, LibraryIndexState>,
) -> Result<Vec<scanner::IndexedImage>, String> {
    state
        .items
        .read()
        .map(|items| items.clone())
        .map_err(|_| "索引状态不可用，请重启应用后重新导入。".to_string())
}

#[tauri::command]
pub fn copy_image_to_clipboard(
    app: AppHandle,
    library_state: State<'_, LibraryIndexState>,
    recent_state: State<'_, RecentImagesState>,
    path: String,
) -> Result<clipboard::ClipboardCopyOutcome, String> {
    let item = library_state
        .items
        .read()
        .map_err(|_| "索引状态不可用，请重启应用后重新导入。".to_string())?
        .iter()
        .find(|item| item.path == path)
        .cloned()
        .ok_or_else(|| "这张图片不在当前索引中，请重新导入文件夹后再试。".to_string())?;

    let outcome = clipboard::copy_image(&app, Path::new(&item.path))?;

    {
        let mut recent_paths = recent_state
            .paths
            .write()
            .map_err(|_| "图片已复制，但最近使用记录暂时不可用。".to_string())?;
        record_recent_path(&mut recent_paths, &item.path);
    }

    let payload = ImageCopiedPayload {
        item,
        outcome: outcome.clone(),
    };
    if let Err(error) = app.emit_to("main", IMAGE_COPIED_EVENT, payload) {
        log::warn!("图片已复制，但无法通知主窗口更新最近使用：{error}");
    }

    Ok(outcome)
}

#[tauri::command]
pub fn get_recent_images(
    library_state: State<'_, LibraryIndexState>,
    recent_state: State<'_, RecentImagesState>,
) -> Result<Vec<scanner::IndexedImage>, String> {
    let items = library_state
        .items
        .read()
        .map_err(|_| "索引状态不可用，请重启应用后重新导入。".to_string())?;
    let recent_paths = recent_state
        .paths
        .read()
        .map_err(|_| "最近使用记录暂时不可用，请重启应用后重试。".to_string())?;

    Ok(recent_paths
        .iter()
        .filter_map(|path| items.iter().find(|item| &item.path == path).cloned())
        .collect())
}

#[tauri::command]
pub fn update_quick_search_shortcut(
    app: AppHandle,
    state: State<'_, quick_search::QuickSearchShortcutState>,
    shortcut: String,
) -> Result<quick_search::ShortcutRegistrationStatus, String> {
    quick_search::register_shortcut(&app, &state, &shortcut)
}

#[tauri::command]
pub fn get_quick_search_shortcut_status(
    state: State<'_, quick_search::QuickSearchShortcutState>,
) -> Result<quick_search::ShortcutRegistrationStatus, String> {
    quick_search::registration_status(&state)
}

#[tauri::command]
pub fn show_quick_search(app: AppHandle) -> Result<(), String> {
    quick_search::show_quick_search(&app)
}

#[tauri::command]
pub fn hide_quick_search(app: AppHandle) -> Result<(), String> {
    quick_search::hide_quick_search(&app)
}
fn record_recent_path(recent_paths: &mut Vec<String>, path: &str) {
    recent_paths.retain(|recent_path| recent_path != path);
    recent_paths.insert(0, path.to_string());
    recent_paths.truncate(RECENT_IMAGE_LIMIT);
}

#[cfg(test)]
mod tests {
    use super::{RECENT_IMAGE_LIMIT, record_recent_path};

    #[test]
    fn recent_images_are_deduplicated_moved_to_front_and_limited() {
        let mut paths = (0..RECENT_IMAGE_LIMIT)
            .map(|index| format!("image-{index}"))
            .collect::<Vec<_>>();

        record_recent_path(&mut paths, "image-20");
        assert_eq!(paths.first().map(String::as_str), Some("image-20"));
        assert_eq!(
            paths
                .iter()
                .filter(|path| path.as_str() == "image-20")
                .count(),
            1
        );
        assert_eq!(paths.len(), RECENT_IMAGE_LIMIT);

        record_recent_path(&mut paths, "new-image");
        assert_eq!(paths.first().map(String::as_str), Some("new-image"));
        assert_eq!(paths.len(), RECENT_IMAGE_LIMIT);
    }
}
