use std::{
    fmt::Write as _,
    fs::{self, File, OpenOptions},
    io::{BufWriter, Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use image::{
    DynamicImage, ExtendedColorType, GenericImageView, ImageDecoder, ImageEncoder, ImageReader,
    codecs::{
        jpeg::JpegEncoder,
        png::{CompressionType, FilterType, PngEncoder},
        webp::WebPEncoder,
    },
    metadata::Orientation,
};
use sha2::{Digest, Sha256};

use crate::{perceptual_hash, scanner, thumbnail};

const COPY_BUFFER_SIZE: usize = 64 * 1024;
const THUMBNAIL_MAX_SIZE: u32 = 320;
/// 受管副本的最大边长：静态图超过则缩放到该尺寸内（保宽高比）。
const MAX_IMPORT_DIMENSION: u32 = 512;
/// 静态 JPEG 重编码质量（仅当 >512px 缩放时发生）。
const JPEG_QUALITY: u8 = 85;
static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(1);

/// 动画检测结果。扩展名只作辅助，判定以容器结构为准。
/// `Unknown`（无法确认静态/动画）时调用方必须**保守**：不缩放、不重编码、保留原字节。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnimationStatus {
    Animated,
    Static,
    Unknown,
}

pub struct StagedAsset {
    temporary_file: TemporaryFile,
    pub original_filename: String,
    pub file_extension: String,
    pub file_size: u64,
    pub sha256: String,
    pub width: u32,
    pub height: u32,
    /// dHash（64-bit），对"压缩前"的解码图计算，跨格式/分辨率一致。
    pub perceptual_hash: Option<u64>,
    /// 解码结果（EXIF 已应用、动画取首帧）。`commit` 直接用它生成缩略图，
    /// 避免第二次全量解码。若被缩放重编码，则指向缩放后的图。
    decoded: DynamicImage,
}

pub struct CommittedAsset {
    pub managed_path: PathBuf,
    pub thumbnail_path: PathBuf,
    created_managed_file: bool,
    created_thumbnail_file: bool,
}

pub struct AssetService;

impl AssetService {
    pub fn stage_file(source_path: &Path, emojis_directory: &Path) -> Result<StagedAsset, String> {
        let canonical_source = source_path
            .canonicalize()
            .map_err(|error| format!("无法访问导入文件 {}：{error}", source_path.display()))?;
        if !canonical_source.is_file() {
            return Err(format!("导入路径不是文件：{}", canonical_source.display()));
        }

        let file_extension = scanner::supported_extension(&canonical_source)
            .ok_or_else(|| format!("不支持的图片格式：{}", canonical_source.display()))?;
        let original_filename = canonical_source
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .ok_or_else(|| format!("无法读取文件名：{}", canonical_source.display()))?;
        let temporary_path = temporary_path(emojis_directory, "emoji", &file_extension);
        let temporary_file = TemporaryFile::new(temporary_path);
        // 1) 原始字节复制到临时文件 + 哈希（不再 fsync）。
        let (sha256_original, file_size_original) =
            copy_and_hash(&canonical_source, temporary_file.path())?;

        // 2) 解码一次（EXIF 方向 + 动画首帧）。解码失败按原有行为中止导入。
        let decoded = decode_for_import(temporary_file.path())?;
        let (mut width, mut height) = decoded.dimensions();
        // dHash 在压缩前对原始解码结果计算，跨格式/分辨率稳定。
        let perceptual_hash = Some(perceptual_hash::dhash(&decoded));

        // 3) 动画 / 无法确认静态 → 保持原始字节，不缩放不重编码。
        let animation = animation_status(temporary_file.path(), &file_extension);
        let mut sha256 = sha256_original;
        let mut file_size = file_size_original;
        let mut stored = decoded;
        match animation {
            AnimationStatus::Static
                if width > MAX_IMPORT_DIMENSION || height > MAX_IMPORT_DIMENSION =>
            {
                let scaled = stored.thumbnail(MAX_IMPORT_DIMENSION, MAX_IMPORT_DIMENSION);
                let (scaled_width, scaled_height) = scaled.dimensions();
                // 覆盖临时文件为重编码后的受管副本字节；SHA 对存储字节算。
                sha256 = Self::encode_scaled_image(&scaled, temporary_file.path(), &file_extension)?;
                file_size = fs::metadata(temporary_file.path())
                    .map_err(|error| {
                        format!(
                            "无法读取临时素材信息 {}：{error}",
                            temporary_file.path().display()
                        )
                    })?
                    .len();
                width = scaled_width;
                height = scaled_height;
                stored = scaled;
            }
            AnimationStatus::Unknown => {
                log::warn!(
                    "无法确认图片是否为动画，保持原始字节：{}",
                    canonical_source.display()
                );
            }
            _ => {}
        }

        Ok(StagedAsset {
            temporary_file,
            original_filename,
            file_extension,
            file_size,
            sha256,
            width,
            height,
            perceptual_hash,
            decoded: stored,
        })
    }

    pub fn open_in_explorer(directory: &Path) -> Result<(), String> {
        if !directory.is_dir() {
            return Err(format!("素材库目录不存在：{}", directory.display()));
        }
        std::process::Command::new("explorer.exe")
            .arg(directory)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("无法在资源管理器中打开素材库：{error}"))
    }

    /// 将内存中的 `DynamicImage` 编码为确定性 PNG 字节并写入临时文件，返回 SHA-256。
    ///
    /// 编码设置（PngEncoder + Rgba8 + CompressionType::Fast + FilterType::Adaptive）
    /// 经过 `deterministic_png_encoding_produces_identical_bytes_and_hash` 测试锁定，
    /// 保证相同输入产生字节级一致的 PNG。这是剪贴板收藏去重语义（D3）的前提。
    /// 压缩级别取 Fast：受管副本已缩到 ≤512px，磁盘膨胀有界；确定性不受影响。
    pub fn encode_image_as_png(image: &DynamicImage, path: &Path) -> Result<String, String> {
        let rgba = image.to_rgba8();
        let (width, height) = rgba.dimensions();
        let bytes = rgba.into_raw();

        let file = File::create(path)
            .map_err(|error| format!("无法创建临时素材 {}：{error}", path.display()))?;
        let mut writer = BufWriter::new(file);
        let encoder = PngEncoder::new_with_quality(
            &mut writer,
            CompressionType::Fast,
            FilterType::Adaptive,
        );
        encoder
            .write_image(&bytes, width, height, ExtendedColorType::Rgba8)
            .map_err(|error| format!("无法编码 PNG {}：{error}", path.display()))?;
        writer
            .flush()
            .map_err(|error| format!("无法刷新临时素材 {}：{error}", path.display()))?;

        hash_file(path)
    }

    /// 按扩展名用**显式编码器**重编码缩放后的静态图，返回存储字节的 SHA-256。
    /// 不依赖 `save_with_format` 的隐式默认参数。仅对静态格式调用
    /// （调用方已通过 `animation_status` 过滤）。
    fn encode_scaled_image(
        image: &DynamicImage,
        path: &Path,
        extension: &str,
    ) -> Result<String, String> {
        match extension {
            "png" => Self::encode_image_as_png(image, path),
            "jpg" | "jpeg" => {
                let rgb = image.to_rgb8();
                let (width, height) = rgb.dimensions();
                let bytes = rgb.into_raw();
                let file = File::create(path)
                    .map_err(|error| format!("无法创建临时素材 {}：{error}", path.display()))?;
                let mut writer = BufWriter::new(file);
                let encoder = JpegEncoder::new_with_quality(&mut writer, JPEG_QUALITY);
                encoder
                    .write_image(&bytes, width, height, ExtendedColorType::Rgb8)
                    .map_err(|error| format!("无法编码 JPEG {}：{error}", path.display()))?;
                writer
                    .flush()
                    .map_err(|error| format!("无法刷新临时素材 {}：{error}", path.display()))?;
                hash_file(path)
            }
            "webp" => {
                let rgba = image.to_rgba8();
                let (width, height) = rgba.dimensions();
                let bytes = rgba.into_raw();
                let file = File::create(path)
                    .map_err(|error| format!("无法创建临时素材 {}：{error}", path.display()))?;
                let mut writer = BufWriter::new(file);
                // image 0.25 的 WebP 编码器仅支持 lossless（VP8L）。
                let encoder = WebPEncoder::new_lossless(&mut writer);
                encoder
                    .encode(&bytes, width, height, ExtendedColorType::Rgba8)
                    .map_err(|error| format!("无法编码 WebP {}：{error}", path.display()))?;
                writer
                    .flush()
                    .map_err(|error| format!("无法刷新临时素材 {}：{error}", path.display()))?;
                hash_file(path)
            }
            other => Err(format!("不支持的图片格式：{other}")),
        }
    }

    /// 为内存中的 `DynamicImage` 准备一个 staged asset（临时文件 + 哈希 + 尺寸）。
    ///
    /// 与 `stage_file` 的区别：源是内存中的解码结果（来自剪贴板），不需要打开磁盘文件，
    /// 也没有 EXIF。共享 `commit` 流水线：调用方拿到 `StagedAsset` 后交给 `commit_staged`。
    pub fn stage_dynamic_image(
        emojis_directory: &Path,
        image: DynamicImage,
        file_extension: &str,
        original_filename: &str,
    ) -> Result<StagedAsset, String> {
        let temp_path = temporary_path(emojis_directory, "emoji", file_extension);
        let perceptual_hash = Some(perceptual_hash::dhash(&image));
        let (mut width, mut height) = image.dimensions();

        let (sha256, file_size, stored) =
            if width > MAX_IMPORT_DIMENSION || height > MAX_IMPORT_DIMENSION {
                let scaled = image.thumbnail(MAX_IMPORT_DIMENSION, MAX_IMPORT_DIMENSION);
                let (sw, sh) = scaled.dimensions();
                let sha = Self::encode_scaled_image(&scaled, &temp_path, file_extension)?;
                let size = fs::metadata(&temp_path)
                    .map_err(|error| format!("无法读取临时素材信息 {temp_path:?}：{error}"))?
                    .len();
                width = sw;
                height = sh;
                (sha, size, scaled)
            } else {
                let sha = Self::encode_image_as_png(&image, &temp_path)?;
                let size = fs::metadata(&temp_path)
                    .map_err(|error| format!("无法读取临时素材信息 {temp_path:?}：{error}"))?
                    .len();
                (sha, size, image)
            };

        Ok(StagedAsset {
            temporary_file: TemporaryFile::new(temp_path),
            original_filename: original_filename.to_string(),
            file_extension: file_extension.to_string(),
            file_size,
            sha256,
            width,
            height,
            perceptual_hash,
            decoded: stored,
        })
    }
}

