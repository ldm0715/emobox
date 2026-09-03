//! OCR 识图自动打标签（Phase 32）。
//!
//! 编排：给定一批 emoji id，逐张读受管文件 → 解码（EXIF + 动画首帧）→
//! 超长边降采样 → 重编码 PNG（复用 `AssetService::encode_png_bytes`）→
//! 按引擎识别文本 → `ocr_text` 落库 + 从文本提取标签打上。任何失败只记
//! 日志、绝不影响导入主流程（与文件名标签同一策略）。
//!
//! 并发模型：`OCR_LOCK` 串行化所有后台批处理（并发导入 / 回填 / 重试
//! 排队执行），批内云端引擎按固定间隔节流。幂等守卫是 `ocr_text IS NULL`：
//! 写过（含"识别过但无文字"的空串）就不再重跑，应用退出丢掉的批次由
//! 设置页的存量回填补上。`force = true` 的手动识别（Phase 33，标签弹窗
//! 触发）解除该守卫：重跑引擎覆盖 `ocr_text`，但标签只增不删。

pub mod ai_studio_ocr;
pub mod tag_text;
pub mod tesseract_ocr;
#[cfg(windows)]
pub mod windows_ocr;

use std::path::Path;
use std::sync::Mutex;
use std::sync::MutexGuard;
use std::thread;
use std::time::Duration;

use rusqlite::Connection;
use rusqlite::params;
use serde::Serialize;
use tauri::AppHandle;
use tauri::Emitter;

use crate::database;
use crate::quick_search;
use crate::repositories::emoji_repository::EmojiRepository;
use crate::repositories::tag_repository::TagRepository;
use crate::services::asset_service::AssetService;
use crate::services::asset_service::decode_for_import;
use crate::tray::MAIN_WINDOW_LABEL;

pub const OCR_TAGS_UPDATED_EVENT: &str = "ocr-tags-updated";

/// OCR 送给引擎前，超长边降采样到的尺寸（识别文本够用，控制耗时与流量）。
const OCR_MAX_DIMENSION: u32 = 768;
/// 云端引擎批内节流：AI Studio 免费档有 QPS 限制。
const AI_STUDIO_THROTTLE: Duration = Duration::from_secs(1);
/// 每处理多少张发一次进度事件。
const PROGRESS_EVERY: usize = 10;

// ---------- 配置（前端推送的内存镜像） ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OcrEngineKind {
    Off,
    /// 默认引擎：本地离线、零额度成本（与前端 PersistedSettings 默认一致）。
    #[default]
    Windows,
    AiStudio,
    /// Phase 34：调用外部 Tesseract 命令行，需用户自行安装。
    Tesseract,
}

impl OcrEngineKind {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "off" => Some(Self::Off),
            "windows" => Some(Self::Windows),
            "aiStudio" => Some(Self::AiStudio),
            "tesseract" => Some(Self::Tesseract),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct OcrConfig {
    pub engine: OcrEngineKind,
    pub ai_studio_api_url: String,
    pub ai_studio_token: String,
    /// AI Studio 识别模型（v2 异步 API 的必填请求参数，如 PP-OCRv6；
    /// 空串 = 引擎侧回默认值）。
    pub ai_studio_model: String,
    /// Tesseract 可执行文件路径（空串 = 自动检测：常见安装位置 + PATH）。
    pub tesseract_path: String,
}

impl OcrConfig {
    fn effective_engine(&self) -> OcrEngineKind {
        self.engine
    }
}

/// OCR 设置的 Rust 内存镜像。localStorage 是事实源，前端在挂载和变更时
/// 经 `set_ocr_config` 推送（两个窗口都推、幂等，后到覆盖为相同值）。
/// 与 `SelectionSearchState` / `CloseBehaviorState` 同一模式；仅在 Builder
/// 链上 manage（Phase 30），setup 里禁止重复 manage。
pub struct OcrState {
    config: Mutex<OcrConfig>,
}

impl OcrState {
    pub fn new() -> Self {
        Self {
            config: Mutex::new(OcrConfig::default()),
        }
    }

