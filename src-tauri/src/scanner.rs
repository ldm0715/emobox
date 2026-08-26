use std::{
    fs,
    path::Path,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use image::GenericImageView;
use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

use crate::{database, repositories::emoji_repository::EmojiRepository};

const SUPPORTED_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];
const WARNING_LIMIT: usize = 20;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IndexedImage {
    pub name: String,
    pub path: String,
    pub extension: String,
    pub width: u32,
    pub height: u32,
    pub size_bytes: u64,
}

/// 已落库的完整表情：携带 `id`、收藏/使用状态、当前可读路径（COALESCE 投影）。
/// 用于 `search_emojis` / `list_indexed` / `list_deleted` 等需要完整信息的接口。
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IndexedEmoji {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub thumbnail_path: Option<String>,
    pub extension: String,
    pub width: u32,
    pub height: u32,
    pub size_bytes: u64,
    pub source_type: String,
    pub is_favorite: bool,
    pub last_used_at: Option<i64>,
    pub usage_count: i64,
    #[serde(default)]
    pub group_ids: Vec<i64>,
    #[serde(default)]
    pub tag_ids: Vec<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub directory: String,
    pub indexed_count: usize,
    pub skipped_count: usize,
    pub unsupported_count: usize,
    pub elapsed_ms: u128,
    pub items: Vec<IndexedImage>,
    pub warnings: Vec<String>,
}

pub fn scan_directory(root: &Path) -> Result<ScanSummary, String> {
    if !root.exists() {
        return Err(format!("目录不存在：{}", root.display()));
    }

    if !root.is_dir() {
        return Err(format!("所选路径不是目录：{}", root.display()));
    }

    let started_at = Instant::now();
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("无法访问所选目录：{error}"))?;

    log::info!("开始扫描目录：{}", canonical_root.display());

    let mut items = Vec::new();
    let mut warnings = Vec::new();
    let mut skipped_count = 0usize;
    let mut unsupported_count = 0usize;

    for entry_result in WalkDir::new(&canonical_root).follow_links(false) {
        let entry = match entry_result {
            Ok(entry) => entry,
            Err(error) => {
                skipped_count += 1;
                let message = format!("无法访问目录项：{error}");
                log::warn!("{message}");
                push_warning(&mut warnings, message);
                continue;
            }
        };

        if !entry.file_type().is_file() || entry.file_type().is_symlink() {
            continue;
        }

        let path = entry.path();
        let Some(extension) = supported_extension(path) else {
            unsupported_count += 1;
            log::debug!("忽略不支持的文件：{}", path.display());
            continue;
        };

        let metadata = match fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(error) => {
                skipped_count += 1;
                let message = format!("无法读取文件信息 {}：{error}", path.display());
                log::warn!("{message}");
                push_warning(&mut warnings, message);
                continue;
            }
        };

        let decoded = match image::open(path) {
            Ok(image) => image,
            Err(error) => {
                skipped_count += 1;
                let message = format!("跳过无法解码的图片 {}：{error}", path.display());
                log::warn!("{message}");
                push_warning(&mut warnings, message);
                continue;
            }
        };

        let (width, height) = decoded.dimensions();
        let name = entry.file_name().to_string_lossy().into_owned();

        items.push(IndexedImage {
            name,
            path: path.to_string_lossy().into_owned(),
            extension,
            width,
            height,
            size_bytes: metadata.len(),
        });
    }

    items.sort_by_cached_key(|item| item.name.to_lowercase());

    let summary = ScanSummary {
        directory: canonical_root.to_string_lossy().into_owned(),
        indexed_count: items.len(),
        skipped_count,
        unsupported_count,
        elapsed_ms: started_at.elapsed().as_millis(),
        items,
        warnings,
    };

    log::info!(
        "扫描完成：目录={}，已索引={}，跳过={}，其他文件={}，耗时={}ms",
        summary.directory,
        summary.indexed_count,
        summary.skipped_count,
        summary.unsupported_count,
        summary.elapsed_ms
    );

    Ok(summary)
}

pub fn scan_and_persist(database_path: &Path, root: &Path) -> Result<ScanSummary, String> {
    let summary = scan_directory(root)?;
    let mut connection = database::open_connection(database_path)?;
    EmojiRepository::upsert_external_scan(&mut connection, &summary.items, unix_time_millis())?;
    Ok(summary)
}

fn unix_time_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

pub(crate) fn supported_extension(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_string_lossy().to_lowercase();
    SUPPORTED_EXTENSIONS
        .contains(&extension.as_str())
        .then_some(extension)
}

fn push_warning(warnings: &mut Vec<String>, message: String) {
    if warnings.len() < WARNING_LIMIT {
        warnings.push(message);
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::supported_extension;

    #[test]
    fn accepts_supported_extensions_case_insensitively() {
        assert_eq!(
            supported_extension(Path::new("hello.PNG")).as_deref(),
            Some("png")
        );
        assert_eq!(
            supported_extension(Path::new("funny.JpEg")).as_deref(),
            Some("jpeg")
        );
        assert_eq!(
            supported_extension(Path::new("motion.GIF")).as_deref(),
            Some("gif")
        );
        assert_eq!(
            supported_extension(Path::new("sticker.webp")).as_deref(),
            Some("webp")
        );
    }

    #[test]
    fn rejects_unsupported_extensions() {
        assert!(supported_extension(Path::new("notes.txt")).is_none());
        assert!(supported_extension(Path::new("image.bmp")).is_none());
        assert!(supported_extension(Path::new("no-extension")).is_none());
    }
}