/// 解码一张图，应用 EXIF 方向、取动画首帧。返回"业务上正确的朝向"的解码结果，
/// 供 `stage_file` 与感知哈希惰性回填共用。无 EXIF / 读取方向失败 → 安全回退为不变换。
pub(crate) fn decode_for_import(path: &Path) -> Result<DynamicImage, String> {
    let reader = ImageReader::open(path)
        .map_err(|error| format!("无法打开图片 {}：{error}", path.display()))?;
    let reader = reader
        .with_guessed_format()
        .map_err(|error| format!("无法识别图片格式 {}：{error}", path.display()))?;
    let mut decoder = reader
        .into_decoder()
        .map_err(|error| format!("无法解码图片 {}：{error}", path.display()))?;
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut image = DynamicImage::from_decoder(decoder)
        .map_err(|error| format!("无法解码图片 {}：{error}", path.display()))?;
    if orientation != Orientation::NoTransforms {
        image.apply_orientation(orientation);
    }
    Ok(image)
}

/// 内容级动画检测。扩展名只作辅助；解析失败 / 无法确认一律返回 `Unknown`
/// （调用方须保守保留原字节）。
fn animation_status(path: &Path, extension: &str) -> AnimationStatus {
    match extension {
        // GIF 全部按动画处理（包括静态 GIF）：不缩放不重编码。
        "gif" => AnimationStatus::Animated,
        "png" => match detect_png_apng(path) {
            Some(true) => AnimationStatus::Animated,
            Some(false) => AnimationStatus::Static,
            None => AnimationStatus::Unknown,
        },
        "webp" => match detect_webp_animation(path) {
            Some(true) => AnimationStatus::Animated,
            Some(false) => AnimationStatus::Static,
            None => AnimationStatus::Unknown,
        },
        "jpg" | "jpeg" => AnimationStatus::Static,
        _ => AnimationStatus::Unknown,
    }
}