    pub fn set(
        &self,
        engine: OcrEngineKind,
        api_url: String,
        token: String,
        model: String,
        tesseract_path: String,
    ) {
        let mut config = self.lock();
        config.engine = engine;
        config.ai_studio_api_url = api_url;
        config.ai_studio_token = token;
        config.ai_studio_model = model;
        config.tesseract_path = tesseract_path;
    }

    pub fn snapshot(&self) -> OcrConfig {
        self.lock().clone()
    }

    fn lock(&self) -> MutexGuard<'_, OcrConfig> {
        self.config
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Default for OcrState {
    fn default() -> Self {
        Self::new()
    }
}

// ---------- 事件 payload ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OcrPhase {
    /// 导入完成后对新导入行的后台识别。
    Import,
    /// 设置页「为现有表情补跑识别」触发的存量回填。
    Backfill,
    /// 标签弹窗「OCR 识别」按钮触发的手动识别（force 重跑指定 id）。
    Manual,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrTagsUpdatedPayload {
    pub phase: OcrPhase,
    /// 已完成识别尝试的行数（= tagged + empty + failed，累计）。
    pub processed: u32,
    pub total: u32,
    pub finished: bool,
    /// 识别成功且提取到至少一个标签的行数（累计）。
    pub tagged: u32,
    /// 识别成功但未提取出任何标签的行数（图片无文字，或文字全被标签规则过滤）。
    pub empty: u32,
    /// 识别失败的行数（文件缺失 / 解码失败 / 本地引擎错误；云端错误直接
    /// 中止整批，出错的行不计入——剩余行靠 `processed < total` 体现）。
    pub failed: u32,
}

// ---------- 串行化 ----------

static OCR_LOCK: Mutex<()> = Mutex::new(());

fn lock_ocr() -> MutexGuard<'static, ()> {
    OCR_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

// ---------- 引擎分发 ----------

fn recognize_lines(config: &OcrConfig, png_bytes: &[u8]) -> Result<Vec<String>, String> {
    match config.effective_engine() {
        OcrEngineKind::Off => Err("OCR 引擎已关闭".to_string()),
        OcrEngineKind::Windows => recognize_windows(png_bytes),
        OcrEngineKind::AiStudio => ai_studio_ocr::recognize_lines(
            &config.ai_studio_api_url,
            &config.ai_studio_token,
            &config.ai_studio_model,
            png_bytes,
        ),
        OcrEngineKind::Tesseract => {
            tesseract_ocr::recognize_lines(&config.tesseract_path, png_bytes)
        }
    }
}

#[cfg(windows)]
fn recognize_windows(png_bytes: &[u8]) -> Result<Vec<String>, String> {
    windows_ocr::recognize_lines(png_bytes)
}

#[cfg(not(windows))]
fn recognize_windows(_png_bytes: &[u8]) -> Result<Vec<String>, String> {
    Err("Windows OCR 仅在 Windows 平台可用".to_string())
}

/// Windows OCR 可用性与语言列表（设置页展示）。非 Windows 一律不可用。
pub fn windows_ocr_capabilities() -> (bool, Vec<String>) {
    #[cfg(windows)]
    {
        let languages = windows_ocr::available_language_tags();
        let available = windows_ocr::engine_available();
        (available, languages)
    }
    #[cfg(not(windows))]
    {
        (false, Vec::new())
    }
}

/// 设置页「文字识别」卡片展示的能力信息。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrCapabilities {
    pub windows_ocr_available: bool,
    pub windows_languages: Vec<String>,
    /// Phase 34：Tesseract 检测状态（路径未配置时按常见位置 + PATH 探测）。
    pub tesseract_available: bool,
    pub tesseract_version: Option<String>,
    pub tesseract_languages: Vec<String>,
    pub tesseract_path: Option<String>,
}

pub fn capabilities(config: &OcrConfig) -> OcrCapabilities {
    let (windows_ocr_available, windows_languages) = windows_ocr_capabilities();
    let tesseract = tesseract_ocr::probe(&config.tesseract_path);
    OcrCapabilities {
        windows_ocr_available,
        windows_languages,
        tesseract_available: tesseract.available,
        tesseract_version: tesseract.version,
        tesseract_languages: tesseract.languages,
        tesseract_path: tesseract
            .exe_path
            .map(|path| path.to_string_lossy().into_owned()),
    }
}

// ---------- 批处理编排 ----------

/// 批次累计计数（事件 payload 的数值来源）。processed = tagged + empty + failed。
#[derive(Debug, Clone, Copy, Default)]
struct BatchCounters {
    processed: usize,
    tagged: usize,
    empty: usize,
    failed: usize,
}

/// 处理一批 emoji id。阻塞调用——调用方必须放在 `spawn_blocking` 里。
/// 批处理全局串行（`OCR_LOCK`）；云端引擎出错时中止本批（剩余行保持
/// NULL，下次回填重试），本地引擎单张失败仅跳过。
///
/// `force = false`（导入 / 回填）维持 `ocr_text IS NULL` 幂等守卫；
/// `force = true`（标签弹窗手动识别）对已有识别结果的行重跑引擎并覆盖
/// `ocr_text`——标签只增不删，文件级 / 引擎级失败一律跳过以保留旧文本。
pub fn process_emoji_ids(
    app: &AppHandle,
    database_path: &Path,
    emoji_ids: Vec<i64>,
    phase: OcrPhase,
    config: OcrConfig,
    force: bool,
) {
    if emoji_ids.is_empty() || config.effective_engine() == OcrEngineKind::Off {
        return;
    }
    let _guard = lock_ocr();

    let mut connection = match database::open_connection(database_path) {
        Ok(connection) => connection,
        Err(error) => {
            log::warn!("OCR 打标签：打开数据库失败：{error}");
            return;
        }
    };

    let total = emoji_ids.len();
    let is_cloud_engine = config.effective_engine() == OcrEngineKind::AiStudio;
    let mut counters = BatchCounters::default();
    for (index, emoji_id) in emoji_ids.iter().enumerate() {
        let Some(managed_path) = load_pending_path(&connection, *emoji_id, force) else {
            continue;
        };
        match recognize_row(&mut connection, &config, *emoji_id, &managed_path, force) {
            Ok(outcome) => {
                counters.processed += 1;
                match outcome {
                    RowOutcome::Tagged => counters.tagged += 1,
                    RowOutcome::Empty => counters.empty += 1,
                    RowOutcome::Failed => counters.failed += 1,
                }
            }
            Err(error) => {
                log::warn!("OCR 识别中止 emoji_id={emoji_id}：{error}");
                if is_cloud_engine {
                    // 云端错误（配额/网络/token）继续打剩下的只会徒劳烧时间，
                    // 整批停下，行保持 NULL 等下次回填。
                    break;
                }
            }
        }
        if (index + 1) % PROGRESS_EVERY == 0 {
            emit_progress(app, phase, counters, total, false);
            if counters.tagged > 0 {
                quick_search::notify_library_changed(app);
            }
        }
        if is_cloud_engine && index + 1 < total {
            thread::sleep(AI_STUDIO_THROTTLE);
        }
    }
    // 批末事件无条件发一次（哪怕整批都被跳过/中止）：前端靠它解除回填
    // 「进行中」状态。
    emit_progress(app, phase, counters, total, true);
    if counters.tagged > 0 {
        quick_search::notify_library_changed(app);
    }
}

/// 返回该行的受管路径。`force = false` 时只有仍待识别的行（未软删、
/// ocr_text 为 NULL）才返回路径；`force = true` 时未软删即重跑。
fn load_pending_path(connection: &Connection, emoji_id: i64, force: bool) -> Option<String> {
    let sql = if force {
        "SELECT managed_path FROM emojis WHERE id = ?1 AND is_deleted = 0"
    } else {
        "SELECT managed_path FROM emojis
         WHERE id = ?1 AND is_deleted = 0 AND ocr_text IS NULL"
    };
    connection
        .query_row(sql, params![emoji_id], |row| row.get::<_, String>(0))
        .ok()
}

/// 单行识别的行级结果。Tagged / Empty / Failed 都是一次完整的识别尝试、
/// 计入 `processed` 并进进度事件；只有云端引擎的网络/配额错误走 `Err`
/// 上抛（调用方中止整批）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RowOutcome {
    /// 识别成功并打上至少一个标签。
    Tagged,
    /// 识别成功但没有提取出任何标签（图片无文字，或文字全被标签规则过滤）。
    Empty,
    /// 识别失败：文件缺失 / 解码失败 / 本地引擎错误。行保持原状。
    Failed,
}

