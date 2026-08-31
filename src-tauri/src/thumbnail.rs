use std::{
    fs::{self, OpenOptions},
    io::{BufWriter, Cursor, Write},
    path::Path,
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use image::{
    DynamicImage, ExtendedColorType, ImageEncoder, ImageFormat,
    codecs::png::{CompressionType, FilterType, PngEncoder},
};

/// 缩略图 data URL。**磁盘缓存优先**：`cached_thumbnail_path` 存在且非空 →
/// 直接 base64，不重编码；缺失 / 为空 → 解码原图生成缩略图（回退路径，逐次生成）。
pub fn load_thumbnail_data_url(
    original_path: &Path,
    cached_thumbnail_path: Option<&Path>,
    max_size: u32,
) -> Result<String, String> {
    if let Some(thumbnail) = cached_thumbnail_path
        && thumbnail.is_file()
        && let Ok(metadata) = fs::metadata(thumbnail)
        && metadata.len() > 0
    {
        let bytes = fs::read(thumbnail)
            .map_err(|error| format!("无法读取缩略图 {}：{error}", thumbnail.display()))?;
        return Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)));
    }

    if !original_path.is_file() {
        return Err(format!("图片文件不存在：{}", original_path.display()));
    }
    let image = image::open(original_path)
        .map_err(|error| format!("无法解码图片 {}：{error}", original_path.display()))?;
    let thumbnail = image.thumbnail(max_size, max_size);
    let mut output = Cursor::new(Vec::new());

    thumbnail
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|error| format!("无法生成缩略图 {}：{error}", original_path.display()))?;

    Ok(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(output.into_inner())
    ))
}

/// 把已解码图写成 PNG 缩略图（Fast 压缩），供导入时落磁盘缓存。
///
/// 不再做 `sync_all`：保留 `flush`（用户态 → OS）。缩略图可重建、非承重，
/// 断电窗口与 DB 的 WAL `synchronous=NORMAL` 取舍一致。
pub fn write_thumbnail_png(
    source: &DynamicImage,
    destination_path: &Path,
    max_size: u32,
) -> Result<(), String> {
    let thumbnail = source.thumbnail(max_size, max_size);
    let rgba = thumbnail.to_rgba8();
    let (width, height) = rgba.dimensions();
    let bytes = rgba.into_raw();

    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination_path)
        .map_err(|error| format!("无法创建临时缩略图 {}：{error}", destination_path.display()))?;
    let mut writer = BufWriter::new(file);
    let encoder =
        PngEncoder::new_with_quality(&mut writer, CompressionType::Fast, FilterType::Adaptive);
    encoder
        .write_image(&bytes, width, height, ExtendedColorType::Rgba8)
        .map_err(|error| format!("无法生成缩略图：{error}"))?;
    writer
        .flush()
        .map_err(|error| format!("无法写入缩略图 {}：{error}", destination_path.display()))?;
    Ok(())
}