const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

/// 扫描 PNG chunk：`IDAT` 前发现 `acTL` → 动画（APNG）。
/// 校验边界 / 长度 / 整数溢出；任何异常 → `None`（Unknown，保守）。
fn detect_png_apng(path: &Path) -> Option<bool> {
    let bytes = fs::read(path).ok()?;
    if bytes.len() < 8 || bytes[..8] != PNG_SIGNATURE {
        return None;
    }
    let mut offset = 8usize;
    while offset + 8 <= bytes.len() {
        let length = u32::from_be_bytes([
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
        ]) as usize;
        let chunk_type = &bytes[offset + 4..offset + 8];
        if chunk_type == b"IDAT" {
            return Some(false);
        }
        if chunk_type == b"acTL" {
            return Some(true);
        }
        let next = offset
            .checked_add(8)?
            .checked_add(length)?
            .checked_add(4)?;
        if next > bytes.len() {
            return None;
        }
        offset = next;
    }
    None
}

/// 解析 WebP 的 RIFF 容器：`ANIM` chunk 或 `VP8X` 的 animation bit → 动画。
/// 校验边界 / 长度 / 整数溢出；异常或无法确认 → `None`。
fn detect_webp_animation(path: &Path) -> Option<bool> {
    let bytes = fs::read(path).ok()?;
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return None;
    }
    let riff_size = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize;
    let data_end = 8usize.checked_add(riff_size)?.min(bytes.len());

    let mut offset = 12usize;
    let mut saw_vp8x_without_anim = false;
    while offset + 8 <= data_end {
        let fourcc = &bytes[offset..offset + 4];
        let chunk_size = u32::from_le_bytes([
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        ]) as usize;
        match fourcc {
            b"ANIM" => return Some(true),
            b"VP8X" => {
                let feature_offset = offset.checked_add(8)?;
                if feature_offset >= data_end {
                    return None;
                }
                // VP8X data[0] 的 bit1 = animation。
                if bytes[feature_offset] & 0x02 != 0 {
                    return Some(true);
                }
                saw_vp8x_without_anim = true;
            }
            b"VP8 " | b"VP8L" => return Some(false),
            _ => {}
        }
        let next = offset.checked_add(8)?.checked_add(chunk_size)?;
        if next > data_end {
            return None;
        }
        offset = next;
    }
    if saw_vp8x_without_anim {
        return Some(false);
    }
    None
}