/// 识别单张并落库。云端引擎的网络/配额错误会上抛（调用方中止整批）；
/// 本地错误（文件缺失 / 解码失败 / Windows OCR 不可用）就地吞掉：非 force
/// 时文件级问题写 `ocr_text = ''` 防止无限重试、引擎级问题保留 NULL 等重试；
/// force（手动重识别）一律跳过、保留旧文本。
fn recognize_row(
    connection: &mut Connection,
    config: &OcrConfig,
    emoji_id: i64,
    managed_path: &str,
    force: bool,
) -> Result<RowOutcome, String> {
    let png_bytes = match image_to_ocr_png(managed_path) {
        Ok(bytes) => bytes,
        Err(error) => {
            log::warn!("OCR 读取图片失败 emoji_id={emoji_id} path={managed_path}：{error}");
            if !force {
                mark_processed_without_text(connection, emoji_id);
            }
            return Ok(RowOutcome::Failed);
        }
    };

    let lines = match recognize_lines(config, &png_bytes) {
        Ok(lines) => lines,
        Err(error) => match config.effective_engine() {
            OcrEngineKind::AiStudio => return Err(error),
            OcrEngineKind::Windows => {
                log::warn!("Windows OCR 识别失败 emoji_id={emoji_id}：{error}");
                return Ok(RowOutcome::Failed);
            }
            OcrEngineKind::Tesseract => {
                log::warn!("Tesseract OCR 识别失败 emoji_id={emoji_id}：{error}");
                return Ok(RowOutcome::Failed);
            }
            OcrEngineKind::Off => return Err("OCR 引擎已关闭".to_string()),
        },
    };

    let tagged = apply_recognition_result(connection, emoji_id, &lines, force)?;
    Ok(if tagged {
        RowOutcome::Tagged
    } else {
        RowOutcome::Empty
    })
}

