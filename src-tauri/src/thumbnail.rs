use std::{io::Cursor, path::Path};

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