impl StagedAsset {
    pub fn commit(
        mut self,
        emojis_directory: &Path,
        thumbnails_directory: &Path,
    ) -> Result<CommittedAsset, String> {
        let managed_path =
            emojis_directory.join(format!("{}.{}", self.sha256, self.file_extension));
        let thumbnail_path = thumbnails_directory.join(format!("{}.png", self.sha256));
        let temporary_thumbnail_path = temporary_path(thumbnails_directory, "thumbnail", "png");
        let mut temporary_thumbnail = TemporaryFile::new(temporary_thumbnail_path);

        // 直接用已解码图生成缩略图，避免二次全量解码。
        thumbnail::write_thumbnail_png(&self.decoded, temporary_thumbnail.path(), THUMBNAIL_MAX_SIZE)?;

        let created_managed_file =
            commit_asset_file(&mut self.temporary_file, &managed_path, &self.sha256)?;
        let created_thumbnail_file =
            match commit_thumbnail_file(&mut temporary_thumbnail, &thumbnail_path) {
                Ok(created) => created,
                Err(error) => {
                    if created_managed_file {
                        remove_file_if_exists(&managed_path, "回滚素材文件");
                    }
                    return Err(error);
                }
            };

        Ok(CommittedAsset {
            managed_path,
            thumbnail_path,
            created_managed_file,
            created_thumbnail_file,
        })
    }
}