/// 识别结果落库：写 `ocr_text`（force 覆盖旧值，非 force 只写仍为 NULL 的
/// 行）并按"只增不删"追加提取的标签。返回是否新增了至少一个标签关联。
/// UPDATE 失败仅记日志、返回无标签（不打断批次）。
fn apply_recognition_result(
    connection: &mut Connection,
    emoji_id: i64,
    lines: &[String],
    force: bool,
) -> Result<bool, String> {
    let text = lines.join("\n");
    let update_sql = if force {
        // 手动重识别：覆盖旧识别文字（标签在下方按"只增不删"追加）。
        "UPDATE emojis SET ocr_text = ?1 WHERE id = ?2"
    } else {
        "UPDATE emojis SET ocr_text = ?1 WHERE id = ?2 AND ocr_text IS NULL"
    };
    if let Err(error) = connection.execute(update_sql, params![text, emoji_id]) {
        log::warn!("OCR 文本落库失败 emoji_id={emoji_id}：{error}");
        return Ok(false);
    }

    let tags = tag_text::extract_tags(lines);
    let mut tagged = false;
    for tag in tags {
        let result = TagRepository::find_or_create_id(connection, &tag)
            .and_then(|tag_id| EmojiRepository::add_tags(connection, &[tag_id], &[emoji_id]));
        match result {
            Ok(()) => tagged = true,
            Err(error) => log::warn!("OCR 标签打标失败 emoji_id={emoji_id} tag={tag}：{error}"),
        }
    }
    Ok(tagged)
}

