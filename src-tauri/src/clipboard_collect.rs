//! 剪贴板收藏：从 Windows 剪贴板读取图像，调用现有 import 流水线落库。
//!
//! 设计决策见 D1 / D2 / D4：
//! - 不重新解码剪贴板字节；RGBA → DynamicImage → `AssetService::stage_dynamic_image`
//! - 默认所有 `read_image` 失败映射为 `Unavailable`；只有步骤 0 探针在 Windows 实机
//!   确认错误文本稳定时才激活 `Empty` 映射
//! - `Failed.reason` 不含绝对路径
//! - 不监听剪贴板变化；只有用户主动触发（菜单或 `Ctrl+Alt+S`）

use std::time::{SystemTime, UNIX_EPOCH};

use image::DynamicImage;
use serde::Serialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::{
    database::DatabaseState,
    scanner::IndexedImage,
    services::import_service::{
        ImportContext, ImportOneOutcome, ImportService, ManagedImportSummary,
    },
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ClipboardCollectOutcome {
    /// 剪贴板没有图片（仅在步骤 0 探针确认可区分时返回）
    Empty { message: String },
    /// 写入素材库并落库成功
    Imported {
        summary: ManagedImportSummary,
        message: String,
    },
    /// 已存在相同 SHA-256，未复制第二份
    Duplicate {
        summary: ManagedImportSummary,
        message: String,
    },
    /// 写入/缩略图/数据库任一步失败，已回滚
    Failed {
        summary: Option<ManagedImportSummary>,
        message: String,
        reason: String,
    },
    /// 读剪贴板失败 / 系统异常 / 权限缺失
    Unavailable { reason: String, message: String },
}

/// 入口。**不**在主线程调用；调用方应通过 `tauri::async_runtime::spawn_blocking` 调用。
pub fn collect_image_from_clipboard<R: Runtime>(
    app: &AppHandle<R>,
    database_state: &DatabaseState,
) -> ClipboardCollectOutcome {
    // 1. 读剪贴板
    let image_result = app.clipboard().read_image();

    let image = match image_result {
        Ok(img) => img,
        Err(error) => {
            let text = error.to_string();
            // D2 激活条件：arboard 在 Windows 上对"剪贴板没图片"
            // （空剪贴板 / 只有文本）返回这段统一文本。区分于权限/系统异常。
            // 如果将来 arboard 升级改变错误文本，需重新评估。
            if text.contains("clipboard is empty")
                || text.contains("not available in the requested format")
            {
                return ClipboardCollectOutcome::Empty {
                    message: "剪贴板中没有图片。".to_string(),
                };
            }
            return ClipboardCollectOutcome::Unavailable {
                reason: text,
                message: "无法读取剪贴板图片。".to_string(),
            };
        }
    };

    // 2. 构造 DynamicImage（不重新解码 — RGBA 已经是裸像素）
    let rgba = image.rgba().to_vec();
    let width = image.width();
    let height = image.height();
    if width == 0 || height == 0 || rgba.is_empty() {
        return ClipboardCollectOutcome::Empty {
            message: "剪贴板中没有图片。".to_string(),
        };
    }
    let dyn_image = match image::RgbaImage::from_raw(width, height, rgba) {
        Some(buf) => DynamicImage::ImageRgba8(buf),
        None => {
            return ClipboardCollectOutcome::Unavailable {
                reason: "RGBA 尺寸与像素长度不匹配".to_string(),
                message: "无法处理剪贴板图片。".to_string(),
            };
        }
    };

    // 3. 调 import_dynamic_image（入口已取 IMPORT_LOCK）
    let filename = clipboard_filename();
    let context = ImportContext {
        database_path: database_state.database_path().to_path_buf(),
        emojis_directory: database_state.emojis_directory().to_path_buf(),
        thumbnails_directory: database_state.thumbnails_directory().to_path_buf(),
    };

    let result = ImportService::import_dynamic_image(&context, dyn_image, "png", &filename);

    match result {
        Ok(ImportOneOutcome::Imported(item)) => ClipboardCollectOutcome::Imported {
            summary: build_summary_for_imported(&item, &filename),
            message: "已从剪贴板收藏。".to_string(),
        },
        Ok(ImportOneOutcome::Duplicate) => ClipboardCollectOutcome::Duplicate {
            summary: build_summary_for_duplicate(),
            message: "这张图片已在素材库中。".to_string(),
        },
        Err(error) => ClipboardCollectOutcome::Failed {
            summary: None,
            reason: safe_error_reason(&error),
            message: "从剪贴板收藏失败。".to_string(),
        },
    }
}

fn build_summary_for_imported(item: &IndexedImage, filename: &str) -> ManagedImportSummary {
    ManagedImportSummary {
        success_count: 1,
        duplicate_count: 0,
        failed_count: 0,
        elapsed_ms: 0,
        items: vec![IndexedImage {
            name: filename.to_string(),
            path: item.path.clone(),
            extension: item.extension.clone(),
            width: item.width,
            height: item.height,
            size_bytes: item.size_bytes,
        }],
        failures: Vec::new(),
    }
}

fn build_summary_for_duplicate() -> ManagedImportSummary {
    ManagedImportSummary {
        success_count: 0,
        duplicate_count: 1,
        failed_count: 0,
        elapsed_ms: 0,
        items: Vec::new(),
        failures: Vec::new(),
    }
}

/// 把底层错误翻译成不暴露绝对路径的简短 reason。
fn safe_error_reason(error: &str) -> String {
    if error.contains("无法读取") || error.contains("文件") {
        return "图片文件不可读".to_string();
    }
    if error.contains("原子保存") || error.contains("rename") || error.contains("保存") {
        return "素材写入失败".to_string();
    }
    if error.contains("缩略图") {
        return "缩略图生成失败".to_string();
    }
    if error.contains("数据库") || error.contains("SQLite") {
        return "数据库写入失败".to_string();
    }
    if error.contains("目录") {
        return "素材库不可用".to_string();
    }
    "导入失败".to_string()
}

/// `clipboard-YYYYMMDD-HHmmss.png` 文件名。
fn clipboard_filename() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let secs_in_day = 86400u64;
    let day = now / secs_in_day;
    let sec = now % secs_in_day;
    let hh = sec / 3600;
    let mm = (sec % 3600) / 60;
    let ss = sec % 60;
    format!("clipboard-{:08}-{:02}{:02}{:02}.png", day, hh, mm, ss)
}