impl CommittedAsset {
    pub fn rollback(&self) {
        if self.created_thumbnail_file {
            remove_file_if_exists(&self.thumbnail_path, "回滚缩略图");
        }
        if self.created_managed_file {
            remove_file_if_exists(&self.managed_path, "回滚素材文件");
        }
    }
}

struct TemporaryFile {
    path: PathBuf,
    active: bool,
}

impl TemporaryFile {
    fn new(path: PathBuf) -> Self {
        Self { path, active: true }
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn disarm(&mut self) {
        self.active = false;
    }
}

impl Drop for TemporaryFile {
    fn drop(&mut self) {
        if self.active {
            remove_file_if_exists(&self.path, "清理临时文件");
        }
    }
}

/// 复制源文件字节到临时文件并算 SHA-256。
///
/// 不再 `sync_all`（保留 `flush`）：写入序列 `write_all → flush → 同卷 rename`
/// 原子提交；失败路径（`TemporaryFile::drop` / 哈希校验 / `CommittedAsset::rollback`）
/// 不污染受管目录。`flush` 不保证物理落盘——断电窗口与 DB 的 WAL
/// `synchronous=NORMAL` 取舍一致；受管副本可重导入。
fn copy_and_hash(source_path: &Path, temporary_path: &Path) -> Result<(String, u64), String> {
    let mut source = File::open(source_path)
        .map_err(|error| format!("无法读取导入文件 {}：{error}", source_path.display()))?;
    let mut destination = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temporary_path)
        .map_err(|error| format!("无法创建临时素材 {}：{error}", temporary_path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; COPY_BUFFER_SIZE];
    let mut file_size = 0u64;

    loop {
        let read = source
            .read(&mut buffer)
            .map_err(|error| format!("读取导入文件 {} 失败：{error}", source_path.display()))?;
        if read == 0 {
            break;
        }
        destination
            .write_all(&buffer[..read])
            .map_err(|error| format!("写入临时素材 {} 失败：{error}", temporary_path.display()))?;
        hasher.update(&buffer[..read]);
        file_size = file_size.saturating_add(read as u64);
    }
    destination
        .flush()
        .map_err(|error| format!("刷新临时素材 {} 失败：{error}", temporary_path.display()))?;

    Ok((hex_digest(hasher.finalize().as_slice()), file_size))
}

fn commit_asset_file(
    temporary_file: &mut TemporaryFile,
    destination_path: &Path,
    expected_sha256: &str,
) -> Result<bool, String> {
    if destination_path.exists() {
        let existing_hash = hash_file(destination_path)?;
        if existing_hash != expected_sha256 {
            return Err(format!(
                "素材目标文件已存在但内容不一致：{}",
                destination_path.display()
            ));
        }
        fs::remove_file(temporary_file.path()).map_err(|error| {
            format!(
                "无法清理重复临时素材 {}：{error}",
                temporary_file.path().display()
            )
        })?;
        temporary_file.disarm();
        return Ok(false);
    }

    fs::rename(temporary_file.path(), destination_path).map_err(|error| {
        format!(
            "无法原子保存素材 {} -> {}：{error}",
            temporary_file.path().display(),
            destination_path.display()
        )
    })?;
    temporary_file.disarm();
    Ok(true)
}

fn commit_thumbnail_file(
    temporary_file: &mut TemporaryFile,
    destination_path: &Path,
) -> Result<bool, String> {
    if destination_path.exists() {
        image::open(destination_path).map_err(|error| {
            format!("已有缩略图无法读取 {}：{error}", destination_path.display())
        })?;
        fs::remove_file(temporary_file.path()).map_err(|error| {
            format!(
                "无法清理重复临时缩略图 {}：{error}",
                temporary_file.path().display()
            )
        })?;
        temporary_file.disarm();
        return Ok(false);
    }

    fs::rename(temporary_file.path(), destination_path).map_err(|error| {
        format!(
            "无法原子保存缩略图 {} -> {}：{error}",
            temporary_file.path().display(),
            destination_path.display()
        )
    })?;
    temporary_file.disarm();
    Ok(true)
}

fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path)
        .map_err(|error| format!("无法读取已有素材 {}：{error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; COPY_BUFFER_SIZE];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("无法校验已有素材 {}：{error}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex_digest(hasher.finalize().as_slice()))
}