/// 文件级失败也写 `ocr_text = ''`：图已经不在 / 无法解码，重试没有意义，
/// 留着 NULL 会让每次回填都空转。
fn mark_processed_without_text(connection: &Connection, emoji_id: i64) {
    if let Err(error) = connection.execute(
        "UPDATE emojis SET ocr_text = '' WHERE id = ?1 AND ocr_text IS NULL",
        params![emoji_id],
    ) {
        log::warn!("OCR 标记无文本失败 emoji_id={emoji_id}：{error}");
    }
}

/// 受管文件 → 适合 OCR 的 PNG 字节：解码（EXIF 方向 + 动画首帧）→ 超长边
/// 降到 `OCR_MAX_DIMENSION` → 统一重编码 PNG（两个引擎同一条输入管线）。
fn image_to_ocr_png(managed_path: &str) -> Result<Vec<u8>, String> {
    let image = decode_for_import(Path::new(managed_path))?;
    let (width, height) = (image.width(), image.height());
    let longest = width.max(height);
    let image = if longest > OCR_MAX_DIMENSION {
        let scale = f64::from(OCR_MAX_DIMENSION) / f64::from(longest);
        let scaled_width = ((f64::from(width) * scale) as u32).max(1);
        let scaled_height = ((f64::from(height) * scale) as u32).max(1);
        image.resize_exact(
            scaled_width,
            scaled_height,
            image::imageops::FilterType::Lanczos3,
        )
    } else {
        image
    };
    AssetService::encode_png_bytes(&image)
}

fn emit_progress(
    app: &AppHandle,
    phase: OcrPhase,
    counters: BatchCounters,
    total: usize,
    finished: bool,
) {
    let payload = OcrTagsUpdatedPayload {
        phase,
        processed: counters.processed as u32,
        total: total as u32,
        finished,
        tagged: counters.tagged as u32,
        empty: counters.empty as u32,
        failed: counters.failed as u32,
    };
    if let Err(error) = app.emit_to(MAIN_WINDOW_LABEL, OCR_TAGS_UPDATED_EVENT, payload) {
        log::warn!("发送 {OCR_TAGS_UPDATED_EVENT} 失败：{error}");
    }
}

/// 查询所有待识别（is_deleted = 0 且 ocr_text IS NULL）的 emoji id。
/// 供设置页「存量回填」触发。空表 → 空 Vec。
pub fn list_pending_emoji_ids(database_path: &Path) -> Result<Vec<i64>, String> {
    let connection = database::open_connection(database_path)?;
    let mut statement = connection
        .prepare("SELECT id FROM emojis WHERE is_deleted = 0 AND ocr_text IS NULL ORDER BY id")
        .map_err(|error| format!("查询待识别表情失败：{error}"))?;
    let ids = statement
        .query_map([], |row| row.get::<_, i64>(0))
        .map_err(|error| format!("读取待识别表情失败：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取待识别表情失败：{error}"))?;
    Ok(ids)
}

/// 过滤出指定 id 中存在且未软删的行（保持入参顺序）。供标签弹窗的手动
/// 识别命令在 spawn 后台批次前先算 queued 数，避免为已删除的 id 空跑。
pub fn filter_existing_emoji_ids(
    database_path: &Path,
    emoji_ids: &[i64],
) -> Result<Vec<i64>, String> {
    let connection = database::open_connection(database_path)?;
    let mut existing = Vec::with_capacity(emoji_ids.len());
    for emoji_id in emoji_ids {
        let exists = connection
            .query_row(
                "SELECT 1 FROM emojis WHERE id = ?1 AND is_deleted = 0",
                params![emoji_id],
                |_| Ok(()),
            )
            .is_ok();
        if exists {
            existing.push(*emoji_id);
        }
    }
    Ok(existing)
}

#[cfg(test)]
mod tests {
    use super::OcrConfig;
    use super::OcrEngineKind;
    use super::OcrState;
    use super::*;

