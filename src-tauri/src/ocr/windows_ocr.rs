//! Windows.Media.Ocr 本地识别（Phase 32）。
//!
//! 完全离线：识别在 Windows 内置 OCR 引擎里完成，图片字节不出进程。
//! 中文识别依赖系统语言包（设置 → 时间和语言 → 语言 → 中文 → 可选功能
//! 「文字识别」）；未安装时 `create_engine` 失败，上层按"引擎不可用"处理
//! （warn + 跳过），不影响导入。
//!
//! WinRT async 统一用 `IAsyncOperation::get()` 阻塞等待——本模块只在
//! `spawn_blocking` 线程里调用，阻塞无副作用。

use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapDecoder, BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

/// 枚举系统当前可用于 OCR 的语言标签（如 "zh-Hans-CN"），供设置页展示。
pub fn available_language_tags() -> Vec<String> {
    let Ok(languages) = OcrEngine::AvailableRecognizerLanguages() else {
        return Vec::new();
    };
    languages
        .into_iter()
        .filter_map(|language| language.LanguageTag().ok().map(|tag| tag.to_string()))
        .collect()
}

/// OCR 引擎当前是否可用（未装含「文字识别」的语言包时为 false）。
pub fn engine_available() -> bool {
    create_engine().is_ok()
}

/// 尝试创建 OCR 引擎：优先用户配置文件语言，失败（未装语言包 / 无 OCR 组件）
/// 再从全部可用语言里按 zh → en → 任意 的顺序挑。
fn create_engine() -> Result<OcrEngine, String> {
    // WinRT 的 Try* 约定失败时可能返回 null 而不是抛错，用一次廉价调用验真。
    if let Ok(engine) = OcrEngine::TryCreateFromUserProfileLanguages()
        && engine.RecognizerLanguage().is_ok()
    {
        return Ok(engine);
    }
    let languages = OcrEngine::AvailableRecognizerLanguages()
        .map_err(|error| format!("无法枚举 Windows OCR 可用语言：{error}"))?
        .into_iter()
        .collect::<Vec<_>>();
    if languages.is_empty() {
        return Err(
            "Windows OCR 不可用：未安装含「文字识别」功能的语言包（设置 → 时间和语言 → 语言）"
                .to_string(),
        );
    }
    for prefix in ["zh", "en"] {
        if let Some(language) = languages
            .iter()
            .find(|language| language_tag(language).starts_with(prefix))
            && let Ok(engine) = OcrEngine::TryCreateFromLanguage(language)
            && engine.RecognizerLanguage().is_ok()
        {
            return Ok(engine);
        }
    }
    OcrEngine::TryCreateFromLanguage(&languages[0])
        .map_err(|error| format!("Windows OCR 引擎创建失败：{error}"))
}

fn language_tag(language: &Language) -> String {
    language
        .LanguageTag()
        .map(|tag| tag.to_string())
        .unwrap_or_default()
}

/// 识别一张 PNG（RGBA8，由调用方统一重编码），返回按行的文本。
pub fn recognize_lines(png_bytes: &[u8]) -> Result<Vec<String>, String> {
    let engine = create_engine()?;
    let bitmap = decode_png_to_bitmap(png_bytes)?;
    let result = engine
        .RecognizeAsync(&bitmap)
        .and_then(|operation| operation.get())
        .map_err(|error| format!("OCR 识别失败：{error}"))?;
    let lines = result
        .Lines()
        .map_err(|error| format!("读取 OCR 行失败：{error}"))?;
    Ok(lines
        .into_iter()
        .filter_map(|line| line.Text().ok().map(|text| text.to_string()))
        .collect())
}

fn decode_png_to_bitmap(png_bytes: &[u8]) -> Result<SoftwareBitmap, String> {
    let stream =
        InMemoryRandomAccessStream::new().map_err(|error| format!("创建内存流失败：{error}"))?;
    let writer = DataWriter::CreateDataWriter(&stream)
        .map_err(|error| format!("创建 DataWriter 失败：{error}"))?;
    writer
        .WriteBytes(png_bytes)
        .map_err(|error| format!("写入图片数据失败：{error}"))?;
    writer
        .StoreAsync()
        .and_then(|operation| operation.get())
        .map_err(|error| format!("写入内存流失败：{error}"))?;
    writer
        .FlushAsync()
        .and_then(|operation| operation.get())
        .map_err(|error| format!("刷新内存流失败：{error}"))?;
    // 不 detach 的话 writer drop 时会关闭底层流，解码器还没读。
    let _ = writer.DetachStream();
    stream
        .Seek(0)
        .map_err(|error| format!("重定位流失败：{error}"))?;

    let decoder = BitmapDecoder::CreateAsync(&stream)
        .and_then(|operation| operation.get())
        .map_err(|error| format!("解码 PNG 失败：{error}"))?;
    let bitmap = decoder
        .GetSoftwareBitmapAsync()
        .and_then(|operation| operation.get())
        .map_err(|error| format!("读取解码位图失败：{error}"))?;
    let pixel_format = bitmap
        .BitmapPixelFormat()
        .map_err(|error| format!("读取位图格式失败：{error}"))?;
    // OcrEngine 只认 Bgra8 / Gray8；PNG 一般直接解出 Bgra8，其余格式转换一次。
    Ok(match pixel_format {
        BitmapPixelFormat::Bgra8 | BitmapPixelFormat::Gray8 => bitmap,
        _ => SoftwareBitmap::Convert(&bitmap, BitmapPixelFormat::Bgra8)
            .map_err(|error| format!("转换位图格式失败：{error}"))?,
    })
}

#[cfg(test)]
mod tests {
    /// 冒烟：枚举可用语言不应 panic（不assert非空——CI/新系统可能没装语言包）。
    #[test]
    fn listing_languages_does_not_panic() {
        let _ = super::available_language_tags();
    }
}
