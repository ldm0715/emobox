use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use image::DynamicImage;
use serde::Serialize;
use walkdir::WalkDir;

use crate::{
    database, perceptual_hash,
    repositories::emoji_repository::{DedupHitKind, EmojiRepository, ImportGroup, NewManagedEmoji},
    repositories::tag_repository::TagRepository,
    scanner::IndexedImage,
    services::asset_service::AssetService,
};

const FAILURE_DETAIL_LIMIT: usize = 50;
/// 每次导入触发的感知哈希惰性回填上限（迁移 0004 后旧行为 NULL，逐步补）。
const PERCEPTUAL_BACKFILL_BATCH: i64 = 50;
static IMPORT_LOCK: Mutex<()> = Mutex::new(());

/// 取全局导入锁。若之前某次导入因 panic 毒化了互斥量，仍恢复使用，
/// 不让一次异常永久阻塞后续所有导入（配合上层 `Result` 错误处理）。
fn lock_import() -> MutexGuard<'static, ()> {
    IMPORT_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerceptualDuplicateInfo {
    /// 本次尝试导入的源路径（供前端"强制导入"重试）。
    pub source_path: String,
    /// 命中的候选 emoji id / 可读路径 / 实际 Hamming 距离。
    pub candidate_id: i64,
    pub candidate_path: String,
    pub hamming: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedImportSummary {
    pub success_count: usize,
    pub exact_duplicate_count: usize,
    pub perceptual_duplicate_count: usize,
    pub failed_count: usize,
    pub elapsed_ms: u128,
    pub items: Vec<IndexedImage>,
    pub failures: Vec<ImportFailure>,
    pub perceptual_duplicates: Vec<PerceptualDuplicateInfo>,
}

impl ManagedImportSummary {
    fn new() -> Self {
        Self {
            success_count: 0,
            exact_duplicate_count: 0,
            perceptual_duplicate_count: 0,
            failed_count: 0,
            elapsed_ms: 0,
            items: Vec::new(),
            failures: Vec::new(),
            perceptual_duplicates: Vec::new(),
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

    fn record_perceptual(&mut self, info: PerceptualDuplicateInfo) {
        self.perceptual_duplicate_count += 1;
        if self.perceptual_duplicates.len() < FAILURE_DETAIL_LIMIT {
            self.perceptual_duplicates.push(info);
        }
    }
}

/// 文件夹导入汇总。`groups_created` 只包含本次**真正 INSERT** 的组名，
/// 复用的既有组不计入。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderImportSummary {
    pub success_count: usize,
    pub exact_duplicate_count: usize,
    pub perceptual_duplicate_count: usize,
    pub failed_count: usize,
    pub groups_created: Vec<String>,
    pub elapsed_ms: u128,
    pub items: Vec<IndexedImage>,
    pub failures: Vec<ImportFailure>,
    pub perceptual_duplicates: Vec<PerceptualDuplicateInfo>,
}

impl FolderImportSummary {
    fn new() -> Self {
        Self {
            success_count: 0,
            exact_duplicate_count: 0,
            perceptual_duplicate_count: 0,
            failed_count: 0,
            groups_created: Vec::new(),
            elapsed_ms: 0,
            items: Vec::new(),
            failures: Vec::new(),
            perceptual_duplicates: Vec::new(),
        }
    }

    fn record_warning(&mut self, message: String) {
        self.failed_count += 1;
        if self.failures.len() < FAILURE_DETAIL_LIMIT {
            self.failures.push(ImportFailure {
                path: String::new(),
                message,
            });
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

    fn record_perceptual(&mut self, info: PerceptualDuplicateInfo) {
        self.perceptual_duplicate_count += 1;
        if self.perceptual_duplicates.len() < FAILURE_DETAIL_LIMIT {
            self.perceptual_duplicates.push(info);
        }
    }
}

pub struct ImportService;

impl ImportService {
    pub fn import_paths(
        context: &ImportContext,
        requested_paths: &[PathBuf],
        skip_perceptual_dedup: bool,
    ) -> Result<ManagedImportSummary, String> {
        let _guard = lock_import();
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
                // 同一批里路径重复视为精确重复（源路径相同）。
                summary.exact_duplicate_count += 1;
                continue;
            }

            match import_one(
                &mut connection,
                context,
                &canonical,
                ImportGroup::None,
                skip_perceptual_dedup,
            ) {
                Ok(ImportOneOutcome::Imported { item, .. }) => {
                    summary.success_count += 1;
                    summary.items.push(item);
                }
                Ok(ImportOneOutcome::ExactDuplicate) => {
                    summary.exact_duplicate_count += 1;
                }
                Ok(ImportOneOutcome::PerceptualDuplicate(info)) => {
                    summary.record_perceptual(info);
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
        skip_perceptual_dedup: bool,
    ) -> Result<ImportOneOutcome, String> {
        let _guard = lock_import();
        let mut connection = database::open_connection(&context.database_path)?;
        let staged = AssetService::stage_dynamic_image(
            &context.emojis_directory,
            image,
            file_extension,
            original_filename,
        )?;
        // commit_staged 期望 source_type="managed_import"；clipboard 路径在 SQL 字段
        // 里允许同样的 managed_path/sha256 约束，但需要 source_type 区分。直接调底层
        // repository 写入以使用 source_type="clipboard"。剪贴板没有源文件路径。
        commit_staged_as_source_type(
            &mut connection,
            context,
            staged,
            "clipboard",
            original_filename,
            None,
            ImportGroup::None,
            skip_perceptual_dedup,
        )
    }

    /// 从原始字节（剪贴板 "image/gif" 注册格式）导入素材，保留动画。
    ///
    /// 与 `import_dynamic_image` 同构：入口取 `IMPORT_LOCK`，双通道去重
    /// （SHA-256 对**原始 gif 字节**计算 —— 同一 GIF 反复收藏、或与磁盘导入的
    /// 同一 GIF 都会撞 SHA），dHash 对首帧计算，DB 失败回滚已落盘文件。
    /// `source_type` 固定 `"clipboard"`（自动文件名标签随之跳过）。
    pub fn import_bytes(
        context: &ImportContext,
        bytes: Vec<u8>,
        file_extension: &str,
        original_filename: &str,
        skip_perceptual_dedup: bool,
    ) -> Result<ImportOneOutcome, String> {
        let _guard = lock_import();
        let mut connection = database::open_connection(&context.database_path)?;
        let staged = AssetService::stage_bytes(
            &context.emojis_directory,
            &bytes,
            file_extension,
            original_filename,
        )?;
        commit_staged_as_source_type(
            &mut connection,
            context,
            staged,
            "clipboard",
            original_filename,
            None,
            ImportGroup::None,
            skip_perceptual_dedup,
        )
    }

    /// 文件夹导入：递归复制所有受支持图片进受管库。
    ///
    /// - 每个**顶层子文件夹**自动建同名分组（懒建：仅当该子文件夹第一张图
    ///   成功导入才建组，失败/重复不建空组）；根目录散图不归组；嵌套目录
    ///   归其顶层子文件夹的分组。
    /// - 分组创建/复用发生在 `insert_managed` 同一事务内，失败整体回滚。
    /// - 重复内容（精确 SHA 或感知）跳过并计入汇总。
    pub fn import_folder(
        context: &ImportContext,
        root: &Path,
        skip_perceptual_dedup: bool,
    ) -> Result<FolderImportSummary, String> {
        let _guard = lock_import();
        let started_at = Instant::now();
        // 统一用 canonical root：`collect_image_files` 返回的路径基于
        // canonicalize 后的根，`strip_prefix` 也必须用同一份根（Windows 上
        // 原路径与 canonical 路径可能因大小写/符号链接不一致）。
        let canonical_root = root
            .canonicalize()
            .map_err(|error| format!("无法访问所选目录 {}：{error}", root.display()))?;
        let (files, warnings) = crate::scanner::collect_image_files(&canonical_root)?;
        let mut summary = FolderImportSummary::new();
        for warning in warnings {
            summary.record_warning(warning);
        }
        let mut connection = database::open_connection(&context.database_path)?;

        // 平铺文件夹：所有图片都在根目录（没有任何子文件夹）时，把文件夹本身
        // 建成一个同名分组，根目录图全部归入。有子文件夹时维持"子文件夹建组、
        // 根目录散图不归组"。
        let flat_folder = files
            .iter()
            .all(|file| top_level_subfolder(file, &canonical_root).is_none());
        let folder_group_name = root
            .file_name()
            .map(|name| name.to_string_lossy().into_owned());

        // 分组名 → 已确认存在的分组 id（首张成功后缓存，避免重复解析）。
        let mut group_cache: HashMap<String, i64> = HashMap::new();

        for file in files {
            // 该文件应归属的分组名（无 → 不归组）。
            let dir = match top_level_subfolder(&file, &canonical_root) {
                Some(sub) => Some(sub),
                None if flat_folder => folder_group_name.clone(),
                None => None,
            };
            let group = match &dir {
                Some(name) => match group_cache.get(name) {
                    Some(id) => ImportGroup::Existing(*id),
                    None => ImportGroup::ByName(name.clone()),
                },
                None => ImportGroup::None,
            };
            match import_one(
                &mut connection,
                context,
                &file,
                group,
                skip_perceptual_dedup,
            ) {
                Ok(ImportOneOutcome::Imported {
                    item,
                    group_id_used,
                    group_created,
                }) => {
                    summary.success_count += 1;
                    summary.items.push(item);
                    if let Some(name) = dir {
                        if let Some(group_id) = group_id_used {
                            group_cache.insert(name.clone(), group_id);
                        }
                        if group_created {
                            summary.groups_created.push(name);
                        }
                    }
                }
                Ok(ImportOneOutcome::ExactDuplicate) => {
                    summary.exact_duplicate_count += 1;
                }
                Ok(ImportOneOutcome::PerceptualDuplicate(info)) => {
                    summary.record_perceptual(info);
                }
                Err(error) => summary.record_failure(&file, error),
            }
        }

        summary.elapsed_ms = started_at.elapsed().as_millis();
        Ok(summary)
    }

    /// 惰性回填存量无标签表情的"文件名"标签（启动时一次性补齐旧数据）。
    ///
    /// 只处理一批（≤ batch），返回实际回填数；调用方循环直到返回值 < batch。
    /// 幂等：`list_untagged_emojis` 只取无任何标签的行，回填后自动跳过。
    /// 单条失败（如标签名非法）只 `log::warn!` 跳过，不中断整体回填。
    pub fn backfill_filename_tags(
        connection: &mut rusqlite::Connection,
        batch: i64,
    ) -> Result<usize, String> {
        let targets = EmojiRepository::list_untagged_emojis(connection, batch)?;
        let mut backfilled = 0usize;
        for (id, original_filename) in targets {
            if original_filename.trim().is_empty() {
                continue;
            }
            match TagRepository::find_or_create_id(connection, &original_filename)
                .and_then(|tag_id| EmojiRepository::add_tags(connection, &[tag_id], &[id]))
            {
                Ok(()) => backfilled += 1,
                Err(error) => {
                    log::warn!("文件名标签回填跳过 emoji_id={id} name={original_filename}：{error}")
                }
            }
        }
        Ok(backfilled)
    }
}

/// 与 `commit_staged` 等价，但允许指定 `source_type`（用于 clipboard 路径）。
/// 参数较多（8 个）是内部编排需要，各参数语义独立，保持扁平可读。
#[allow(clippy::too_many_arguments)]
fn commit_staged_as_source_type(
    connection: &mut rusqlite::Connection,
    context: &ImportContext,
    staged: crate::services::asset_service::StagedAsset,
    source_type: &'static str,
    original_filename: &str,
    source_path: Option<&str>,
    group: ImportGroup,
    skip_perceptual_dedup: bool,
) -> Result<ImportOneOutcome, String> {
    // 双通道去重：SHA-256 字节级 + dHash 感知（可跳过感知做强制导入）。
    if !skip_perceptual_dedup {
        let backfilled = backfill_perceptual_hashes(connection, PERCEPTUAL_BACKFILL_BATCH)?;
        if backfilled > 0 {
            log::info!("已惰性回填 {backfilled} 条感知哈希");
        }
    }
    if let Some(hit) = EmojiRepository::find_duplicate_content(
        connection,
        &staged.sha256,
        staged.perceptual_hash.map(perceptual_hash::to_db),
        perceptual_hash::PERCEPTUAL_HASH_THRESHOLD,
        skip_perceptual_dedup,
    )? {
        if !Path::new(&hit.existing.path).is_file() {
            return Err(format!(
                "数据库中已有相同图片，但素材文件不存在：{}",
                hit.existing.path
            ));
        }
        return match hit.kind {
            DedupHitKind::ExactSha => {
                log::debug!("SHA-256 精确去重命中 candidate_id={}", hit.existing.id);
                Ok(ImportOneOutcome::ExactDuplicate)
            }
            DedupHitKind::Perceptual { hamming } => {
                log::info!(
                    "感知哈希疑似重复：candidate_id={} candidate_path={} hamming={} source={}",
                    hit.existing.id,
                    hit.existing.path,
                    hamming,
                    source_path.unwrap_or(""),
                );
                Ok(ImportOneOutcome::PerceptualDuplicate(
                    PerceptualDuplicateInfo {
                        source_path: source_path.unwrap_or_default().to_string(),
                        candidate_id: hit.existing.id,
                        candidate_path: hit.existing.path,
                        hamming,
                    },
                ))
            }
        };
    }

    let file_extension = staged.file_extension.clone();
    let file_size = staged.file_size;
    let sha256 = staged.sha256.clone();
    let width = staged.width;
    let height = staged.height;
    // commit 会 move staged，先把感知哈希取出。
    let perceptual_hash = staged.perceptual_hash.map(perceptual_hash::to_db);
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
        updated_at: timestamp,
        is_favorite: false,
        perceptual_hash,
        group,
    };

    // emoji + 分组关联同一事务；DB 失败 → 回滚已落盘文件。
    let insert_result = match EmojiRepository::insert_managed(connection, &record) {
        Ok(result) => result,
        Err(error) => {
            committed.rollback();
            return Err(error);
        }
    };

    // 导入自动打"文件名"标签（完整文件名含扩展名，如 `开心.png`），让表情可被
    // `组*开心` / `组*开心.png` 精确搜到。剪贴板合成名（`clipboard-…`）无搜索
    // 意义，跳过。标签是锦上添花：任何失败只记日志，不失败导入。
    if source_type != "clipboard" && !original_filename.trim().is_empty() {
        match TagRepository::find_or_create_id(connection, original_filename).and_then(|tag_id| {
            EmojiRepository::add_tags(connection, &[tag_id], &[insert_result.emoji_id])
        }) {
            Ok(()) => {}
            Err(error) => log::warn!(
                "导入自动打标签失败 emoji_id={} name={original_filename}：{error}",
                insert_result.emoji_id
            ),
        }
    }

    Ok(ImportOneOutcome::Imported {
        item: IndexedImage {
            id: insert_result.emoji_id,
            name: original_filename.to_string(),
            path: managed_path,
            extension: file_extension,
            width,
            height,
            size_bytes: file_size,
        },
        group_id_used: insert_result.group_id,
        group_created: insert_result.group_created,
    })
}

#[derive(Debug)]
pub enum ImportOneOutcome {
    /// 已落库。`group_id_used` / `group_created` 供文件夹导入维护分组缓存
    /// 与 `groups_created` 汇总（只有本次真正新建的组才计入）。
    Imported {
        item: IndexedImage,
        group_id_used: Option<i64>,
        group_created: bool,
    },
    /// SHA-256 字节级相同，直接跳过。
    ExactDuplicate,
    /// dHash 感知命中（疑似重复），保留候选信息供"强制导入"重试。
    PerceptualDuplicate(PerceptualDuplicateInfo),
}

fn commit_staged(
    connection: &mut rusqlite::Connection,
    context: &ImportContext,
    staged: crate::services::asset_service::StagedAsset,
    source_path: &Path,
    group: ImportGroup,
    skip_perceptual_dedup: bool,
) -> Result<ImportOneOutcome, String> {
    let original_filename = staged.original_filename.clone();
    commit_staged_as_source_type(
        connection,
        context,
        staged,
        "managed_import",
        &original_filename,
        Some(&source_path.to_string_lossy()),
        group,
        skip_perceptual_dedup,
    )
}

fn import_one(
    connection: &mut rusqlite::Connection,
    context: &ImportContext,
    source_path: &Path,
    group: ImportGroup,
    skip_perceptual_dedup: bool,
) -> Result<ImportOneOutcome, String> {
    let staged = AssetService::stage_file(source_path, &context.emojis_directory)?;
    commit_staged(
        connection,
        context,
        staged,
        source_path,
        group,
        skip_perceptual_dedup,
    )
}

/// 惰性回填存量受管行的感知哈希（迁移 0004 后旧行为 NULL）。
///
/// 与 `stage_file` 一致用 `decode_for_import`（EXIF 方向 + 动画首帧）计算，
/// 保证跨格式/分辨率稳定。文件缺失 / 损坏 → `log::warn!` 并跳过，不阻塞当前导入。
/// `IS NULL` 守卫保证不重复回填 / 不覆盖已有值；只处理一批（≤ limit），
/// 后续导入继续补，直到存量 NULL 清空。
fn backfill_perceptual_hashes(
    connection: &mut rusqlite::Connection,
    limit: i64,
) -> Result<usize, String> {
    let mut backfilled = 0usize;
    let targets = EmojiRepository::list_null_perceptual(connection, limit)?;
    for (id, managed_path) in targets {
        let path = PathBuf::from(&managed_path);
        match crate::services::asset_service::decode_for_import(&path) {
            Ok(decoded) => {
                let hash = perceptual_hash::dhash(&decoded);
                EmojiRepository::update_perceptual_hash(
                    connection,
                    id,
                    perceptual_hash::to_db(hash),
                )
                .unwrap_or_else(|error| log::warn!("写入感知哈希失败 id={id}：{error}"));
                backfilled += 1;
            }
            Err(error) => {
                log::warn!(
                    "感知哈希回填跳过（文件不可读）id={id} {}：{error}",
                    path.display()
                );
            }
        }
    }
    Ok(backfilled)
}

/// 返回文件相对 `root` 的**顶层子文件夹**名；根目录散图（相对路径只有一级）→ None。
/// 嵌套目录统一归其顶层子文件夹（如 `root/sub/deep/c.png` → `sub`）。
fn top_level_subfolder(file: &Path, root: &Path) -> Option<String> {
    let relative = file.strip_prefix(root).ok()?;
    let mut components = relative.components();
    let first = components.next()?;
    // 至少两级（顶层目录 + 文件名）才说明在子文件夹里。
    components.next()?;
    let name = first.as_os_str().to_string_lossy().into_owned();
    if name.is_empty() { None } else { Some(name) }
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

    /// 平滑渐变图案：跨格式（PNG/JPG）重编码后解码结果仍高度一致，感知哈希稳定。
    fn smooth_pattern(width: u32, height: u32) -> RgbaImage {
        let mut img = RgbaImage::new(width, height);
        for (x, y, pixel) in img.enumerate_pixels_mut() {
            *pixel = Rgba([((x * 8) % 256) as u8, ((y * 16) % 256) as u8, 128, 255]);
        }
        img
    }

    /// 棋盘格：与渐变结构差异大，避免文件夹测试中误触发感知判重。
    fn checker(width: u32, height: u32, cell: u32) -> DynamicImage {
        let mut img = RgbaImage::new(width, height);
        for (x, y, pixel) in img.enumerate_pixels_mut() {
            let on = ((x / cell) + (y / cell)) % 2 == 0;
            *pixel = Rgba([if on { 255 } else { 0 }, 0, 128, 255]);
        }
        DynamicImage::ImageRgba8(img)
    }

    fn folder_context(root: &std::path::Path) -> ImportContext {
        context(root)
    }

    #[test]
    fn folder_import_creates_groups_from_top_level() {
        let root = test_root("folder-groups");
        let context = folder_context(&root);
        let input = root.join("input");
        let cat = input.join("猫猫");
        let dog = input.join("狗狗");
        fs::create_dir_all(&cat).expect("create cat dir");
        fs::create_dir_all(&dog).expect("create dog dir");
        smooth_pattern(32, 32)
            .save(cat.join("a.png"))
            .expect("write a");
        checker(48, 48, 8).save(dog.join("b.png")).expect("write b");

        let summary = ImportService::import_folder(&context, &input, false).expect("import folder");
        assert_eq!(summary.success_count, 2);
        assert_eq!(summary.exact_duplicate_count, 0);
        assert_eq!(summary.failed_count, 0);
        // 分组创建顺序取决于文件路径排序（不保证字典序），按集合比较。
        let mut actual_groups = summary.groups_created.clone();
        actual_groups.sort();
        let mut expected_groups = vec!["猫猫".to_string(), "狗狗".to_string()];
        expected_groups.sort();
        assert_eq!(actual_groups, expected_groups);

        let connection = open_connection(&context.database_path).expect("open");
        let group_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM groups", [], |row| row.get(0))
            .expect("groups");
        assert_eq!(group_count, 2);
        let relation_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM emoji_groups", [], |row| row.get(0))
            .expect("relations");
        assert_eq!(relation_count, 2, "每张图都应归组");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn folder_import_nested_files_go_to_top_level() {
        let root = test_root("folder-nested");
        let context = folder_context(&root);
        let input = root.join("input");
        fs::create_dir_all(input.join("pack/deep")).expect("create nested");
        checker(32, 32, 4)
            .save(input.join("pack/deep/c.png"))
            .expect("write c");
        smooth_pattern(32, 32)
            .save(input.join("pack/d.png"))
            .expect("write d");

        let summary = ImportService::import_folder(&context, &input, false).expect("import folder");
        assert_eq!(summary.success_count, 2);
        assert_eq!(summary.groups_created, vec!["pack"], "深层文件归顶层目录");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn folder_import_flat_folder_creates_group_named_after_folder() {
        let root = test_root("folder-flat");
        let context = folder_context(&root);
        let input = root.join("input");
        fs::create_dir_all(&input).expect("create input dir");
        // 图片全在根目录（无子文件夹）→ 平铺文件夹，文件夹本身建同名组。
        smooth_pattern(32, 32)
            .save(input.join("a.png"))
            .expect("write a");
        checker(48, 48, 8)
            .save(input.join("b.png"))
            .expect("write b");

        let summary = ImportService::import_folder(&context, &input, false).expect("import folder");
        assert_eq!(summary.success_count, 2);
        assert_eq!(
            summary.groups_created,
            vec!["input"],
            "平铺文件夹应以文件夹名建组"
        );

        let connection = open_connection(&context.database_path).expect("open");
        let relation_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM emoji_groups", [], |row| row.get(0))
            .expect("relations");
        assert_eq!(relation_count, 2, "根目录所有图都应归入该组");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn folder_import_root_files_ungrouped() {
        let root = test_root("folder-root");
        let context = folder_context(&root);
        let input = root.join("input");
        fs::create_dir_all(input.join("pack")).expect("create pack");
        smooth_pattern(32, 32)
            .save(input.join("scatter.png"))
            .expect("write scatter");
        checker(32, 32, 4)
            .save(input.join("pack/b.png"))
            .expect("write b");

        let summary = ImportService::import_folder(&context, &input, false).expect("import folder");
        assert_eq!(summary.success_count, 2);
        assert_eq!(summary.groups_created, vec!["pack"]);

        let connection = open_connection(&context.database_path).expect("open");
        let relation_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM emoji_groups", [], |row| row.get(0))
            .expect("relations");
        assert_eq!(relation_count, 1, "根目录散图不归组");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn folder_import_dedupes_across_subfolders_without_empty_group() {
        let root = test_root("folder-dedupe");
        let context = folder_context(&root);
        let input = root.join("input");
        let cat = input.join("猫猫");
        let dog = input.join("狗狗");
        fs::create_dir_all(&cat).expect("create cat");
        fs::create_dir_all(&dog).expect("create dog");
        smooth_pattern(64, 64)
            .save(cat.join("a.png"))
            .expect("write a");
        // 同字节图片放进第二个子文件夹 → 精确重复。
        smooth_pattern(64, 64)
            .save(dog.join("a-copy.png"))
            .expect("write copy");

        let summary = ImportService::import_folder(&context, &input, false).expect("import folder");
        assert_eq!(summary.success_count, 1);
        assert_eq!(summary.exact_duplicate_count, 1);
        // 两个子文件夹内容相同：先导入的那个建组，重复的那个子文件夹不建空组。
        // 只断言"恰好建了一个组"，不依赖文件排序决定哪个幸存。
        assert_eq!(summary.groups_created.len(), 1, "重复子文件夹不建空组");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn folder_import_all_duplicates_creates_no_groups() {
        let root = test_root("folder-all-dup");
        let context = folder_context(&root);
        let input = root.join("input");
        fs::create_dir_all(input.join("pack")).expect("create pack");
        smooth_pattern(64, 64)
            .save(input.join("pack/a.png"))
            .expect("write a");

        let first = ImportService::import_folder(&context, &input, false).expect("first import");
        assert_eq!(first.groups_created, vec!["pack"]);
        let second = ImportService::import_folder(&context, &input, false).expect("second import");
        assert_eq!(second.success_count, 0);
        assert_eq!(second.groups_created.len(), 0, "重复导入不建新组");

        let connection = open_connection(&context.database_path).expect("open");
        let group_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM groups", [], |row| row.get(0))
            .expect("groups");
        assert_eq!(group_count, 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn folder_import_failure_does_not_create_empty_group() {
        let root = test_root("folder-fail");
        let context = folder_context(&root);
        let input = root.join("input");
        let bad = input.join("坏图");
        fs::create_dir_all(&bad).expect("create bad dir");
        fs::write(bad.join("corrupt.png"), b"not a real png").expect("write corrupt");

        let summary = ImportService::import_folder(&context, &input, false).expect("import folder");
        assert_eq!(summary.success_count, 0);
        assert_eq!(summary.failed_count, 1);
        assert!(summary.groups_created.is_empty(), "导入失败不得产生空组");

        let connection = open_connection(&context.database_path).expect("open");
        let group_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM groups", [], |row| row.get(0))
            .expect("groups");
        assert_eq!(group_count, 0);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn folder_import_reuses_existing_group_without_groups_created() {
        let root = test_root("folder-reuse");
        let context = folder_context(&root);
        let input = root.join("input");
        fs::create_dir_all(input.join("猫猫")).expect("create cat dir");
        checker(32, 32, 4)
            .save(input.join("猫猫/a.png"))
            .expect("write a");
        // 预先建好同名组。
        {
            let conn = open_connection(&context.database_path).expect("open");
            conn.execute(
                "INSERT INTO groups (name, sort_order, created_at, updated_at) VALUES ('猫猫', 0, 0, 0)",
                [],
            )
            .expect("pre-create group");
        }

        let summary = ImportService::import_folder(&context, &input, false).expect("import folder");
        assert_eq!(summary.success_count, 1);
        assert!(
            summary.groups_created.is_empty(),
            "复用既有组不计入 groups_created"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn folder_import_auto_tags_filename() {
        let root = test_root("folder-tags");
        let context = folder_context(&root);
        let input = root.join("input");
        fs::create_dir_all(input.join("猫猫")).expect("create cat dir");
        smooth_pattern(32, 32)
            .save(input.join("猫猫/开心.png"))
            .expect("write a");

        let summary = ImportService::import_folder(&context, &input, false).expect("import folder");
        assert_eq!(summary.success_count, 1);

        let connection = open_connection(&context.database_path).expect("open");
        let emoji_id: i64 = connection
            .query_row("SELECT id FROM emojis", [], |row| row.get(0))
            .expect("emoji id");
        // 标签 = 完整文件名（含扩展名）。
        let (tag_id, tag_name): (i64, String) = connection
            .query_row(
                "SELECT id, name FROM tags WHERE name = '开心.png'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("auto tag");
        assert_eq!(tag_name, "开心.png");
        let relation: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM emoji_tags WHERE emoji_id = ?1 AND tag_id = ?2",
                rusqlite::params![emoji_id, tag_id],
                |row| row.get(0),
            )
            .expect("relation");
        assert_eq!(relation, 1, "导入的表情应打上文件名标签");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn import_paths_auto_tags_filename() {
        let root = test_root("paths-tags");
        let context = context(&root);
        let source = root.join("搞笑.png");
        write_png(&source);

        let summary = ImportService::import_paths(&context, &[source], false).expect("import");
        assert_eq!(summary.success_count, 1);
        let connection = open_connection(&context.database_path).expect("open");
        let tag_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM tags WHERE name = '搞笑.png'",
                [],
                |row| row.get(0),
            )
            .expect("tag");
        assert_eq!(tag_count, 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn clipboard_import_does_not_auto_tag() {
        let root = test_root("clipboard-notags");
        let context = context(&root);
        let image =
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(4, 3, Rgba([50, 100, 150, 255])));
        let outcome = ImportService::import_dynamic_image(
            &context,
            image,
            "png",
            "clipboard-test.png",
            false,
        )
        .expect("import_dynamic_image");
        assert!(matches!(outcome, ImportOneOutcome::Imported { .. }));

        let connection = open_connection(&context.database_path).expect("open");
        let relation_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM emoji_tags", [], |row| row.get(0))
            .expect("relations");
        assert_eq!(relation_count, 0, "剪贴板收藏不打文件名标签");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn backfill_filename_tags_skips_trash_and_is_idempotent() {
        let root = test_root("backfill-tags");
        let context = context(&root);

        // 直接插两行无标签 emoji：一行活跃、一行在回收站。
        {
            let conn = open_connection(&context.database_path).expect("open");
            for (name, deleted) in [("活跃.png", 0), ("已删.png", 1)] {
                conn.execute(
                    "INSERT INTO emojis (source_type, source_path, managed_path, original_filename, file_extension, file_size, sha256, width, height, thumbnail_path, imported_at, indexed_at, last_used_at, usage_count, is_favorite, is_deleted)
                     VALUES ('managed_import', ?1, ?1, ?2, 'png', 1, ?1, 1, 1, NULL, 0, 0, NULL, 0, 0, ?3)",
                    rusqlite::params![format!("/{name}"), name, deleted],
                )
                .expect("insert emoji");
            }
        }

        let mut conn = open_connection(&context.database_path).expect("open");
        let first = ImportService::backfill_filename_tags(&mut conn, 50).expect("backfill");
        assert_eq!(first, 1, "只有活跃行被回填");

        let tag_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tags", [], |row| row.get(0))
            .expect("tags");
        assert_eq!(tag_count, 1);
        let relation_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM emoji_tags", [], |row| row.get(0))
            .expect("relations");
        assert_eq!(relation_count, 1);

        // 幂等：再次回填无新目标。
        let second = ImportService::backfill_filename_tags(&mut conn, 50).expect("backfill again");
        assert_eq!(second, 0, "回填应幂等");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn import_sets_updated_at_initial_to_imported_at() {
        let root = test_root("import-updated-at");
        let context = context(&root);
        let source = root.join("mtime.png");
        write_png(&source);

        let summary = ImportService::import_paths(&context, &[source], false).expect("import");
        assert_eq!(summary.success_count, 1);

        let connection = open_connection(&context.database_path).expect("open");
        let (imported_at, updated_at): (i64, i64) = connection
            .query_row(
                "SELECT imported_at, updated_at FROM emojis LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("timestamps");
        assert_eq!(imported_at, updated_at, "新表情的修改时间初始=导入时间");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn import_dedupes_cross_format_via_perceptual() {
        let root = test_root("cross-format");
        let context = context(&root);
        let png_path = root.join("same.png");
        let jpg_path = root.join("same.jpg");
        let image = DynamicImage::ImageRgba8(smooth_pattern(64, 64));
        image.save(&png_path).expect("save png");
        image.save(&jpg_path).expect("save jpg");

        let first = ImportService::import_paths(&context, &[png_path], false).expect("png import");
        assert_eq!(first.success_count, 1);
        let second = ImportService::import_paths(&context, &[jpg_path], false).expect("jpg import");
        assert_eq!(second.success_count, 0);
        assert_eq!(second.perceptual_duplicate_count, 1, "跨格式同图应感知判重");
    }

    #[test]
    fn import_skip_perceptual_dedup_forces_second_copy() {
        let root = test_root("force-import");
        let context = context(&root);
        let png_path = root.join("same.png");
        let jpg_path = root.join("same.jpg");
        let image = DynamicImage::ImageRgba8(smooth_pattern(64, 64));
        image.save(&png_path).expect("save png");
        image.save(&jpg_path).expect("save jpg");

        ImportService::import_paths(&context, &[png_path], false).expect("seed import");
        let second =
            ImportService::import_paths(&context, &[jpg_path], true).expect("forced import");
        assert_eq!(second.perceptual_duplicate_count, 0);
        assert_eq!(second.success_count, 1, "强制导入应绕过感知判重");
    }

    #[test]
    fn import_backfills_null_perceptual_and_dedupes_against_backfilled() {
        let root = test_root("backfill-dedupe");
        let context = context(&root);
        let png_path = root.join("seed.png");
        let jpg_path = root.join("copy.jpg");
        let image = DynamicImage::ImageRgba8(smooth_pattern(64, 64));
        image.save(&png_path).expect("save png");
        image.save(&jpg_path).expect("save jpg");

        ImportService::import_paths(&context, &[png_path], false).expect("seed import");
        // 把存量行感知哈希置 NULL，模拟迁移 0004 后的旧数据。
        {
            let connection = open_connection(&context.database_path).expect("open");
            connection
                .execute("UPDATE emojis SET perceptual_hash = NULL", [])
                .expect("null out hashes");
        }
        // 再导入同内容 JPG → 先惰性回填存量行 hash，再感知判重命中。
        let second =
            ImportService::import_paths(&context, &[jpg_path], false).expect("copy import");
        assert_eq!(second.success_count, 0);
        assert_eq!(
            second.perceptual_duplicate_count, 1,
            "回填后应与旧跨格式图判重"
        );

        let connection = open_connection(&context.database_path).expect("open");
        let null_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM emojis WHERE perceptual_hash IS NULL",
                [],
                |row| row.get(0),
            )
            .expect("count null");
        assert_eq!(null_count, 0, "存量行应被回填");
    }

    #[test]
    fn repeated_import_uses_one_record_and_one_asset() {
        let root = test_root("dedupe");
        let context = context(&root);
        let source = root.join("source.png");
        write_png(&source);

        let first = ImportService::import_paths(&context, std::slice::from_ref(&source), false)
            .expect("first import");
        let second = ImportService::import_paths(&context, std::slice::from_ref(&source), false)
            .expect("second import");

        assert_eq!(
            (
                first.success_count,
                first.exact_duplicate_count,
                first.failed_count
            ),
            (1, 0, 0)
        );
        assert_eq!(
            (
                second.success_count,
                second.exact_duplicate_count,
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

        let summary = ImportService::import_paths(&context, &[root.join("input")], false)
            .expect("recursive import");
        assert_eq!(
            (
                summary.success_count,
                summary.exact_duplicate_count,
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

        let summary =
            ImportService::import_paths(&context, &[source], false).expect("import summary");
        assert_eq!(
            (
                summary.success_count,
                summary.exact_duplicate_count,
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

        let outcome = ImportService::import_dynamic_image(
            &context,
            image,
            "png",
            "clipboard-test.png",
            false,
        )
        .expect("import_dynamic_image should succeed");

        match outcome {
            ImportOneOutcome::Imported { item, .. } => {
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
    fn import_bytes_inserts_clipboard_gif_with_original_bytes() {
        let root = test_root("bytes-gif");
        let context = context(&root);
        // 用 image crate 的 gif 编码器造一张（静态）GIF —— animation_status 对
        // gif 恒为 Animated，受管副本必须保留原始字节。
        let gif_path = root.join("source.gif");
        DynamicImage::ImageRgba8(smooth_pattern(32, 32))
            .save(&gif_path)
            .expect("write gif");
        let gif_bytes = fs::read(&gif_path).expect("read gif bytes");

        let outcome = ImportService::import_bytes(
            &context,
            gif_bytes.clone(),
            "gif",
            "clipboard-test.gif",
            false,
        )
        .expect("import_bytes should succeed");

        let item = match outcome {
            ImportOneOutcome::Imported { item, .. } => item,
            other => panic!("expected Imported, got {other:?}"),
        };
        assert_eq!(item.extension, "gif");
        let managed = fs::read(&item.path).expect("read managed gif");
        assert_eq!(managed, gif_bytes, "受管 GIF 必须保留原始字节（动画不丢）");

        // source_type='clipboard' 且不打文件名标签（clipboard 跳过自动标签）。
        let connection = open_connection(&context.database_path).expect("open database");
        let (source_type, tag_count): (String, i64) = connection
            .query_row(
                "SELECT e.source_type, \
                 (SELECT COUNT(*) FROM emoji_tags t WHERE t.emoji_id = e.id) \
                 FROM emojis e WHERE e.source_type = 'clipboard'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query clipboard row");
        assert_eq!(source_type, "clipboard");
        assert_eq!(tag_count, 0, "clipboard 来源不打文件名标签");

        assert_eq!(
            fs::read_dir(&context.thumbnails_directory)
                .expect("read thumbnails")
                .count(),
            1,
            "缩略图（首帧）应生成"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn import_bytes_dedupes_on_second_call() {
        let root = test_root("bytes-dedupe");
        let context = context(&root);
        let gif_path = root.join("source.gif");
        DynamicImage::ImageRgba8(smooth_pattern(16, 16))
            .save(&gif_path)
            .expect("write gif");
        let gif_bytes = fs::read(&gif_path).expect("read gif bytes");

        let first =
            ImportService::import_bytes(&context, gif_bytes.clone(), "gif", "first.gif", false)
                .expect("first import");
        assert!(matches!(first, ImportOneOutcome::Imported { .. }));

        // 同一 GIF 字节再收藏 → SHA-256 精确命中。
        let second = ImportService::import_bytes(&context, gif_bytes, "gif", "second.gif", false)
            .expect("second import");
        assert!(matches!(second, ImportOneOutcome::ExactDuplicate));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn import_dynamic_image_dedupes_on_second_call() {
        let root = test_root("dyn-dedupe");
        let context = context(&root);
        let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(8, 6, Rgba([20, 40, 60, 255])));

        let first =
            ImportService::import_dynamic_image(&context, image.clone(), "png", "first.png", false)
                .expect("first import");
        let second =
            ImportService::import_dynamic_image(&context, image, "png", "second.png", false)
                .expect("second import");

        match second {
            ImportOneOutcome::ExactDuplicate => {}
            other => panic!("expected ExactDuplicate, got {other:?}"),
        }
        match first {
            ImportOneOutcome::Imported { .. } => {}
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