    #[test]
    fn ocr_state_roundtrips_config() {
        let state = OcrState::new();
        assert_eq!(state.snapshot().effective_engine(), OcrEngineKind::Windows);

        state.set(
            OcrEngineKind::AiStudio,
            "https://api.example.com/ocr".to_string(),
            "tok".to_string(),
            "PP-OCRv6".to_string(),
            String::new(),
        );
        let snapshot = state.snapshot();
        assert_eq!(snapshot.effective_engine(), OcrEngineKind::AiStudio);
        assert_eq!(snapshot.ai_studio_api_url, "https://api.example.com/ocr");
        assert_eq!(snapshot.ai_studio_token, "tok");
        assert_eq!(snapshot.ai_studio_model, "PP-OCRv6");

        // Off 与引擎切换幂等：重复 set 覆盖。
        state.set(
            OcrEngineKind::Off,
            String::new(),
            String::new(),
            String::new(),
            String::new(),
        );
        assert_eq!(state.snapshot().effective_engine(), OcrEngineKind::Off);
    }

    #[test]
    fn engine_kind_parses_camel_case_names() {
        assert_eq!(OcrEngineKind::from_str("off"), Some(OcrEngineKind::Off));
        assert_eq!(
            OcrEngineKind::from_str("aiStudio"),
            Some(OcrEngineKind::AiStudio)
        );
        assert_eq!(
            OcrEngineKind::from_str("windows"),
            Some(OcrEngineKind::Windows)
        );
        assert_eq!(
            OcrEngineKind::from_str("tesseract"),
            Some(OcrEngineKind::Tesseract)
        );
        assert_eq!(OcrEngineKind::from_str("other"), None);
    }

    #[test]
    fn config_defaults_to_windows_engine() {
        let config = OcrConfig::default();
        assert_eq!(config.effective_engine(), OcrEngineKind::Windows);
    }

    // ---------- 手动识别（Phase 33）----------

    /// 简单的手工 tempdir 替代品（同 trash_service 测试，避免引入新依赖）。
    struct TestDir(std::path::PathBuf);
    impl TestDir {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let path = std::env::temp_dir().join(format!("emobox-ocr-{tag}-{nanos}"));
            std::fs::create_dir_all(&path).expect("mkdir");
            Self(path)
        }
        fn db_path(&self) -> std::path::PathBuf {
            self.0.join("emobox.sqlite3")
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn fresh_db(tag: &str) -> (TestDir, rusqlite::Connection) {
        use rusqlite::Connection;
        let dir = TestDir::new(tag);
        let db_path = dir.db_path();
        let mut connection = Connection::open(&db_path).expect("open");
        crate::database::run_migrations(&mut connection).expect("migrations");
        (dir, connection)
    }

    fn insert_emoji(
        connection: &mut rusqlite::Connection,
        source_path: &str,
        managed_path: Option<&str>,
        ocr_text: Option<&str>,
        deleted: bool,
    ) -> i64 {
        connection
            .execute(
                "INSERT INTO emojis (
                    source_type, source_path, managed_path, original_filename,
                    file_extension, file_size, width, height, sha256, indexed_at,
                    ocr_text, is_deleted
                ) VALUES (
                    'managed_import', ?1, ?2, 'name', 'png', 1, 1, 1, ?3, 0, ?4, ?5
                )",
                rusqlite::params![
                    source_path,
                    managed_path,
                    format!("sha-{source_path}"),
                    ocr_text,
                    deleted as i64
                ],
            )
            .expect("insert emoji");
        connection.last_insert_rowid()
    }

    fn tag_ids_of(connection: &rusqlite::Connection, emoji_id: i64) -> Vec<i64> {
        let mut statement = connection
            .prepare("SELECT tag_id FROM emoji_tags WHERE emoji_id = ?1 ORDER BY tag_id")
            .expect("prepare");
        statement
            .query_map(rusqlite::params![emoji_id], |row| row.get::<_, i64>(0))
            .expect("query")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect")
    }

    #[test]
    fn filter_existing_emoji_ids_skips_deleted_and_missing() {
        let (_dir, mut connection) = fresh_db("filter");
        let kept_a = insert_emoji(&mut connection, "a.png", Some("assets/a.png"), None, false);
        let dropped = insert_emoji(&mut connection, "b.png", Some("assets/b.png"), None, true);
        let kept_b = insert_emoji(&mut connection, "c.png", Some("assets/c.png"), None, false);
        let db_path = _dir.db_path();

        let result =
            filter_existing_emoji_ids(&db_path, &[dropped, kept_a, 999_999, kept_b]).expect("ok");
        assert_eq!(result, vec![kept_a, kept_b]);
    }

