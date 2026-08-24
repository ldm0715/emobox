use std::{fs, io::Cursor, path::Path};

use image::{AnimationDecoder, DynamicImage, ImageFormat, codecs::gif::GifDecoder};
use serde::Serialize;
use tauri::{AppHandle, image::Image};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SupportedFormat {
    Png,
    Jpeg,
    Webp,
    Gif,
}

impl SupportedFormat {
    fn from_path(path: &Path) -> Result<Self, String> {
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .ok_or_else(|| format!("图片缺少可识别的文件扩展名：{}", path.display()))?;

        match extension.as_str() {
            "png" => Ok(Self::Png),
            "jpg" | "jpeg" => Ok(Self::Jpeg),
            "webp" => Ok(Self::Webp),
            "gif" => Ok(Self::Gif),
            _ => Err(format!("暂不支持复制此图片格式：.{extension}")),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Png => "PNG",
            Self::Jpeg => "JPEG",
            Self::Webp => "WebP",
            Self::Gif => "GIF",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardCopyOutcome {
    pub source_format: String,
    pub clipboard_format: String,
    pub animation_preserved: Option<bool>,
    pub message: String,
}

struct PreparedClipboardImage {
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    outcome: ClipboardCopyOutcome,
}

pub fn copy_image(app: &AppHandle, path: &Path) -> Result<ClipboardCopyOutcome, String> {
    if !path.is_file() {
        return Err(format!("图片文件不存在：{}", path.display()));
    }

    let format = SupportedFormat::from_path(path)?;
    let bytes =
        fs::read(path).map_err(|error| format!("无法读取图片 {}：{error}", path.display()))?;
    let prepared = prepare_image(&bytes, format)
        .map_err(|error| format!("无法处理图片 {}：{error}", path.display()))?;

    let image = Image::new_owned(prepared.rgba, prepared.width, prepared.height);
    app.clipboard()
        .write_image(&image)
        .map_err(|error| format!("无法写入 Windows 图片剪贴板：{error}"))?;

    Ok(prepared.outcome)
}

fn prepare_image(bytes: &[u8], format: SupportedFormat) -> Result<PreparedClipboardImage, String> {
    let decoded = match format {
        SupportedFormat::Gif => decode_gif_first_frame(bytes)?,
        SupportedFormat::Png => decode_static(bytes, ImageFormat::Png)?,
        SupportedFormat::Jpeg => decode_static(bytes, ImageFormat::Jpeg)?,
        SupportedFormat::Webp => decode_static(bytes, ImageFormat::WebP)?,
    };
    let rgba = decoded.into_rgba8();
    let (width, height) = rgba.dimensions();

    let (animation_preserved, message) = match format {
        SupportedFormat::Gif => (Some(false), "GIF 已按首帧复制，动画不会保留。".to_string()),
        SupportedFormat::Webp => (
            None,
            "WebP 已转换为 Windows 兼容的静态图片数据。".to_string(),
        ),
        _ => (None, "图片数据已写入系统剪贴板。".to_string()),
    };

    Ok(PreparedClipboardImage {
        rgba: rgba.into_raw(),
        width,
        height,
        outcome: ClipboardCopyOutcome {
            source_format: format.label().to_string(),
            clipboard_format: "Windows native image".to_string(),
            animation_preserved,
            message,
        },
    })
}

fn decode_static(bytes: &[u8], format: ImageFormat) -> Result<DynamicImage, String> {
    image::load_from_memory_with_format(bytes, format).map_err(|error| error.to_string())
}

fn decode_gif_first_frame(bytes: &[u8]) -> Result<DynamicImage, String> {
    let decoder = GifDecoder::new(Cursor::new(bytes)).map_err(|error| error.to_string())?;
    let first_frame = decoder
        .into_frames()
        .next()
        .ok_or_else(|| "GIF 中没有可复制的画面。".to_string())?
        .map_err(|error| error.to_string())?;

    Ok(DynamicImage::ImageRgba8(first_frame.into_buffer()))
}

#[cfg(test)]
mod tests {
    use std::{io::Cursor, path::Path};

    use image::{
        Delay, DynamicImage, Frame, ImageFormat, Rgba, RgbaImage, codecs::gif::GifEncoder,
    };

    use super::{SupportedFormat, prepare_image};

    #[test]
    fn recognizes_supported_extensions_case_insensitively() {
        assert_eq!(
            SupportedFormat::from_path(Path::new("a.PNG")),
            Ok(SupportedFormat::Png)
        );
        assert_eq!(
            SupportedFormat::from_path(Path::new("a.JPEG")),
            Ok(SupportedFormat::Jpeg)
        );
        assert_eq!(
            SupportedFormat::from_path(Path::new("a.webp")),
            Ok(SupportedFormat::Webp)
        );
        assert_eq!(
            SupportedFormat::from_path(Path::new("a.GiF")),
            Ok(SupportedFormat::Gif)
        );
        assert!(SupportedFormat::from_path(Path::new("a.bmp")).is_err());
    }

    #[test]
    fn prepares_png_jpeg_and_webp_as_native_image_data() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_pixel(2, 3, Rgba([20, 40, 60, 255])));

        for (image_format, supported_format) in [
            (ImageFormat::Png, SupportedFormat::Png),
            (ImageFormat::Jpeg, SupportedFormat::Jpeg),
            (ImageFormat::WebP, SupportedFormat::Webp),
        ] {
            let mut encoded = Cursor::new(Vec::new());
            source
                .write_to(&mut encoded, image_format)
                .expect("test image should encode");

            let prepared = prepare_image(&encoded.into_inner(), supported_format)
                .expect("static image should decode");

            assert_eq!((prepared.width, prepared.height), (2, 3));
            assert_eq!(prepared.rgba.len(), 2 * 3 * 4);
            assert_eq!(prepared.outcome.clipboard_format, "Windows native image");
            assert_eq!(prepared.outcome.animation_preserved, None);
        }
    }
    #[test]
    fn gif_copy_uses_first_frame_and_reports_animation_loss() {
        let first = RgbaImage::from_pixel(1, 1, Rgba([255, 0, 0, 255]));
        let second = RgbaImage::from_pixel(1, 1, Rgba([0, 0, 255, 255]));
        let mut bytes = Vec::new();
        {
            let mut encoder = GifEncoder::new(&mut bytes);
            encoder
                .encode_frames(
                    [
                        Frame::from_parts(first, 0, 0, Delay::from_numer_denom_ms(100, 1)),
                        Frame::from_parts(second, 0, 0, Delay::from_numer_denom_ms(100, 1)),
                    ]
                    .into_iter(),
                )
                .expect("test GIF should encode");
        }

        let prepared = prepare_image(&bytes, SupportedFormat::Gif).expect("GIF should decode");

        assert_eq!(prepared.width, 1);
        assert_eq!(prepared.height, 1);
        assert_eq!(prepared.rgba, vec![255, 0, 0, 255]);
        assert_eq!(prepared.outcome.animation_preserved, Some(false));
    }
}
