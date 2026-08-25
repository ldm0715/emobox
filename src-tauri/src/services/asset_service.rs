use std::{
    fmt::Write as _,
    fs::{self, File, OpenOptions},
    io::{BufWriter, Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use image::{
    DynamicImage, ExtendedColorType, GenericImageView, ImageEncoder,
    codecs::png::{CompressionType, FilterType, PngEncoder},
};
use sha2::{Digest, Sha256};

use crate::{scanner, thumbnail};

const COPY_BUFFER_SIZE: usize = 64 * 1024;
const THUMBNAIL_MAX_SIZE: u32 = 320;
static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(1);

pub struct StagedAsset {
    temporary_file: TemporaryFile,
    pub original_filename: String,
    pub file_extension: String,
    pub file_size: u64,
    pub sha256: String,
    pub width: u32,
    pub height: u32,
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
        let (sha256, file_size) = copy_and_hash(&canonical_source, temporary_file.path())?;
        let decoded = image::open(temporary_file.path())
            .map_err(|error| format!("无法解码图片 {}：{error}", canonical_source.display()))?;
        let (width, height) = decoded.dimensions();

        Ok(StagedAsset {
            temporary_file,
            original_filename,
            file_extension,
            file_size,
            sha256,
            width,
            height,
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
    /// 编码设置（PngEncoder + Rgba8 + CompressionType::Default + FilterType::Adaptive）
    /// 经过 `deterministic_png_encoding_produces_identical_bytes_and_hash` 测试锁定，
    /// 保证相同输入产生字节级一致的 PNG。这是剪贴板收藏去重语义（D3）的前提。
    pub fn encode_image_as_png(image: &DynamicImage, path: &Path) -> Result<String, String> {
        let rgba = image.to_rgba8();
        let (width, height) = rgba.dimensions();
        let bytes = rgba.into_raw();

        let file = File::create(path)
            .map_err(|error| format!("无法创建临时素材 {}：{error}", path.display()))?;
        let mut writer = BufWriter::new(file);
        let encoder = PngEncoder::new_with_quality(
            &mut writer,
            CompressionType::Default,
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

    /// 为内存中的 `DynamicImage` 准备一个 staged asset（临时文件 + 哈希 + 尺寸）。
    ///
    /// 与 `stage_file` 的区别：源是内存中的解码结果（来自剪贴板），不需要打开磁盘文件。
    /// 共享 `commit` 流水线：调用方拿到 `StagedAsset` 后交给 `commit_staged`。
    pub fn stage_dynamic_image(
        emojis_directory: &Path,
        image: DynamicImage,
        file_extension: &str,
        original_filename: &str,
    ) -> Result<StagedAsset, String> {
        let temp_path = temporary_path(emojis_directory, "emoji", file_extension);
        let sha256 = Self::encode_image_as_png(&image, &temp_path)?;
        let file_size = fs::metadata(&temp_path)
            .map_err(|error| format!("无法读取临时素材信息 {}：{error}", temp_path.display()))?
            .len();
        let (width, height) = image.dimensions();

        Ok(StagedAsset {
            temporary_file: TemporaryFile::new(temp_path),
            original_filename: original_filename.to_string(),
            file_extension: file_extension.to_string(),
            file_size,
            sha256,
            width,
            height,
        })
    }
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

        thumbnail::write_thumbnail_png(
            self.temporary_file.path(),
            temporary_thumbnail.path(),
            THUMBNAIL_MAX_SIZE,
        )?;

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
    destination
        .sync_all()
        .map_err(|error| format!("同步临时素材 {} 失败：{error}", temporary_path.display()))?;

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
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use image::{DynamicImage, Rgba, RgbaImage};

    use super::AssetService;

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

    /// 透明像素（alpha < 255）也能稳定编码。
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

    /// 编码后用 `image::open` 能读回原尺寸。
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

    /// `stage_dynamic_image` 应产出非空临时文件，且 SHA-256 与直接编码一致。
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
        // StagedAsset 内部的临时文件应存在
        assert!(staged.file_size > 0);

        // 临时文件内容应等于直接编码的内容
        let direct_path = root.join("direct.png");
        let direct_hash = AssetService::encode_image_as_png(&image, &direct_path)
            .expect("direct encoding should succeed");
        assert_eq!(staged.sha256, direct_hash);

        let _ = fs::remove_dir_all(&root);
    }
}
