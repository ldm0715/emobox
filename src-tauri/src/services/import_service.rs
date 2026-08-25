use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use image::DynamicImage;
use serde::Serialize;
use walkdir::WalkDir;

use crate::{
    database,
    repositories::emoji_repository::{EmojiRepository, NewManagedEmoji},
    scanner::IndexedImage,
    services::asset_service::AssetService,
};

const FAILURE_DETAIL_LIMIT: usize = 50;
static IMPORT_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone)]
pub struct ImportContext {
    pub database_path: PathBuf,
    pub emojis_directory: PathBuf,
    pub thumbnails_directory: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFailure {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedImportSummary {
    pub success_count: usize,
    pub duplicate_count: usize,
    pub failed_count: usize,
    pub elapsed_ms: u128,
    pub items: Vec<IndexedImage>,
    pub failures: Vec<ImportFailure>,
}

impl ManagedImportSummary {
    fn new() -> Self {
        Self {
            success_count: 0,
            duplicate_count: 0,
            failed_count: 0,
            elapsed_ms: 0,
            items: Vec::new(),
            failures: Vec::new(),
        }
    }

    fn record_failure(&mut self, path: &Path, message: String) {
        self.failed_count += 1;
        if self.failures.len() < FAILURE_DETAIL_LIMIT {
            self.failures.push(ImportFailure {
                path: path.to_string_lossy().into_owned(),
                message,
            });
        }
    }
}

pub struct ImportService;

impl ImportService {
    pub fn import_paths(
        context: &ImportContext,
        requested_paths: &[PathBuf],
    ) -> Result<ManagedImportSummary, String> {
        let _guard = IMPORT_LOCK
            .lock()
            .map_err(|_| "导入服务暂时不可用，请重启应用后重试。".to_string())?;
        let started_at = Instant::now();
        let mut summary = ManagedImportSummary::new();
        let candidates = collect_candidates(requested_paths, &mut summary);
        let mut connection = database::open_connection(&context.database_path)?;
        let mut seen_paths = HashSet::new();

        for candidate in candidates {
            let canonical = match candidate.canonicalize() {
                Ok(path) => path,
                Err(error) => {
                    summary.record_failure(&candidate, format!("无法访问导入文件：{error}"));
                    continue;
                }
            };
            if !seen_paths.insert(canonical.clone()) {
                summary.duplicate_count += 1;
                continue;
            }

            match import_one(&mut connection, context, &canonical) {
                Ok(ImportOneOutcome::Imported(item)) => {
                    summary.success_count += 1;
                    summary.items.push(item);
                }
                Ok(ImportOneOutcome::Duplicate) => {
                    summary.duplicate_count += 1;
                }
                Err(error) => summary.record_failure(&canonical, error),
            }
        }

        summary.elapsed_ms = started_at.elapsed().as_millis();
        Ok(summary)
    }

    /// 从内存中的 `DynamicImage`（如剪贴板像素）导入素材。
    ///
    /// 入口取 `IMPORT_LOCK`，与 `import_paths` 共享同一个全局串行化点。
    /// `source_type` 固定为 `"clipboard"`，`source_path` 写入 `managed_path`。
    pub fn import_dynamic_image(
        context: &ImportContext,
        image: DynamicImage,
        file_extension: &str,
        original_filename: &str,
    ) -> Result<ImportOneOutcome, String> {
        let _guard = IMPORT_LOCK
            .lock()
            .map_err(|_| "导入服务暂时不可用，请重启应用后重试。".to_string())?;
        let mut connection = database::open_connection(&context.database_path)?;
        let staged = AssetService::stage_dynamic_image(
            &context.emojis_directory,
            image,
            file_extension,
            original_filename,
        )?;
        // commit_staged 期望 source_type="managed_import"；clipboard 路径在 SQL 字段
        // 里允许同样的 managed_path/sha256 约束，但需要 source_type 区分。直接调底层
        // repository 写入以使用 source_type="clipboard"。
        commit_staged_as_source_type(
            &mut connection,
            context,
            staged,
            "clipboard",
            original_filename,
        )
    }
}

/// 与 `commit_staged` 等价，但允许指定 `source_type`（用于 clipboard 路径）。
fn commit_staged_as_source_type(
    connection: &mut rusqlite::Connection,
    context: &ImportContext,
    staged: crate::services::asset_service::StagedAsset,
    source_type: &'static str,
    original_filename: &str,
) -> Result<ImportOneOutcome, String> {
    if let Some(existing) = EmojiRepository::find_managed_by_sha256(connection, &staged.sha256)? {
        if !Path::new(&existing.path).is_file() {
            return Err(format!(
                "数据库中已有相同图片，但素材文件不存在：{}",
                existing.path
            ));
        }
        return Ok(ImportOneOutcome::Duplicate);
    }

    let file_extension = staged.file_extension.clone();
    let file_size = staged.file_size;
    let sha256 = staged.sha256.clone();
    let width = staged.width;
    let height = staged.height;
    let committed = staged.commit(&context.emojis_directory, &context.thumbnails_directory)?;
    let managed_path = committed.managed_path.to_string_lossy().into_owned();
    let thumbnail_path = committed.thumbnail_path.to_string_lossy().into_owned();
    let timestamp = unix_time_millis();
    let record = NewManagedEmoji {
        source_type,
        source_path: &managed_path,
        managed_path: &managed_path,
        original_filename,
        file_extension: &file_extension,
        file_size,
        sha256: &sha256,
        width,
        height,
        thumbnail_path: &thumbnail_path,
        imported_at: timestamp,
        indexed_at: timestamp,
        is_favorite: false,
    };

    if let Err(error) = EmojiRepository::insert_managed(connection, &record) {
        committed.rollback();
        return Err(error);
    }

    Ok(ImportOneOutcome::Imported(IndexedImage {
        name: original_filename.to_string(),
        path: managed_path,
        extension: file_extension,
        width,
        height,
        size_bytes: file_size,
    }))
}

#[derive(Debug)]
pub enum ImportOneOutcome {
    Imported(IndexedImage),
    Duplicate,
}

fn commit_staged(
    connection: &mut rusqlite::Connection,
    context: &ImportContext,
    staged: crate::services::asset_service::StagedAsset,
) -> Result<ImportOneOutcome, String> {
    let original_filename = staged.original_filename.clone();
    commit_staged_as_source_type(
        connection,
        context,
        staged,
        "managed_import",
        &original_filename,
    )
}

fn import_one(
    connection: &mut rusqlite::Connection,
    context: &ImportContext,
    source_path: &Path,
) -> Result<ImportOneOutcome, String> {
    let staged = AssetService::stage_file(source_path, &context.emojis_directory)?;
    commit_staged(connection, context, staged)
}

fn collect_candidates(
    requested_paths: &[PathBuf],
    summary: &mut ManagedImportSummary,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for requested_path in requested_paths {
        if requested_path.is_file() {
            candidates.push(requested_path.clone());
            continue;
        }
        if requested_path.is_dir() {
            for entry in WalkDir::new(requested_path).follow_links(false) {
                match entry {
                    Ok(entry) if entry.file_type().is_file() && !entry.file_type().is_symlink() => {
                        candidates.push(entry.into_path());
                    }
                    Ok(_) => {}
                    Err(error) => {
                        summary.record_failure(requested_path, format!("无法读取目录项：{error}"))
                    }
                }
            }
            continue;
        }
        summary.record_failure(requested_path, "导入路径不存在或不可访问。".to_string());
    }
    candidates.sort();
    candidates
}

fn unix_time_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        time::SystemTime,
    };