fn hex_digest(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(&mut output, "{byte:02x}");
    }
    output
}

fn temporary_path(directory: &Path, kind: &str, extension: &str) -> PathBuf {
    let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    directory.join(format!(
        ".{kind}-{}-{counter}-{timestamp}.tmp.{extension}",
        std::process::id()
    ))
}

fn remove_file_if_exists(path: &Path, action: &str) {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => log::error!("{action}失败 {}：{error}", path.display()),
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    use image::{DynamicImage, GenericImageView, Rgba, RgbaImage};

    use super::{
        AnimationStatus, AssetService, MAX_IMPORT_DIMENSION, animation_status, decode_for_import,
    };

    fn test_root(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "emobox-asset-{label}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create test root");
        root
    }

    fn pattern(width: u32, height: u32) -> DynamicImage {
        let mut img = RgbaImage::new(width, height);
        for (x, y, pixel) in img.enumerate_pixels_mut() {
            *pixel = Rgba([(x % 256) as u8, (y % 256) as u8, 200, 255]);
        }
        DynamicImage::ImageRgba8(img)
    }

    fn staged_for(source: &Path, emojis: &Path) -> super::StagedAsset {
        AssetService::stage_file(source, emojis).expect("stage file")
    }

    /// 锁定 D6：相同 RGBA 输入两次编码必须字节级一致，SHA-256 必须一致。
    /// 这是剪贴板收藏去重语义的前提。
    #[test]
    fn deterministic_png_encoding_produces_identical_bytes_and_hash() {
        let root = test_root("png-determ");
        let rgba = RgbaImage::from_pixel(8, 6, Rgba([100, 150, 200, 255]));
        let image = DynamicImage::ImageRgba8(rgba);

        let path1 = root.join("first.png");
        let path2 = root.join("second.png");

        let hash1 = AssetService::encode_image_as_png(&image, &path1)
            .expect("first encoding should succeed");
        let hash2 = AssetService::encode_image_as_png(&image, &path2)
            .expect("second encoding should succeed");

        let bytes1 = fs::read(&path1).expect("read first png");
        let bytes2 = fs::read(&path2).expect("read second png");

        assert_eq!(bytes1, bytes2, "PNG 字节必须一致");
        assert_eq!(hash1, hash2, "SHA-256 必须一致");
        assert!(bytes1.len() > 48, "PNG 必须包含 48 像素的数据");
        assert_eq!(bytes1.len(), bytes2.len(), "两次编码大小一致");
        assert_eq!(hash1.len(), 64, "SHA-256 hex 应为 64 字符");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn transparent_pixels_encode_successfully() {
        let root = test_root("png-alpha");
        let rgba = RgbaImage::from_pixel(4, 3, Rgba([255, 0, 0, 128]));
        let image = DynamicImage::ImageRgba8(rgba);

        let path = root.join("transparent.png");
        let hash = AssetService::encode_image_as_png(&image, &path)
            .expect("transparent encoding should succeed");

        let bytes = fs::read(&path).expect("read transparent png");
        let decoded = image::load_from_memory(&bytes).expect("decode written png");
        assert_eq!(decoded.width(), 4);
        assert_eq!(decoded.height(), 3);
        assert_eq!(hash.len(), 64);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn encoded_png_round_trips_through_image_open() {
        let root = test_root("png-roundtrip");
        let rgba = RgbaImage::from_pixel(16, 12, Rgba([10, 20, 30, 255]));
        let image = DynamicImage::ImageRgba8(rgba);

        let path = root.join("roundtrip.png");
        AssetService::encode_image_as_png(&image, &path).expect("encode should succeed");

        let decoded = image::open(&path).expect("decode should succeed");
        assert_eq!(decoded.width(), 16);
        assert_eq!(decoded.height(), 12);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn stage_dynamic_image_writes_consistent_temp_file() {
        let root = test_root("stage-dyn");
        let rgba = RgbaImage::from_pixel(8, 6, Rgba([100, 150, 200, 255]));
        let image = DynamicImage::ImageRgba8(rgba);

        let staged = AssetService::stage_dynamic_image(&root, image.clone(), "png", "test.png")
            .expect("stage_dynamic_image should succeed");

        assert_eq!(staged.file_extension, "png");
        assert_eq!(staged.original_filename, "test.png");
        assert_eq!(staged.width, 8);
        assert_eq!(staged.height, 6);
        assert!(!staged.sha256.is_empty());
        assert!(staged.file_size > 0);
        assert!(staged.perceptual_hash.is_some(), "剪贴板路径也应有 dHash");

        let direct_path = root.join("direct.png");
        let direct_hash = AssetService::encode_image_as_png(&image, &direct_path)
            .expect("direct encoding should succeed");
        assert_eq!(staged.sha256, direct_hash);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn small_image_kept_original_bytes() {
        let root = test_root("small-kept");
        let source = root.join("small.png");
        let img = pattern(64, 64);
        img.save(&source).expect("write source");
        let original_bytes = fs::read(&source).expect("read source");

        let staged = staged_for(&source, &root);
        assert_eq!(
            staged.sha256,
            sha256_hex(&original_bytes),
            "≤512 的静态图应保留原始字节（SHA 不变）"
        );
        assert_eq!(staged.width, 64);
        assert_eq!(staged.height, 64);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn static_over_512_downscaled() {
        let root = test_root("scaled");
        let source = root.join("big.png");
        let img = pattern(1200, 800);
        img.save(&source).expect("write source");
        let original_bytes = fs::read(&source).expect("read source");

        let staged = staged_for(&source, &root);
        assert_ne!(staged.sha256, sha256_hex(&original_bytes), "大图应被重编码");
        assert!(staged.width <= MAX_IMPORT_DIMENSION);
        assert!(staged.height <= MAX_IMPORT_DIMENSION);
        assert_eq!(staged.width, 512, "宽边应缩到上限");
        assert!(staged.perceptual_hash.is_some());
        let _ = fs::remove_dir_all(&root);
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        let digest = Sha256::digest(bytes);
        digest.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn gif_kept_original_bytes() {
        let root = test_root("gif");
        // 用 image crate 生成一张静态 GIF（无动画，但按 .gif 一律保留原字节）。
        let source = root.join("static.gif");
        let img = pattern(64, 64);
        img.save(&source).expect("write gif");
        let original_bytes = fs::read(&source).expect("read gif");

        let staged = staged_for(&source, &root);
        assert_eq!(staged.sha256, sha256_hex(&original_bytes), "GIF 必须保留原字节");
        assert!(staged.perceptual_hash.is_some());
        let _ = fs::remove_dir_all(&root);
    }

    /// 构造一个"看起来像 PNG"但截断的文件 → 必须 Unknown（保守保留原字节）。
    #[test]
    fn detect_animation_truncated_returns_unknown() {
        let root = test_root("truncated");
        let path = root.join("truncated.png");
        let img = pattern(32, 32);
        let mut bytes = Vec::new();
        let mut cursor = std::io::Cursor::new(&mut bytes);
        img.write_to(&mut cursor, image::ImageFormat::Png).expect("encode");
        // 截掉后半。
        bytes.truncate(20);
        fs::write(&path, &bytes).expect("write truncated");
        assert_eq!(animation_status(&path, "png"), AnimationStatus::Unknown);
        let _ = fs::remove_dir_all(&root);
    }

    /// 伪造超大 chunk 长度 → 解析失败 → Unknown。
    #[test]
    fn detect_animation_forged_chunk_len_returns_unknown() {
        let root = test_root("forged");
        let path = root.join("forged.png");
        let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        // chunk 长度声明为 u32::MAX（远超文件剩余字节）。
        bytes.extend_from_slice(&u32::MAX.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&[0u8; 8]);
        fs::write(&path, &bytes).expect("write forged");
        assert_eq!(animation_status(&path, "png"), AnimationStatus::Unknown);
        let _ = fs::remove_dir_all(&root);
    }

    /// 扩展名与实际内容不一致：文件其实是 PNG，但扩展名是 webp → 按 webp 解析失败 → Unknown。
    #[test]
    fn detect_animation_extension_mismatch_returns_unknown() {
        let root = test_root("mismatch");
        let path = root.join("actually-png.webp");
        let img = pattern(32, 32);
        // 显式编码为 PNG 字节写入 .webp 扩展名的文件 —— 内容与扩展名不一致。
        // 不能用 `img.save(&path)`：image 会按扩展名编码成合法 WebP，测不到不匹配。
        let mut png_bytes = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut png_bytes), image::ImageFormat::Png)
            .expect("encode png bytes");
        fs::write(&path, &png_bytes).expect("write png bytes as webp name");
        assert_eq!(animation_status(&path, "webp"), AnimationStatus::Unknown);
        let _ = fs::remove_dir_all(&root);
    }

    /// APNG（含 acTL chunk）→ Animated。
    #[test]
    fn detect_animation_apng_is_animated() {
        let root = test_root("apng");
        let path = root.join("anim.png");
        let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        // 先放一个 acTL chunk（长度 8，内容任意），再放 IDAT。
        bytes.extend_from_slice(&8u32.to_be_bytes());
        bytes.extend_from_slice(b"acTL");
        bytes.extend_from_slice(&[0u8; 8]);
        bytes.extend_from_slice(&0u32.to_be_bytes()); // crc 占位（解析不校验 crc）
        bytes.extend_from_slice(&4u32.to_be_bytes());
        bytes.extend_from_slice(b"IDAT");
        bytes.extend_from_slice(b"abcd");
        bytes.extend_from_slice(&0u32.to_be_bytes());
        fs::write(&path, &bytes).expect("write apng-like");
        assert_eq!(animation_status(&path, "png"), AnimationStatus::Animated);
        let _ = fs::remove_dir_all(&root);
    }

    /// 普通 PNG（无 acTL）→ Static。
    #[test]
    fn detect_animation_plain_png_is_static() {
        let root = test_root("plain-png");
        let path = root.join("plain.png");
        let img = pattern(16, 16);
        img.save(&path).expect("write png");
        assert_eq!(animation_status(&path, "png"), AnimationStatus::Static);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn detect_animation_gif_is_animated() {
        // 静态 GIF 也按 Animated 处理（全部保留原字节）。
        let root = test_root("gif-status");
        let path = root.join("g.gif");
        let img = pattern(16, 16);
        img.save(&path).expect("write gif");
        assert_eq!(animation_status(&path, "gif"), AnimationStatus::Animated);
        let _ = fs::remove_dir_all(&root);
    }

    /// decode_for_import 应能解码普通图并返回尺寸。
    #[test]
    fn decode_for_import_reads_dimensions() {
        let root = test_root("decode");
        let path = root.join("dec.png");
        pattern(40, 30).save(&path).expect("write png");
        let decoded = decode_for_import(&path).expect("decode");
        assert_eq!(decoded.dimensions(), (40, 30));
        let _ = fs::remove_dir_all(&root);
    }

    /// 缩略图写入应产出可读 PNG，且不再依赖源路径解码。
    #[test]
    fn write_thumbnail_uses_decoded_image() {
        let root = test_root("thumb");
        let img = pattern(600, 600);
        let out = root.join("thumb.png");
        super::thumbnail::write_thumbnail_png(&img, &out, 320).expect("write thumbnail");
        let decoded = image::open(&out).expect("decode thumbnail");
        assert!(decoded.width() <= 320);
        assert!(decoded.height() <= 320);
        let _ = fs::remove_dir_all(&root);
    }
}
