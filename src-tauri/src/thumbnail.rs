use std::{
    fs::OpenOptions,
    io::{BufWriter, Cursor, Write},
    path::Path,
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use image::ImageFormat;

pub fn load_thumbnail_data_url(path: &Path, max_size: u32) -> Result<String, String> {
    if !path.is_file() {
        return Err(format!("图片文件不存在：{}", path.display()));
    }

    let image =
        image::open(path).map_err(|error| format!("无法解码图片 {}：{error}", path.display()))?;
    let thumbnail = image.thumbnail(max_size, max_size);
    let mut output = Cursor::new(Vec::new());

    thumbnail
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|error| format!("无法生成缩略图 {}：{error}", path.display()))?;

    Ok(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(output.into_inner())
    ))
}

pub fn write_thumbnail_png(
    source_path: &Path,
    destination_path: &Path,
    max_size: u32,
) -> Result<(), String> {
    let image = image::open(source_path)
        .map_err(|error| format!("无法解码图片 {}：{error}", source_path.display()))?;
    let thumbnail = image.thumbnail(max_size, max_size);
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination_path)
        .map_err(|error| format!("无法创建临时缩略图 {}：{error}", destination_path.display()))?;
    let mut writer = BufWriter::new(file);
    thumbnail
        .write_to(&mut writer, ImageFormat::Png)
        .map_err(|error| format!("无法生成缩略图 {}：{error}", source_path.display()))?;
    writer
        .flush()
        .map_err(|error| format!("无法写入缩略图 {}：{error}", destination_path.display()))?;
    writer
        .get_ref()
        .sync_all()
        .map_err(|error| format!("无法同步缩略图 {}：{error}", destination_path.display()))
}