    #[test]
    fn load_pending_path_force_bypasses_ocr_text_guard() {
        let (_dir, mut connection) = fresh_db("guard");
        let recognized = insert_emoji(
            &mut connection,
            "a.png",
            Some("assets/a.png"),
            Some("旧文本"),
            false,
        );
        let pending = insert_emoji(&mut connection, "b.png", Some("assets/b.png"), None, false);
        let deleted = insert_emoji(&mut connection, "c.png", Some("assets/c.png"), None, true);

        // 非 force：ocr_text 非空的行与软删行都不可见。
        assert_eq!(load_pending_path(&connection, recognized, false), None);
        assert_eq!(
            load_pending_path(&connection, pending, false),
            Some("assets/b.png".to_string())
        );
        assert_eq!(load_pending_path(&connection, deleted, false), None);

        // force：只挡软删行，已识别的行重跑。
        assert_eq!(
            load_pending_path(&connection, recognized, true),
            Some("assets/a.png".to_string())
        );
        assert_eq!(load_pending_path(&connection, deleted, true), None);
    }

    #[test]
    fn apply_recognition_result_force_overwrites_text_and_only_adds_tags() {
        use crate::repositories::tag_repository::TagRepository;

        let (_dir, mut connection) = fresh_db("apply");
        let emoji_id = insert_emoji(
            &mut connection,
            "a.png",
            Some("assets/a.png"),
            Some("旧文本"),
            false,
        );
        // 旧结果已有的标签"保留"：重识别后必须仍在、且不重复。
        let kept_tag_id =
            TagRepository::find_or_create_id(&mut connection, "保留").expect("create kept tag");
        EmojiRepository::add_tags(&mut connection, &[kept_tag_id], &[emoji_id]).expect("link");

        let lines = vec!["新文字".to_string(), "保留".to_string()];
        let tagged =
            apply_recognition_result(&mut connection, emoji_id, &lines, true).expect("apply force");
        assert!(tagged);

        let text: String = connection
            .query_row(
                "SELECT ocr_text FROM emojis WHERE id = ?1",
                rusqlite::params![emoji_id],
                |row| row.get(0),
            )
            .expect("read ocr_text");
        assert_eq!(text, "新文字\n保留");

        let mut tag_names: Vec<String> = connection
            .prepare(
                "SELECT t.name FROM emoji_tags et JOIN tags t ON t.id = et.tag_id
                 WHERE et.emoji_id = ?1 ORDER BY t.name COLLATE NOCASE",
            )
            .expect("prepare")
            .query_map(rusqlite::params![emoji_id], |row| row.get::<_, String>(0))
            .expect("query")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect");
        tag_names.sort();
        assert_eq!(tag_names, vec!["保留", "新文字"]);

        // 重跑同样结果幂等：不产生重复关联。
        apply_recognition_result(&mut connection, emoji_id, &lines, true).expect("apply again");
        assert_eq!(tag_ids_of(&connection, emoji_id).len(), 2);
    }

    #[test]
    fn apply_recognition_result_without_force_keeps_null_guard() {
        let (_dir, mut connection) = fresh_db("apply-no-force");
        let recognized = insert_emoji(
            &mut connection,
            "a.png",
            Some("assets/a.png"),
            Some("旧文本"),
            false,
        );

        // 非 force 路径只应在 ocr_text IS NULL 时被调用；即使误传，也不覆盖旧文本。
        let lines = vec!["新文字".to_string()];
        apply_recognition_result(&mut connection, recognized, &lines, false).expect("apply");
        let text: String = connection
            .query_row(
                "SELECT ocr_text FROM emojis WHERE id = ?1",
                rusqlite::params![recognized],
                |row| row.get(0),
            )
            .expect("read ocr_text");
        assert_eq!(text, "旧文本");
    }
}