    use image::{DynamicImage, Rgba, RgbaImage};

    use super::{ImportContext, ImportOneOutcome, ImportService};
    use crate::database::{open_connection, run_migrations};

    fn test_root(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("emobox-{label}-{}-{unique}", std::process::id()));
        fs::create_dir_all(&root).expect("create test root");
        root
    }

    fn context(root: &std::path::Path) -> ImportContext {
        let emojis_directory = root.join("assets/emojis");
        let thumbnails_directory = root.join("assets/thumbnails");
        fs::create_dir_all(&emojis_directory).expect("create emojis directory");
        fs::create_dir_all(&thumbnails_directory).expect("create thumbnails directory");
        let database_path = root.join("emobox.sqlite3");
        let mut connection = open_connection(&database_path).expect("open database");
        run_migrations(&mut connection).expect("run migrations");
        ImportContext {
            database_path,
            emojis_directory,
            thumbnails_directory,
        }
    }

    fn write_png(path: &std::path::Path) {
        let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(4, 3, Rgba([20, 40, 60, 255])));
        image.save(path).expect("write png");
    }

    #[test]
    fn repeated_import_uses_one_record_and_one_asset() {
        let root = test_root("dedupe");
        let context = context(&root);
        let source = root.join("source.png");
        write_png(&source);

        let first = ImportService::import_paths(&context, std::slice::from_ref(&source))
            .expect("first import");
        let second = ImportService::import_paths(&context, std::slice::from_ref(&source))
            .expect("second import");

        assert_eq!(
            (
                first.success_count,
                first.duplicate_count,
                first.failed_count
            ),
            (1, 0, 0)
        );
        assert_eq!(
            (
                second.success_count,
                second.duplicate_count,
                second.failed_count
            ),
            (0, 1, 0)
        );
        fs::remove_file(&source).expect("remove original source");
        let managed_path = std::path::Path::new(&first.items[0].path);
        assert!(managed_path.is_file());
        image::open(managed_path).expect("managed asset remains readable");
        assert_eq!(
            fs::read_dir(&context.emojis_directory)
                .expect("read assets")
                .count(),
            1
        );
        assert_eq!(
            fs::read_dir(&context.thumbnails_directory)
                .expect("read thumbnails")
                .count(),
            1
        );

        let connection = open_connection(&context.database_path).expect("open database");
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM emojis", [], |row| row.get(0))
            .expect("count emojis");
        assert_eq!(count, 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn directory_import_is_recursive() {
        let root = test_root("recursive");
        let context = context(&root);
        let input_directory = root.join("input/nested");
        fs::create_dir_all(&input_directory).expect("create nested input");
        write_png(&input_directory.join("nested.png"));

        let summary =
            ImportService::import_paths(&context, &[root.join("input")]).expect("recursive import");
        assert_eq!(
            (
                summary.success_count,
                summary.duplicate_count,
                summary.failed_count
            ),
            (1, 0, 0)
        );
        assert_eq!(
            fs::read_dir(&context.emojis_directory)
                .expect("read assets")
                .count(),
            1
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn database_failure_rolls_back_asset_and_thumbnail() {
        let root = test_root("rollback");
        let context = context(&root);
        let source = root.join("source.png");
        write_png(&source);
        let connection = open_connection(&context.database_path).expect("open database");
        connection
            .execute_batch(
                "CREATE TRIGGER reject_managed_import
                 BEFORE INSERT ON emojis
                 BEGIN
                   SELECT RAISE(ABORT, 'forced insert failure');
                 END;",
            )
            .expect("create failure trigger");
        drop(connection);

        let summary = ImportService::import_paths(&context, &[source]).expect("import summary");
        assert_eq!(
            (
                summary.success_count,
                summary.duplicate_count,
                summary.failed_count
            ),
            (0, 0, 1)
        );
        assert_eq!(
            fs::read_dir(&context.emojis_directory)
                .expect("read assets")
                .count(),
            0
        );
        assert_eq!(
            fs::read_dir(&context.thumbnails_directory)
                .expect("read thumbnails")
                .count(),
            0
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn import_dynamic_image_inserts_with_source_type_clipboard() {
        let root = test_root("dyn-insert");
        let context = context(&root);
        let image =
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(4, 3, Rgba([50, 100, 150, 255])));

        let outcome =
            ImportService::import_dynamic_image(&context, image, "png", "clipboard-test.png")
                .expect("import_dynamic_image should succeed");

        match outcome {
            ImportOneOutcome::Imported(item) => {
                assert_eq!(item.extension, "png");
                assert!(Path::new(&item.path).is_file());
            }
            other => panic!("expected Imported, got {other:?}"),
        }

        let connection = open_connection(&context.database_path).expect("open database");
        let (source_type, count): (String, i64) = connection
            .query_row(
                "SELECT source_type, COUNT(*) FROM emojis WHERE source_type = 'clipboard'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query clipboard rows");
        assert_eq!(source_type, "clipboard");
        assert_eq!(count, 1);

        assert_eq!(
            fs::read_dir(&context.emojis_directory)
                .expect("read assets")
                .count(),
            1
        );
        assert_eq!(
            fs::read_dir(&context.thumbnails_directory)
                .expect("read thumbnails")
                .count(),
            1
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn import_dynamic_image_dedupes_on_second_call() {
        let root = test_root("dyn-dedupe");
        let context = context(&root);
        let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(8, 6, Rgba([20, 40, 60, 255])));

        let first =
            ImportService::import_dynamic_image(&context, image.clone(), "png", "first.png")
                .expect("first import");
        let second = ImportService::import_dynamic_image(&context, image, "png", "second.png")
            .expect("second import");

        match second {
            ImportOneOutcome::Duplicate => {}
            other => panic!("expected Duplicate, got {other:?}"),
        }
        match first {
            ImportOneOutcome::Imported(_) => {}
            other => panic!("first expected Imported, got {other:?}"),
        }

        assert_eq!(
            fs::read_dir(&context.emojis_directory)
                .expect("read assets")
                .count(),
            1
        );

        let _ = fs::remove_dir_all(root);
    }
}
