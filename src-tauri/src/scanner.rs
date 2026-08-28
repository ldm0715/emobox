use std::{
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

const SUPPORTED_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];
const WARNING_LIMIT: usize = 20;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IndexedImage {
    /// 已落库 emoji 的 id。旧最近使用 JSON（recent-images.json）无此字段，
    /// 用 `#[serde(default)]` 保证旧数据可反序列化（此时 id 为 0）。
    #[serde(default)]
    pub id: i64,
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

/// 递归收集目录下所有受支持扩展名的普通文件（跳过符号链接）。
///
/// 返回 `(文件路径列表, 警告列表)`。不支持扩展名 / 无法访问的项不计入返回，
/// 但记录 warning（`FolderImportSummary.failed_count` 据此汇总）。
/// 文件夹导入只复制入库，不再有"仅索引原路径"模式。
pub(crate) fn collect_image_files(root: &Path) -> Result<(Vec<PathBuf>, Vec<String>), String> {
    if !root.exists() {
        return Err(format!("目录不存在：{}", root.display()));
    }
    if !root.is_dir() {
        return Err(format!("所选路径不是目录：{}", root.display()));
    }

    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("无法访问所选目录：{error}"))?;

    let mut files = Vec::new();
    let mut warnings = Vec::new();
    for entry in WalkDir::new(&canonical_root).follow_links(false) {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                push_warning(&mut warnings, format!("无法访问目录项：{error}"));
                continue;
            }
        };
        if !entry.file_type().is_file() || entry.file_type().is_symlink() {
            continue;
        }
        let path = entry.path();
        if supported_extension(path).is_none() {
            continue;
        }
        files.push(path.to_path_buf());
    }
    files.sort();
    Ok((files, warnings))
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
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{collect_image_files, supported_extension};

    fn test_root(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("emobox-scan-{label}-{}-{unique}", std::process::id()));
        fs::create_dir_all(&root).expect("create test root");
        root
    }

    fn write_placeholder(path: &Path, content: &[u8]) {
        fs::write(path, content).expect("write file");
    }

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

    #[test]
    fn collect_image_files_recursive_and_filters() {
        let root = test_root("collect");
        fs::create_dir_all(root.join("nested/deeper")).expect("create nested");
        write_placeholder(&root.join("a.png"), b"a");
        write_placeholder(&root.join("nested/b.jpg"), b"b");
        write_placeholder(&root.join("nested/deeper/c.webp"), b"c");
        write_placeholder(&root.join("skip.txt"), b"not image");
        write_placeholder(&root.join("nested/also.GIF"), b"g");

        let (files, warnings) = collect_image_files(&root).expect("collect");
        assert!(warnings.is_empty());
        let mut names: Vec<String> = files
            .iter()
            .map(|f| f.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, vec!["a.png", "also.GIF", "b.jpg", "c.webp"]);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn collect_image_files_rejects_missing_root() {
        let err = collect_image_files(Path::new("Z:/definitely-missing-emoBox-dir")).expect_err("error");
        assert!(err.contains("目录不存在"));
    }
}
