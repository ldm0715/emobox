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
//! 设置页的存量回填补上。

pub mod ai_studio_ocr;
pub mod tag_text;
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
}

impl OcrEngineKind {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "off" => Some(Self::Off),
            "windows" => Some(Self::Windows),
            "aiStudio" => Some(Self::AiStudio),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct OcrConfig {
    pub engine: OcrEngineKind,
    pub ai_studio_api_url: String,
    pub ai_studio_token: String,
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

    pub fn set(&self, engine: OcrEngineKind, api_url: String, token: String) {
        let mut config = self.lock();
        config.engine = engine;
        config.ai_studio_api_url = api_url;
        config.ai_studio_token = token;
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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrTagsUpdatedPayload {
    pub phase: OcrPhase,
    pub processed: u32,
    pub total: u32,
    pub finished: bool,
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
            png_bytes,
        ),
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
}

pub fn capabilities() -> OcrCapabilities {
    let (windows_ocr_available, windows_languages) = windows_ocr_capabilities();
    OcrCapabilities {
        windows_ocr_available,
        windows_languages,
    }
}

// ---------- 批处理编排 ----------

/// 处理一批 emoji id。阻塞调用——调用方必须放在 `spawn_blocking` 里。
/// 批处理全局串行（`OCR_LOCK`）；云端引擎出错时中止本批（剩余行保持
/// NULL，下次回填重试），本地引擎单张失败仅跳过。
pub fn process_emoji_ids(
    app: &AppHandle,
    database_path: &Path,
    emoji_ids: Vec<i64>,
    phase: OcrPhase,
    config: OcrConfig,
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
    let mut processed = 0usize;
    let mut tagged = 0usize;
    for (index, emoji_id) in emoji_ids.iter().enumerate() {
        let Some(managed_path) = load_pending_path(&connection, *emoji_id) else {
            continue;
        };
        match recognize_row(&mut connection, &config, *emoji_id, &managed_path) {
            Ok(has_tags) => {
                processed += 1;
                if has_tags {
                    tagged += 1;
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
            emit_progress(app, phase, processed, total, false);
            if tagged > 0 {
                quick_search::notify_library_changed(app);
            }
        }
        if is_cloud_engine && index + 1 < total {
            thread::sleep(AI_STUDIO_THROTTLE);
        }
    }
    // 批末事件无条件发一次（哪怕整批都被跳过/中止）：前端靠它解除回填
    // 「进行中」状态。
    emit_progress(app, phase, processed, total, true);
    if tagged > 0 {
        quick_search::notify_library_changed(app);
    }
}

/// 行仍待处理（未软删、ocr_text 为 NULL）才返回其受管路径。
fn load_pending_path(connection: &Connection, emoji_id: i64) -> Option<String> {
    connection
        .query_row(
            "SELECT managed_path FROM emojis
             WHERE id = ?1 AND is_deleted = 0 AND ocr_text IS NULL",
            params![emoji_id],
            |row| row.get::<_, String>(0),
        )
        .ok()
}

/// 识别单张并落库。返回是否打上了至少一个标签。云端引擎的网络/配额错误
/// 会上抛（调用方中止整批）；本地错误（文件缺失 / 解码失败 / Windows OCR
/// 不可用）就地吞掉：文件级问题写 `ocr_text = ''` 防止无限重试，引擎级
/// 问题保留 NULL 等重试。
fn recognize_row(
    connection: &mut Connection,
    config: &OcrConfig,
    emoji_id: i64,
    managed_path: &str,
) -> Result<bool, String> {
    let png_bytes = match image_to_ocr_png(managed_path) {
        Ok(bytes) => bytes,
        Err(error) => {
            log::warn!("OCR 读取图片失败 emoji_id={emoji_id} path={managed_path}：{error}");
            mark_processed_without_text(connection, emoji_id);
            return Ok(false);
        }
    };

    let lines = match recognize_lines(config, &png_bytes) {
        Ok(lines) => lines,
        Err(error) => match config.effective_engine() {
            OcrEngineKind::AiStudio => return Err(error),
            OcrEngineKind::Windows => {
                log::warn!("Windows OCR 识别失败 emoji_id={emoji_id}：{error}");
                return Ok(false);
            }
            OcrEngineKind::Off => return Err("OCR 引擎已关闭".to_string()),
        },
    };

    let text = lines.join("\n");
    if let Err(error) = connection.execute(
        "UPDATE emojis SET ocr_text = ?1 WHERE id = ?2 AND ocr_text IS NULL",
        params![text, emoji_id],
    ) {
        log::warn!("OCR 文本落库失败 emoji_id={emoji_id}：{error}");
        return Ok(false);
    }

    let tags = tag_text::extract_tags(&lines);
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

fn emit_progress(app: &AppHandle, phase: OcrPhase, processed: usize, total: usize, finished: bool) {
    let payload = OcrTagsUpdatedPayload {
        phase,
        processed: processed as u32,
        total: total as u32,
        finished,
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

#[cfg(test)]
mod tests {
    use super::OcrConfig;
    use super::OcrEngineKind;
    use super::OcrState;

    #[test]
    fn ocr_state_roundtrips_config() {
        let state = OcrState::new();
        assert_eq!(state.snapshot().effective_engine(), OcrEngineKind::Windows);

        state.set(
            OcrEngineKind::AiStudio,
            "https://api.example.com/ocr".to_string(),
            "tok".to_string(),
        );
        let snapshot = state.snapshot();
        assert_eq!(snapshot.effective_engine(), OcrEngineKind::AiStudio);
        assert_eq!(snapshot.ai_studio_api_url, "https://api.example.com/ocr");
        assert_eq!(snapshot.ai_studio_token, "tok");

        // Off 与引擎切换幂等：重复 set 覆盖。
        state.set(OcrEngineKind::Off, String::new(), String::new());
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
        assert_eq!(OcrEngineKind::from_str("other"), None);
    }

    #[test]
    fn config_defaults_to_windows_engine() {
        let config = OcrConfig::default();
        assert_eq!(config.effective_engine(), OcrEngineKind::Windows);
    }
}
