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
//!
//! 2026-09：`read_image`（arboard）失败后 Windows 上走原生回退链
//! （"PNG" 注册格式 → CF_DIBV5 → CF_DIB，`read_image_native_fallback`）。
//! arboard 两大缺口：剪贴板有 "PNG" 格式时只解它、解码失败不回退；
//! 无 PNG 时只认 CF_DIBV5、从不尝试 CF_DIB（QQ 静态图）。
//!
//! 2026-09（其二）：资源管理器复制图片**文件**时剪贴板只有 CF_HDROP 文件
//! 路径、没有任何位图格式，arboard 读不到 —— 新增通道 0.1 读非 GIF 受支持
//! 图片文件的原始字节导入（此前被误报「剪贴板中没有图片」）。

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use image::{AnimationDecoder, DynamicImage, codecs::gif::GifDecoder};
use serde::Serialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::{
    database::DatabaseState,
    scanner::{self, IndexedImage},
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
/// `target_group`（Phase 22）是前端发起收藏那一刻主窗口浏览的分组 id：
/// 有值时新导入的图片归入该分组（重复跳过的不入组），所有通道共用。
pub fn collect_image_from_clipboard<R: Runtime>(
    app: &AppHandle<R>,
    database_state: &DatabaseState,
    skip_perceptual_dedup: bool,
    download_web_gif: bool,
    target_group: Option<i64>,
) -> ClipboardCollectOutcome {
    // 0. Windows 上优先走本地动画通道（"image/gif" 字节 / CF_HDROP 文件路径）。
    if let Some(outcome) =
        try_collect_gif_bytes(database_state, skip_perceptual_dedup, target_group)
    {
        return outcome;
    }

    // 0.1 资源管理器复制非 GIF 图片文件：剪贴板只有 CF_HDROP 路径、无任何
    //     位图格式，arboard 读不到 —— 此前被误报「剪贴板中没有图片」。
    if let Some(outcome) =
        try_collect_file_drop_image(database_state, skip_perceptual_dedup, target_group)
    {
        return outcome;
    }

    // 0.5 网页 GIF：开启 → 下载原始字节导入；未开启 / 下载失败 → 降级 RGBA
    //     路径并携带提示（拼进 Imported 的 message，前端 toast 展示）。
    let web_gif_note = match attempt_web_gif(
        database_state,
        skip_perceptual_dedup,
        download_web_gif,
        target_group,
    ) {
        WebGifAttempt::Done(outcome) => return outcome,
        WebGifAttempt::Fallback(note) => note,
        WebGifAttempt::NotWebGif => None,
    };

    // 1. 读剪贴板：先走插件（arboard）解码；失败时 Windows 上原生回退
    //    （"PNG" 注册格式 → CF_DIBV5 → CF_DIB，见 read_image_native_fallback）。
    let dyn_image = match app.clipboard().read_image() {
        Ok(image) => {
            // 2. 构造 DynamicImage（不重新解码 — RGBA 已经是裸像素）
            let rgba = image.rgba().to_vec();
            let width = image.width();
            let height = image.height();
            if width == 0 || height == 0 || rgba.is_empty() {
                return ClipboardCollectOutcome::Empty {
                    message: "剪贴板中没有图片。".to_string(),
                };
            }
            match image::RgbaImage::from_raw(width, height, rgba) {
                Some(buf) => DynamicImage::ImageRgba8(buf),
                None => {
                    return ClipboardCollectOutcome::Unavailable {
                        reason: "RGBA 尺寸与像素长度不匹配".to_string(),
                        message: "无法处理剪贴板图片。".to_string(),
                    };
                }
            }
        }
        Err(error) => match read_image_native_fallback() {
            Some(fallback) => fallback,
            None => return classify_clipboard_read_error(&error.to_string()),
        },
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
        target_group,
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

/// arboard（tauri 剪贴板插件）`read_image` 失败后的原生回退，按序尝试：
///
/// 1. 注册格式 `"PNG"` 原始字节（浏览器 / 截图工具常放；arboard 只解它且
///    解码失败不回退 —— 这里用自家 image 流水线再解一次，失败还有下级兜底）；
/// 2. `CF_DIBV5`（标准位图通道，BITMAPV5HEADER）；
/// 3. `CF_DIB`（老 DIB，QQ 复制静态图只放这个 —— arboard 从不尝试，此前
///    被误报「剪贴板中没有图片」）。
///
/// 任一成功 → `Some(DynamicImage)` 走既有 RGBA 导入路径；非 Windows /
/// 全部失败 → `None`，调用方走既有错误分类（D2）。
fn read_image_native_fallback() -> Option<DynamicImage> {
    #[cfg(windows)]
    {
        if let Some(bytes) =
            crate::platform::windows::clipboard_raw::read_registered_format_bytes("PNG")
            && let Some(image) = decode_clipboard_png(&bytes)
        {
            log::debug!("[clipboard-collect] 原生回退：PNG 注册格式解码成功");
            return Some(image);
        }
        if let Some(bytes) = crate::platform::windows::clipboard_raw::read_standard_format_bytes(
            windows::Win32::System::Ole::CF_DIBV5.0 as u32,
        ) && let Some(image) = decode_clipboard_dib(&bytes)
        {
            log::debug!("[clipboard-collect] 原生回退：CF_DIBV5 解码成功");
            return Some(image);
        }
        if let Some(bytes) = crate::platform::windows::clipboard_raw::read_standard_format_bytes(
            windows::Win32::System::Ole::CF_DIB.0 as u32,
        ) && let Some(image) = decode_clipboard_dib(&bytes)
        {
            log::debug!("[clipboard-collect] 原生回退：CF_DIB 解码成功");
            return Some(image);
        }
        None
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// D2：arboard 错误文本分类。
///
/// "clipboard is empty" / "not available in the requested format"（phase5
/// 实机探针确认的"剪贴板没图片"文本）→ `Empty`；其余（含
/// ConversionFailure 的"could not be converted..."解码失败文本）→
/// `Unavailable`。如果将来 arboard 升级改变错误文本，需重新评估。
fn classify_clipboard_read_error(text: &str) -> ClipboardCollectOutcome {
    if text.contains("clipboard is empty") || text.contains("not available in the requested format")
    {
        ClipboardCollectOutcome::Empty {
            message: "剪贴板中没有图片。".to_string(),
        }
    } else {
        ClipboardCollectOutcome::Unavailable {
            reason: text.to_string(),
            message: "无法读取剪贴板图片。".to_string(),
        }
    }
}

/// PNG 注册格式字节 → `DynamicImage`。
fn decode_clipboard_png(bytes: &[u8]) -> Option<DynamicImage> {
    image::load_from_memory_with_format(bytes, image::ImageFormat::Png).ok()
}

/// CF_DIB / CF_DIBV5 字节 → `DynamicImage`。
///
/// 绝大多数 DIB（含 CF_DIB 的 BITMAPINFOHEADER 各 bpp）直接交给 image crate
/// 的 `BmpDecoder`（原生支持无文件头的裸 DIB）。**例外**：32bpp + BI_RGB +
/// alphaMask=0xff000000（Chrome/Electron 类生产者；文档说 BI_RGB 高字节
/// "未使用"，实际这些生产者在 alpha 通道放了透明度）走 [`decode_dib_32bpp_bgra`]
/// 手解 —— image 0.25.10 对 V3/V4/V5 头 + BI_BITFIELDS 会跳过头后 12 字节
/// （假定头后还有一份 RGB 掩码），真实数据像素紧跟头，arboard 的
/// `maybe_tweak_header` 改 BI_BITFIELDS 方案在当前 image 版本下解不开它自家
/// 的 Chrome 测试样本（实测复现）。任何失败 → `None` 静默降级。
fn decode_clipboard_dib(bytes: &[u8]) -> Option<DynamicImage> {
    // BITMAPINFOHEADER 最小 40 字节。
    if bytes.len() < 40 {
        return None;
    }
    // 手解失败（尺寸异常等）→ 落到 BmpDecoder 兜底（alpha 会丢，好过没有）。
    if has_dib_alpha_mask(bytes)
        && let Some(image) = decode_dib_32bpp_bgra(bytes)
    {
        return Some(force_opaque_if_alpha_all_zero(image));
    }
    let decoder =
        image::codecs::bmp::BmpDecoder::new_without_file_header(std::io::Cursor::new(bytes))
            .ok()?;
    let decoded = DynamicImage::from_decoder(decoder).ok()?;
    Some(force_opaque_if_alpha_all_zero(decoded))
}

/// 32bpp + BI_RGB + alphaMask=0xff000000（BITMAPV3/V4/V5 头，头长 ≥56）？
/// alphaMask 在头内偏移 52；BITMAPINFOHEADER（40 字节）没有掩码字段。
///
/// 头字段偏移：bV5Size=0 / bV5Width=4 / bV5Height=8 / bV5BitCount=14 /
/// bV5Compression=16 / bV5AlphaMask=52。
fn has_dib_alpha_mask(bytes: &[u8]) -> bool {
    const BI_RGB: u32 = 0;
    let header_size = read_le_u32(bytes, 0) as usize;
    header_size >= 56
        && header_size <= bytes.len()
        && read_le_u16(bytes, 14) == 32
        && read_le_u32(bytes, 16) == BI_RGB
        && read_le_u32(bytes, 52) == 0xff00_0000
}

/// 32bpp BI_RGB DIB 手解：像素是 BGRA（4 字节/像素，行天然 4 字节对齐），
/// 正高度 = bottom-up（数据最后一行是图像第一行），负高度 = top-down。
/// 像素数据紧跟 DIB 头（`bV?Size` 字节）之后。
fn decode_dib_32bpp_bgra(bytes: &[u8]) -> Option<DynamicImage> {
    // 与 BmpDecoder 的尺寸上限一致，防异常头 OOM。
    const MAX_DIM: u32 = 65535;
    let width = read_le_u32(bytes, 4);
    let height_raw = read_le_u32(bytes, 8) as i32;
    if width == 0 || width > MAX_DIM || height_raw == 0 || height_raw == i32::MIN {
        return None;
    }
    let height = height_raw.unsigned_abs();
    if height > MAX_DIM {
        return None;
    }
    let top_down = height_raw < 0;
    let header_size = read_le_u32(bytes, 0) as usize;
    let row_len = (width as usize) * 4;
    let expected = row_len.checked_mul(height as usize)?;
    let pixels = bytes.get(header_size..)?;
    if pixels.len() < expected {
        return None;
    }
    let mut buffer = image::RgbaImage::new(width, height);
    for row in 0..height as usize {
        let source_row = if top_down {
            row
        } else {
            height as usize - 1 - row
        };
        let row_start = source_row * row_len;
        for column in 0..width as usize {
            let offset = row_start + column * 4;
            let blue = pixels[offset];
            let green = pixels[offset + 1];
            let red = pixels[offset + 2];
            let alpha = pixels[offset + 3];
            buffer.put_pixel(
                column as u32,
                row as u32,
                image::Rgba([red, green, blue, alpha]),
            );
        }
    }
    Some(DynamicImage::ImageRgba8(buffer))
}

/// 32bpp DIB 的 alpha 高字节有些生产者恒填 0（假透明）；解码结果 alpha 全 0
/// 时按不透明处理（全部置 255），防止导入全透明 PNG。有任一非 0 alpha 或
/// 空图 → 原样返回。
fn force_opaque_if_alpha_all_zero(image: DynamicImage) -> DynamicImage {
    let rgba = image.to_rgba8();
    if rgba.dimensions() == (0, 0) || rgba.pixels().any(|pixel| pixel.0[3] != 0) {
        return image;
    }
    let mut fixed = rgba;
    for pixel in fixed.pixels_mut() {
        pixel.0[3] = 255;
    }
    DynamicImage::ImageRgba8(fixed)
}

fn read_le_u16(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

fn read_le_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
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
    target_group: Option<i64>,
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

        Some(import_bytes_to_outcome(
            &context,
            bytes,
            "gif",
            &filename,
            skip_perceptual_dedup,
            target_group,
            "已从剪贴板收藏（GIF 动画已保留）。".to_string(),
        ))
    }
    #[cfg(not(windows))]
    {
        let _ = (database_state, skip_perceptual_dedup, target_group);
        None
    }
}

/// `ImportService::import_bytes` 结果 → `ClipboardCollectOutcome`（GIF 动画
/// 通道 0 与 CF_HDROP 文件通道 0.1 共用的映射）。
fn import_bytes_to_outcome(
    context: &ImportContext,
    bytes: Vec<u8>,
    file_extension: &str,
    filename: &str,
    skip_perceptual_dedup: bool,
    target_group: Option<i64>,
    imported_message: String,
) -> ClipboardCollectOutcome {
    match ImportService::import_bytes(
        context,
        bytes,
        file_extension,
        filename,
        skip_perceptual_dedup,
        target_group,
    ) {
        Ok(ImportOneOutcome::Imported { item, .. }) => ClipboardCollectOutcome::Imported {
            summary: build_summary_for_imported(&item, filename),
            message: imported_message,
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

/// 通道 0.1：`CF_HDROP` 非 GIF 图片文件（资源管理器复制 .png / .jpg / .webp
/// 等**文件**时，剪贴板只有文件路径、没有任何位图格式，arboard 读不到 ——
/// 此前被误报「剪贴板中没有图片」）。取第一个受支持扩展名的文件，**只读**
/// 源文件字节，按原始字节导入（格式/质量不重编码；GIF 由动画通道 0 处理，
/// 此处排除）。列表无此类文件 → `None` 降级既有路径，绝不报错。
fn try_collect_file_drop_image(
    database_state: &DatabaseState,
    skip_perceptual_dedup: bool,
    target_group: Option<i64>,
) -> Option<ClipboardCollectOutcome> {
    #[cfg(windows)]
    {
        let (bytes, filename, extension) = static_image_bytes_from_file_drop()?;
        // 防御扩展名与内容不符（如 .png 实为文本）：解不出图 → 降级既有路径。
        if image::load_from_memory(&bytes).is_err() {
            log::warn!("[clipboard-collect] CF_HDROP 文件字节无法解码为图片，降级既有路径");
            return None;
        }

        let context = ImportContext {
            database_path: database_state.database_path().to_path_buf(),
            emojis_directory: database_state.emojis_directory().to_path_buf(),
            thumbnails_directory: database_state.thumbnails_directory().to_path_buf(),
        };

        Some(import_bytes_to_outcome(
            &context,
            bytes,
            &extension,
            &filename,
            skip_perceptual_dedup,
            target_group,
            "已从剪贴板收藏。".to_string(),
        ))
    }
    #[cfg(not(windows))]
    {
        let _ = (database_state, skip_perceptual_dedup, target_group);
        None
    }
}

/// 从 `CF_HDROP` 文件列表取第一个受支持的非 GIF 图片文件，**只读**其字节。
/// 返回 `(字节, 原文件名, 小写扩展名)`；列表无此类文件 / 文件不存在 / 读取
/// 失败 → None。
#[cfg(windows)]
fn static_image_bytes_from_file_drop() -> Option<(Vec<u8>, String, String)> {
    let paths = crate::platform::windows::clipboard_raw::read_file_drop()?;
    let (path, extension) = paths.iter().find_map(|path| {
        static_drop_extension(path)
            .filter(|_| path.is_file())
            .map(|extension| (path, extension))
    })?;
    let bytes = std::fs::read(path).ok()?;
    log::info!(
        "[clipboard-collect] 从 CF_HDROP 文件取得图片：{}",
        path.display()
    );
    let filename = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| clipboard_filename(&extension));
    Some((bytes, filename, extension))
}

/// CF_HDROP 静态图片通道接受的扩展名：`scanner::supported_extension` 白名单
/// 去掉 GIF（GIF 交给动画通道 0 保动画优先）。
#[cfg(windows)]
fn static_drop_extension(path: &std::path::Path) -> Option<String> {
    match scanner::supported_extension(path) {
        Some(extension) if extension != "gif" => Some(extension),
        _ => None,
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
    target_group: Option<i64>,
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
        let result = ImportService::import_bytes(
            &context,
            bytes,
            "gif",
            &filename,
            skip_perceptual_dedup,
            target_group,
        );
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
        let _ = (database_state, skip_perceptual_dedup, enabled, target_group);
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
    use image::{DynamicImage, GenericImageView, Rgba, RgbaImage};

    use super::{
        clipboard_filename, decode_clipboard_dib, decode_clipboard_png, extract_web_gif_url,
        gif_first_frame_decodable, is_web_gif_url, static_drop_extension, web_gif_filename,
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

    // ---- 原生回退解码（read_image 失败后的 PNG → DIBV5 → DIB 链）----

    fn push_u32(bytes: &mut Vec<u8>, value: u32) {
        bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn push_u16(bytes: &mut Vec<u8>, value: u16) {
        bytes.extend_from_slice(&value.to_le_bytes());
    }

    /// 40 字节 BITMAPINFOHEADER（24bpp BI_RGB，bottom-up）+ 1 像素，行对齐到 4 字节。
    fn dib_24bpp_1x1(b: u8, g: u8, r: u8) -> Vec<u8> {
        let mut bytes = Vec::new();
        push_u32(&mut bytes, 40); // biSize
        push_u32(&mut bytes, 1); // biWidth
        push_u32(&mut bytes, 1); // biHeight（正 = bottom-up）
        push_u16(&mut bytes, 1); // biPlanes
        push_u16(&mut bytes, 24); // biBitCount
        push_u32(&mut bytes, 0); // BI_RGB
        push_u32(&mut bytes, 0); // biSizeImage（0 = 由解码器按尺寸推）
        push_u32(&mut bytes, 0); // biXPelsPerMeter
        push_u32(&mut bytes, 0); // biYPelsPerMeter
        push_u32(&mut bytes, 0); // biClrUsed
        push_u32(&mut bytes, 0); // biClrImportant
        bytes.extend_from_slice(&[b, g, r, 0]); // BGR + 1 字节行对齐
        bytes
    }

    /// 124 字节 BITMAPV5HEADER（32bpp BI_RGB + alphaMask=0xff000000，Chrome 形态）
    /// + 1 像素 BGRA。
    fn dibv5_32bpp_1x1(b: u8, g: u8, r: u8, a: u8) -> Vec<u8> {
        let mut bytes = Vec::new();
        push_u32(&mut bytes, 124); // bV5Size
        push_u32(&mut bytes, 1); // bV5Width
        push_u32(&mut bytes, 1); // bV5Height
        push_u16(&mut bytes, 1); // bV5Planes
        push_u16(&mut bytes, 32); // bV5BitCount
        push_u32(&mut bytes, 0); // BI_RGB —— 等待 tweak 改 BI_BITFIELDS
        push_u32(&mut bytes, 4); // bV5SizeImage
        push_u32(&mut bytes, 0); // XPelsPerMeter
        push_u32(&mut bytes, 0); // YPelsPerMeter
        push_u32(&mut bytes, 0); // ClrUsed
        push_u32(&mut bytes, 0); // ClrImportant
        push_u32(&mut bytes, 0); // RedMask（tweak 补默认）
        push_u32(&mut bytes, 0); // GreenMask
        push_u32(&mut bytes, 0); // BlueMask
        push_u32(&mut bytes, 0xff00_0000); // AlphaMask —— 触发 tweak
        bytes.resize(124, 0); // 其余 V5 字段（CSType/端点等）置 0
        bytes.extend_from_slice(&[b, g, r, a]);
        bytes
    }

    #[test]
    fn decode_clipboard_png_roundtrip() {
        let image =
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(8, 6, Rgba([90, 120, 200, 255])));
        let mut bytes = Vec::new();
        image
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .expect("encode png");
        let decoded = decode_clipboard_png(&bytes).expect("decode png");
        assert_eq!(decoded.dimensions(), (8, 6));
        // 非 PNG 字节 → None。
        assert!(decode_clipboard_png(b"not a png").is_none());
    }

    #[test]
    fn decode_clipboard_dib_decodes_24bpp_rgb() {
        let dib = dib_24bpp_1x1(10, 20, 30); // BGR 序
        let image = decode_clipboard_dib(&dib).expect("decode 24bpp DIB");
        assert_eq!(image.dimensions(), (1, 1));
        assert_eq!(image.to_rgba8().get_pixel(0, 0), &Rgba([30, 20, 10, 255]));
        // 过短输入（< BITMAPINFOHEADER 40 字节）→ None。
        assert!(decode_clipboard_dib(&[0u8; 39]).is_none());
    }

    #[test]
    fn decode_clipboard_dibv5_keeps_alpha_via_tweak() {
        // Chrome/Electron 形态：32bpp BI_RGB + alphaMask=0xff000000，走手解
        // BGRA 路径保住 alpha（BmpDecoder 的 BI_RGB 路径会丢 alpha）。
        let dib = dibv5_32bpp_1x1(10, 20, 30, 200);
        let image = decode_clipboard_dib(&dib).expect("decode DIBV5");
        assert_eq!(image.to_rgba8().get_pixel(0, 0), &Rgba([30, 20, 10, 200]));
    }

    #[test]
    fn decode_clipboard_dibv5_handles_top_down() {
        // 负高度 = top-down（数据第一行就是图像第一行）。
        let mut dib = dibv5_32bpp_1x1(10, 20, 30, 200);
        // bV5Height（偏移 8）改成 -1。
        dib[8..12].copy_from_slice(&(-1i32).to_le_bytes());
        let image = decode_clipboard_dib(&dib).expect("decode top-down DIBV5");
        assert_eq!(image.to_rgba8().get_pixel(0, 0), &Rgba([30, 20, 10, 200]));
    }

    /// arboard 3.6.1 `windows.rs::chrome_dibv5` 测试的原始 Chrome DIBV5 样本
    /// （5x5、32bpp BI_RGB + alphaMask=0xff000000、像素紧跟 124 字节头）。
    /// arboard 自己的 maybe_tweak_header + BmpDecoder 方案在 image 0.25.10 下
    /// 解不开这份数据（头后无 12 字节掩码区会被跳坏）——我们走手解 BGRA。
    #[test]
    fn decode_clipboard_dib_decodes_arboard_chrome_sample() {
        let raw: Vec<u8> = vec![
            124, 0, 0, 0, 5, 0, 0, 0, 5, 0, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255,
            32, 110, 105, 87, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 32, 38, 145, 192, 38, 65, 111, 158, 46, 73, 68,
            107, 50, 73, 50, 92, 55, 79, 55, 100, 31, 46, 139, 190, 41, 76, 100, 152, 49, 81, 60,
            110, 53, 83, 53, 108, 60, 91, 60, 118, 32, 59, 131, 187, 44, 86, 89, 150, 51, 89, 56,
            121, 57, 95, 57, 127, 63, 103, 63, 139, 35, 71, 122, 186, 46, 95, 76, 150, 52, 99, 54,
            136, 59, 105, 59, 146, 65, 113, 65, 156, 37, 86, 109, 184, 46, 103, 63, 155, 52, 107,
            53, 152, 60, 114, 60, 162, 68, 123, 68, 174,
        ];
        let image = decode_clipboard_dib(&raw).expect("decode arboard chrome sample");
        assert_eq!(image.dimensions(), (5, 5));
        // 期望值取自 arboard 测试的 EXPECTED（bottom-up 首行 + 末行末像素）。
        assert_eq!(image.to_rgba8().get_pixel(0, 0), &Rgba([109, 86, 37, 184]));
        assert_eq!(image.to_rgba8().get_pixel(4, 4), &Rgba([55, 79, 55, 100]));
    }

    #[test]
    fn decode_clipboard_dib_resolves_opaque_alpha() {
        // 40 字节头的 32bpp BI_RGB（无 alpha 掩码）：无论 image crate 丢弃
        // alpha 高字节还是解出全 0 alpha，最终都应不透明。
        let mut bytes = Vec::new();
        push_u32(&mut bytes, 40); // biSize
        push_u32(&mut bytes, 1); // biWidth
        push_u32(&mut bytes, 1); // biHeight
        push_u16(&mut bytes, 1); // biPlanes
        push_u16(&mut bytes, 32); // biBitCount
        push_u32(&mut bytes, 0); // BI_RGB
        push_u32(&mut bytes, 4); // biSizeImage
        push_u32(&mut bytes, 0); // XPelsPerMeter
        push_u32(&mut bytes, 0); // YPelsPerMeter
        push_u32(&mut bytes, 0); // ClrUsed
        push_u32(&mut bytes, 0); // ClrImportant
        bytes.extend_from_slice(&[10, 20, 30, 0]); // BGRA，alpha 高字节 = 0
        let image = decode_clipboard_dib(&bytes).expect("decode 32bpp DIB");
        assert_eq!(image.to_rgba8().get_pixel(0, 0), &Rgba([30, 20, 10, 255]));
    }

    #[test]
    fn tweak_dibv5_alpha_header_flips_bitfields() {
        // tweak 方案已移除：image 0.25.10 对 V5 头 + BI_BITFIELDS 会跳过头后
        // 12 字节，arboard 同款方案解不开它自家的 Chrome 样本（由
        // decode_clipboard_dib_decodes_arboard_chrome_sample 锁定手解路径）。
        // 此占位断言防止误恢复 tweak。
        let dib = dibv5_32bpp_1x1(0, 0, 0, 255);
        assert!(decode_clipboard_dib(&dib).is_some());
    }

    // ---- 通道 0.1：CF_HDROP 非 GIF 图片文件 ----

    #[cfg(windows)]
    #[test]
    fn static_drop_extension_accepts_supported_non_gif() {
        for name in ["a.png", "b.jpg", "c.jpeg", "d.webp", "E.PNG", "F.JpG"] {
            assert!(
                static_drop_extension(std::path::Path::new(name)).is_some(),
                "name={name}"
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn static_drop_extension_rejects_gif_and_unsupported() {
        // GIF 由动画通道 0 处理（保动画优先），这里必须排除。
        assert!(static_drop_extension(std::path::Path::new("a.gif")).is_none());
        for name in ["a.txt", "b.mp4", "noext"] {
            assert!(
                static_drop_extension(std::path::Path::new(name)).is_none(),
                "name={name}"
            );
        }
    }
}
