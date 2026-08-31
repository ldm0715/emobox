//! 剪贴板收藏：从 Windows 剪贴板读取图像，调用现有 import 流水线落库。
//!
//! 设计决策见 D1 / D2 / D4：
//! - 不重新解码剪贴板字节；RGBA → DynamicImage → `AssetService::stage_dynamic_image`
//! - 默认所有 `read_image` 失败映射为 `Unavailable`；只有步骤 0 探针在 Windows 实机
//!   确认错误文本稳定时才激活 `Empty` 映射
//! - `Failed.reason` 不含绝对路径
//! - 不监听剪贴板变化；只有用户主动触发（菜单或 `Ctrl+Alt+S`）
//!
//! Phase 16：Windows 上按序尝试两条动画保真通道读 GIF 原始数据——
//! ①注册格式 `"image/gif"` 字节（Firefox）；②`CF_HDROP` 文件路径（QQ 复制
//! 图片 / 资源管理器复制 .gif，只读源文件）。都读不到（如 Chrome/Edge 只放
//! DIB 位图 + 网页 URL）降级原 RGBA→PNG 路径。

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use image::{AnimationDecoder, DynamicImage, codecs::gif::GifDecoder};
use serde::Serialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::{
    database::DatabaseState,
    scanner::IndexedImage,
    services::asset_service,
    services::import_service::{
        ImportContext, ImportOneOutcome, ImportService, ManagedImportSummary,
        PerceptualDuplicateInfo,
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
///
/// `download_web_gif` 是「联网下载网页 GIF」设置开关：开启时对剪贴板上的
/// 网页 GIF URL（Chrome/Edge 复制时只放首帧位图 + URL）联网下载原始字节
/// 保留动画；关闭时静态导入，但检测到网页动图会在 message 里提醒用户。
pub fn collect_image_from_clipboard<R: Runtime>(
    app: &AppHandle<R>,
    database_state: &DatabaseState,
    skip_perceptual_dedup: bool,
    download_web_gif: bool,
) -> ClipboardCollectOutcome {
    // 0. Windows 上优先走本地动画通道（"image/gif" 字节 / CF_HDROP 文件路径）。
    if let Some(outcome) = try_collect_gif_bytes(database_state, skip_perceptual_dedup) {
        return outcome;
    }

    // 0.5 网页 GIF：开启 → 下载原始字节导入；未开启 / 下载失败 → 降级 RGBA
    //     路径并携带提示（拼进 Imported 的 message，前端 toast 展示）。
    let web_gif_note =
        match attempt_web_gif(database_state, skip_perceptual_dedup, download_web_gif) {
            WebGifAttempt::Done(outcome) => return outcome,
            WebGifAttempt::Fallback(note) => note,
            WebGifAttempt::NotWebGif => None,
        };

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
    let filename = clipboard_filename("png");
    let context = ImportContext {
        database_path: database_state.database_path().to_path_buf(),
        emojis_directory: database_state.emojis_directory().to_path_buf(),
        thumbnails_directory: database_state.thumbnails_directory().to_path_buf(),
    };

    let result = ImportService::import_dynamic_image(
        &context,
        dyn_image,
        "png",
        &filename,
        skip_perceptual_dedup,
    );

    match result {
        Ok(ImportOneOutcome::Imported { item, .. }) => ClipboardCollectOutcome::Imported {
            summary: build_summary_for_imported(&item, &filename),
            message: web_gif_note.unwrap_or_else(|| "已从剪贴板收藏。".to_string()),
        },
        Ok(ImportOneOutcome::ExactDuplicate) => ClipboardCollectOutcome::Duplicate {
            summary: build_summary_for_duplicate(),
            message: "这张图片已在素材库中。".to_string(),
        },
        Ok(ImportOneOutcome::PerceptualDuplicate(info)) => ClipboardCollectOutcome::Duplicate {
            summary: build_summary_for_perceptual_duplicate(&info),
            message: format!(
                "检测到感知相似的图片（相似度 {}），请确认是否同一张。",
                info.hamming
            ),
        },
        Err(error) => ClipboardCollectOutcome::Failed {
            summary: None,
            reason: safe_error_reason(&error),
            message: "从剪贴板收藏失败。".to_string(),
        },
    }
}

/// 尝试保留动画导入剪贴板上的 GIF，两条通道按序尝试：
///
/// 1. 注册格式 `"image/gif"` 原始字节（Firefox 复制 GIF 时放置）；
/// 2. `CF_HDROP` 文件列表（QQ 复制图片 / 资源管理器复制 .gif 文件时放置）
///    —— 取第一个 `.gif` 路径**只读**源文件字节。QQ 的原图缓存在
///    `nt_qq\nt_data\Pic\...\Ori\*.gif`，动画由此保真。
///
/// 任何一步不满足（非 Windows / 两通道都读不到 / 字节非 GIF / 首帧不可解码）
/// 都返回 `None` —— 这是正常降级路径（Chrome/Edge 复制 GIF 只放 DIB 位图 +
/// 网页 URL，没有本地 GIF 数据），调用方静默走 RGBA 首帧管线，绝不报错。
/// 字节已验证合法后导入失败则如实返回 `Failed`（此时 RGBA 路径大概率也会
/// 因同样的磁盘/DB 问题失败）。
fn try_collect_gif_bytes(
    database_state: &DatabaseState,
    skip_perceptual_dedup: bool,
) -> Option<ClipboardCollectOutcome> {
    #[cfg(windows)]
    {
        // 通道 1：image/gif 原始字节；读不到 → 通道 2：CF_HDROP 文件路径。
        let (bytes, filename) =
            crate::platform::windows::clipboard_raw::read_registered_format_bytes("image/gif")
                .map(|bytes| (bytes, clipboard_filename("gif")))
                .or_else(gif_bytes_from_file_drop)?;
        if !asset_service::is_gif_bytes(&bytes) {
            log::debug!("[clipboard-collect] GIF 通道字节不是合法 GIF，降级 RGBA 路径");
            return None;
        }
        if !gif_first_frame_decodable(&bytes) {
            log::warn!("[clipboard-collect] GIF 字节无法解码首帧，降级 RGBA 路径");
            return None;
        }

        let context = ImportContext {
            database_path: database_state.database_path().to_path_buf(),
            emojis_directory: database_state.emojis_directory().to_path_buf(),
            thumbnails_directory: database_state.thumbnails_directory().to_path_buf(),
        };

        let result =
            ImportService::import_bytes(&context, bytes, "gif", &filename, skip_perceptual_dedup);

        Some(match result {
            Ok(ImportOneOutcome::Imported { item, .. }) => ClipboardCollectOutcome::Imported {
                summary: build_summary_for_imported(&item, &filename),
                message: "已从剪贴板收藏（GIF 动画已保留）。".to_string(),
            },
            Ok(ImportOneOutcome::ExactDuplicate) => ClipboardCollectOutcome::Duplicate {
                summary: build_summary_for_duplicate(),
                message: "这张 GIF 已在素材库中。".to_string(),
            },
            Ok(ImportOneOutcome::PerceptualDuplicate(info)) => ClipboardCollectOutcome::Duplicate {
                summary: build_summary_for_perceptual_duplicate(&info),
                message: format!(
                    "检测到感知相似的图片（相似度 {}），请确认是否同一张。",
                    info.hamming
                ),
            },
            Err(error) => ClipboardCollectOutcome::Failed {
                summary: None,
                reason: safe_error_reason(&error),
                message: "从剪贴板收藏失败。".to_string(),
            },
        })
    }
    #[cfg(not(windows))]
    {
        let _ = (database_state, skip_perceptual_dedup);
        None
    }
}

/// 通道 2：从 `CF_HDROP` 文件列表里找 `.gif` 文件，**只读**其字节。
/// 返回 `(字节, 原文件名)`；列表里没有 .gif / 文件不存在 / 读取失败 → None。
#[cfg(windows)]
fn gif_bytes_from_file_drop() -> Option<(Vec<u8>, String)> {
    let paths = crate::platform::windows::clipboard_raw::read_file_drop()?;
    let path = paths.iter().find(|path| {
        path.extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("gif"))
            && path.is_file()
    })?;
    let bytes = std::fs::read(path).ok()?;
    log::info!(
        "[clipboard-collect] 从 CF_HDROP 文件取得 GIF：{}",
        path.display()
    );
    let filename = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| clipboard_filename("gif"));
    Some((bytes, filename))
}

/// GIF 字节能否解码出首帧（防御损坏字节进入导入管线）。
fn gif_first_frame_decodable(bytes: &[u8]) -> bool {
    match GifDecoder::new(std::io::Cursor::new(bytes)) {
        Ok(decoder) => matches!(decoder.into_frames().next(), Some(Ok(_))),
        Err(_) => false,
    }
}

// ---- 通道 3：网页 GIF URL 联网下载（设置开关控制） ----

/// 网页 GIF 下载的大小上限：表情场景动图足够，防御异常大响应。
const WEB_GIF_MAX_BYTES: usize = 20 * 1024 * 1024;
const WEB_GIF_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const WEB_GIF_READ_TIMEOUT: Duration = Duration::from_secs(15);

/// 网页 GIF 通道的尝试结果。
enum WebGifAttempt {
    /// 剪贴板上没有网页 GIF URL（或非 Windows）→ 正常走 RGBA 路径，无提示。
    NotWebGif,
    /// 已下载并导入成功。
    Done(ClipboardCollectOutcome),
    /// 检测到网页 GIF 但未启用下载 / 下载失败 → 降级 RGBA 路径，附用户提示。
    Fallback(Option<String>),
}

/// 通道 3：剪贴板上有网页 GIF URL（Chrome/Edge 复制网页动图时只放首帧
/// 位图 + 源 URL）时，按设置决定是否联网下载原始字节保留动画。
fn attempt_web_gif(
    database_state: &DatabaseState,
    skip_perceptual_dedup: bool,
    enabled: bool,
) -> WebGifAttempt {
    #[cfg(windows)]
    {
        let Some(url) = find_web_gif_url() else {
            return WebGifAttempt::NotWebGif;
        };
        if !enabled {
            log::info!("[clipboard-collect] 检测到网页 GIF（未开启联网下载）：{url}");
            return WebGifAttempt::Fallback(Some(
                "检测到网页动图：已保存静态首帧；可在设置中开启「联网下载网页 GIF」保留动画。"
                    .to_string(),
            ));
        }

        log::info!("[clipboard-collect] 联网下载网页 GIF：{url}");
        let bytes = match download_web_gif(&url) {
            Ok(bytes) => {
                if asset_service::is_gif_bytes(&bytes) && gif_first_frame_decodable(&bytes) {
                    bytes
                } else {
                    return WebGifAttempt::Fallback(Some(
                        "网页 GIF 下载的内容不是有效动图，已保存静态首帧。".to_string(),
                    ));
                }
            }
            Err(error) => {
                log::warn!("[clipboard-collect] 网页 GIF 下载失败：{error}");
                return WebGifAttempt::Fallback(Some(format!(
                    "网页 GIF 下载失败（{}），已保存静态首帧。",
                    truncate_reason(&error)
                )));
            }
        };

        let filename = web_gif_filename(&url);
        let context = ImportContext {
            database_path: database_state.database_path().to_path_buf(),
            emojis_directory: database_state.emojis_directory().to_path_buf(),
            thumbnails_directory: database_state.thumbnails_directory().to_path_buf(),
        };
        let result =
            ImportService::import_bytes(&context, bytes, "gif", &filename, skip_perceptual_dedup);
        WebGifAttempt::Done(match result {
            Ok(ImportOneOutcome::Imported { item, .. }) => ClipboardCollectOutcome::Imported {
                summary: build_summary_for_imported(&item, &filename),
                message: "已从剪贴板收藏（联网下载 GIF，动画已保留）。".to_string(),
            },
            Ok(ImportOneOutcome::ExactDuplicate) => ClipboardCollectOutcome::Duplicate {
                summary: build_summary_for_duplicate(),
                message: "这张 GIF 已在素材库中。".to_string(),
            },
            Ok(ImportOneOutcome::PerceptualDuplicate(info)) => ClipboardCollectOutcome::Duplicate {
                summary: build_summary_for_perceptual_duplicate(&info),
                message: format!(
                    "检测到感知相似的图片（相似度 {}），请确认是否同一张。",
                    info.hamming
                ),
            },
            Err(error) => ClipboardCollectOutcome::Failed {
                summary: None,
                reason: safe_error_reason(&error),
                message: "从剪贴板收藏失败。".to_string(),
            },
        })
    }
    #[cfg(not(windows))]
    {
        let _ = (database_state, skip_perceptual_dedup, enabled);
        WebGifAttempt::NotWebGif
    }
}

/// 从剪贴板 HTML Format（`<img src>`）或 `UniformResourceLocatorW` 里找
/// 网页 GIF 的 URL。QQ 的 `file:///` 引用不是网页 URL（且其 CF_HDROP 通道
/// 已覆盖），这里只认 `http(s)://` 且路径以 `.gif` 结尾的链接。
#[cfg(windows)]
fn find_web_gif_url() -> Option<String> {
    use crate::platform::windows::clipboard_raw;
    if let Some(html_bytes) = clipboard_raw::read_registered_format_bytes("HTML Format") {
        let html = String::from_utf8_lossy(&html_bytes);
        if let Some(url) = extract_web_gif_url(&html) {
            return Some(url);
        }
    }
    if let Some(url_bytes) = clipboard_raw::read_registered_format_bytes("UniformResourceLocatorW")
    {
        let units: Vec<u16> = url_bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|chunk| u16::from_le_bytes(*chunk))
            .collect();
        let url = String::from_utf16_lossy(&units);
        let url = url.trim_end_matches('\0');
        if is_web_gif_url(url) {
            return Some(url.to_string());
        }
    }
    None
}

/// HTML 片段里找 `<img src="....gif">`。to_ascii_lowercase 保持字节长度，
/// 大小写副本的索引可直接用于原文切片。
fn extract_web_gif_url(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let img_start = lower.find("<img")?;
    let tag = &html[img_start..];
    let tag = tag.split('>').next().unwrap_or(tag);
    let tag_lower = tag.to_ascii_lowercase();
    for quote in ['"', '\''] {
        let marker = format!("src={quote}");
        if let Some(marker_pos) = tag_lower.find(&marker) {
            let value = &tag[marker_pos + marker.len()..];
            if let Some(end) = value.find(quote) {
                let url = &value[..end];
                if is_web_gif_url(url) {
                    return Some(url.to_string());
                }
            }
        }
    }
    None
}

/// 仅认 `http(s)://` 且路径（不含 query/fragment）以 `.gif` 结尾的链接 ——
/// 保守起步，避免给任意 URL 发请求。
fn is_web_gif_url(url: &str) -> bool {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return false;
    }
    url.split(['?', '#'])
        .next()
        .unwrap_or(url)
        .to_ascii_lowercase()
        .ends_with(".gif")
}

/// 联网下载 GIF 字节。连接/读取超时 + 大小上限防护；错误信息不含本地路径。
fn download_web_gif(url: &str) -> Result<Vec<u8>, String> {
    use std::io::Read;

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(WEB_GIF_CONNECT_TIMEOUT)
        .timeout_read(WEB_GIF_READ_TIMEOUT)
        .build();
    let response = agent
        .get(url)
        .set("User-Agent", "Mozilla/5.0 (compatible; EmoBox/0.1)")
        .call()
        .map_err(|error| format!("请求失败：{error}"))?;

    let mut bytes = Vec::new();
    response
        .into_reader()
        .take((WEB_GIF_MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("读取响应失败：{error}"))?;
    if bytes.len() > WEB_GIF_MAX_BYTES {
        return Err(format!(
            "文件超过 {} MB 上限",
            WEB_GIF_MAX_BYTES / 1024 / 1024
        ));
    }
    Ok(bytes)
}

/// 下载 URL 的最后一段作文件名（如 `gaE8...gif`），取不到用合成名。
fn web_gif_filename(url: &str) -> String {
    let last = url.split(['?', '#']).next().unwrap_or(url);
    let last = last.rsplit('/').next().unwrap_or(last);
    if !last.is_empty() && last.to_ascii_lowercase().ends_with(".gif") {
        return last.to_string();
    }
    clipboard_filename("gif")
}

/// 错误原因截断，防止长 URL 堆进 toast。
fn truncate_reason(reason: &str) -> String {
    const LIMIT: usize = 80;
    reason.chars().take(LIMIT).collect()
}

fn build_summary_for_imported(item: &IndexedImage, filename: &str) -> ManagedImportSummary {
    ManagedImportSummary {
        success_count: 1,
        exact_duplicate_count: 0,
        perceptual_duplicate_count: 0,
        failed_count: 0,
        elapsed_ms: 0,
        items: vec![IndexedImage {
            id: item.id,
            name: filename.to_string(),
            path: item.path.clone(),
            extension: item.extension.clone(),
            width: item.width,
            height: item.height,
            size_bytes: item.size_bytes,
        }],
        failures: Vec::new(),
        perceptual_duplicates: Vec::new(),
    }
}

fn build_summary_for_duplicate() -> ManagedImportSummary {
    ManagedImportSummary {
        success_count: 0,
        exact_duplicate_count: 1,
        perceptual_duplicate_count: 0,
        failed_count: 0,
        elapsed_ms: 0,
        items: Vec::new(),
        failures: Vec::new(),
        perceptual_duplicates: Vec::new(),
    }
}

fn build_summary_for_perceptual_duplicate(info: &PerceptualDuplicateInfo) -> ManagedImportSummary {
    ManagedImportSummary {
        success_count: 0,
        exact_duplicate_count: 0,
        perceptual_duplicate_count: 1,
        failed_count: 0,
        elapsed_ms: 0,
        items: Vec::new(),
        failures: Vec::new(),
        perceptual_duplicates: vec![info.clone()],
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

/// `clipboard-YYYYMMDD-HHmmss.<extension>` 文件名。
fn clipboard_filename(extension: &str) -> String {
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
    format!(
        "clipboard-{:08}-{:02}{:02}{:02}.{extension}",
        day, hh, mm, ss
    )
}

#[cfg(test)]
mod tests {
    use image::{DynamicImage, Rgba, RgbaImage};

    use super::{
        clipboard_filename, extract_web_gif_url, gif_first_frame_decodable, is_web_gif_url,
        web_gif_filename,
    };

    /// 生成单帧 GIF 字节（image crate 的 gif 编码器）。
    fn gif_bytes() -> Vec<u8> {
        let image =
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(8, 6, Rgba([90, 120, 200, 255])));
        let mut bytes = Vec::new();
        image
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Gif,
            )
            .expect("encode gif");
        bytes
    }

    #[test]
    fn gif_first_frame_decodable_accepts_real_gif() {
        let bytes = gif_bytes();
        assert!(gif_first_frame_decodable(&bytes));
    }

    #[test]
    fn gif_first_frame_decodable_rejects_garbage() {
        // 有合法 magic 但内容损坏。
        assert!(!gif_first_frame_decodable(b"GIF89a-broken"));
        // 完全非 GIF。
        assert!(!gif_first_frame_decodable(b"not a gif at all"));
        assert!(!gif_first_frame_decodable(&[]));
    }

    #[test]
    fn clipboard_filename_uses_requested_extension() {
        for extension in ["png", "gif"] {
            let name = clipboard_filename(extension);
            assert!(name.starts_with("clipboard-"), "name={name}");
            assert!(name.ends_with(&format!(".{extension}")), "name={name}");
            // 中段时间 HHmmss 各两位。
            let stem = name.trim_end_matches(&format!(".{extension}"));
            let time_part = stem.rsplit('-').next().expect("time part");
            assert_eq!(time_part.len(), 6, "name={name}");
        }
    }

    #[test]
    fn is_web_gif_url_only_accepts_http_gif_links() {
        assert!(is_web_gif_url("https://i.giphy.com/abc.gif"));
        assert!(is_web_gif_url("http://example.com/x.GIF")); // 大小写不敏感
        assert!(is_web_gif_url("https://example.com/x.gif?width=100#frag"));
        // 非 http(s) / 非 gif 结尾 → 拒绝。
        assert!(!is_web_gif_url("file:///C:/Users/a.gif"));
        assert!(!is_web_gif_url("https://example.com/x.png"));
        assert!(!is_web_gif_url("https://example.com/x.gif.html"));
        assert!(!is_web_gif_url("ftp://example.com/x.gif"));
        assert!(!is_web_gif_url(""));
    }

    #[test]
    fn extract_web_gif_url_finds_img_src() {
        // Chrome/Edge 复制图片时的 HTML Format 形态（含头部元信息 + 片段标记）。
        let html = "Version:0.9\r\nStartHTML:0000000117\r\n\
            <html><body>\r\n<!--StartFragment-->\
            <img src=\"https://i.giphy.com/gaE8.gif\" alt=\"sticker\">\
            <!--EndFragment--></body></html> ";
        assert_eq!(
            extract_web_gif_url(html),
            Some("https://i.giphy.com/gaE8.gif".to_string())
        );
        // 单引号属性。
        assert_eq!(
            extract_web_gif_url("<img src='https://a.com/b.gif'>"),
            Some("https://a.com/b.gif".to_string())
        );
        // src 不是 gif / 没有 img / file:// 引用（QQ）→ None。
        assert_eq!(
            extract_web_gif_url("<img src=\"https://a.com/b.png\">"),
            None
        );
        assert_eq!(
            extract_web_gif_url("<a href=\"https://a.com/b.gif\">link</a>"),
            None
        );
        assert_eq!(
            extract_web_gif_url("<img src=\"file:///C:/qq/Ori/x.gif\">"),
            None
        );
    }

    #[test]
    fn web_gif_filename_uses_url_last_segment() {
        assert_eq!(
            web_gif_filename("https://i.giphy.com/gaE8gsS9.gif?tp=webp"),
            "gaE8gsS9.gif"
        );
        assert_eq!(web_gif_filename("https://a.com/path/name.GIF"), "name.GIF");
        // URL 没有可用的 .gif 段 → 合成名兜底。
        let fallback = web_gif_filename("https://a.com/get?id=1");
        assert!(fallback.starts_with("clipboard-"));
        assert!(fallback.ends_with(".gif"));
    }
}
