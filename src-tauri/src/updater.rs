//! 自动更新（GitHub Releases + 镜像前缀加速）。
//!
//! 更新清单是发布到 Release 资产里的 `latest.json`（由
//! `scripts/make-release-manifest.mjs` 从 CHANGES.md 生成）。检查与下载都按
//! 「用户镜像列表 → 官方直连」顺序尝试：镜像源是 gh-proxy 风格的前缀代理，
//! 拼接方式为 `镜像前缀 + 完整 GitHub 文件 URL`。安装包下载后流式计算
//! SHA-256 与清单比对（取代官方 updater 插件的 minisign 签名，省去签名
//! 密钥设施），校验通过才允许启动安装器。

use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

pub const GITHUB_OWNER: &str = "ldm0715";
pub const GITHUB_REPO: &str = "emobox";

const DOWNLOAD_PROGRESS_EVENT: &str = "update-download-progress";
const USER_AGENT: &str = "Mozilla/5.0 (compatible; EmoBox/0.1)";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const READ_TIMEOUT: Duration = Duration::from_secs(15);
const SPEED_TEST_READ_TIMEOUT: Duration = Duration::from_secs(10);
/// 安装包大小上限（防镜像劫持 / 异常响应）。
const MAX_DOWNLOAD_BYTES: u64 = 200 * 1024 * 1024;
/// 进度事件发射间隔：按字节量节流，避免每 64KB 一条事件刷爆 IPC。
const PROGRESS_CHUNK_BYTES: u64 = 256 * 1024;
const MANIFEST_MAX_BYTES: u64 = 4 * 1024 * 1024;
const NO_RELEASE_MESSAGE: &str = "仓库还没有发布任何版本。";

// ---------- URL 构造 ----------

fn release_base_url() -> String {
    format!("https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}")
}

/// latest.json 在 Release 资产里的固定地址（`releases/latest` 恒指向最新版）。
pub fn latest_manifest_url() -> String {
    format!(
        "{}/releases/latest/download/latest.json",
        release_base_url()
    )
}

/// 镜像测速目标：仓库 main 分支的 README.md（镜像均支持 raw 前缀代理，
/// 且不依赖是否已发布 Release）。
pub fn speed_test_url() -> String {
    format!("https://raw.githubusercontent.com/{GITHUB_OWNER}/{GITHUB_REPO}/main/README.md")
}

/// 镜像前缀拼接：镜像须是 http(s) URL（自动补尾斜杠），非法输入返回 None。
pub fn join_mirror(mirror: &str, url: &str) -> Option<String> {
    let mirror = mirror.trim();
    if mirror.is_empty() || url.trim().is_empty() {
        return None;
    }
    let lower = mirror.to_ascii_lowercase();
    if !lower.starts_with("https://") && !lower.starts_with("http://") {
        return None;
    }
    let mut normalized = mirror.trim_end_matches('/').to_string();
    normalized.push('/');
    Some(format!("{normalized}{url}"))
}

/// 检查/下载源序列（带来源）：用户镜像依次在前（过滤误填直连本尊），官方
/// 直连永远兜底在最后（去重）。返回 `(来源镜像, 拼接后的完整 URL)`——来源为
/// `None` 表示官方直连；`check_update` 把它作为 `checkedVia` 报告给前端
/// （默认下载源 = 检查成功命中的那个源）。
pub fn candidate_sources(mirrors: &[String], url: &str) -> Vec<(Option<String>, String)> {
    let mut sources: Vec<(Option<String>, String)> = mirrors
        .iter()
        .filter(|mirror| !mirror_is_github_direct(mirror))
        .filter_map(|mirror| join_mirror(mirror, url).map(|u| (Some(mirror.clone()), u)))
        .collect();
    let direct = url.trim().to_string();
    if !direct.is_empty() && !sources.iter().any(|(_, u)| *u == direct) {
        sources.push((None, direct));
    }
    sources
}

/// 同 `candidate_sources` 但只取 URL 序列（下载路径用）。
pub fn candidate_urls(mirrors: &[String], url: &str) -> Vec<String> {
    candidate_sources(mirrors, url)
        .into_iter()
        .map(|(_, url)| url)
        .collect()
}

/// 镜像地址是否就是 GitHub 直连本体（用户误把它当镜像填写）。
fn mirror_is_github_direct(mirror: &str) -> bool {
    let trimmed = mirror.trim().trim_end_matches('/');
    trimmed.eq_ignore_ascii_case("https://github.com")
        || trimmed.eq_ignore_ascii_case("http://github.com")
}

// ---------- 更新清单 ----------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformAsset {
    pub url: String,
    pub sha256: String,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateManifest {
    pub version: String,
    pub pub_date: Option<String>,
    pub notes: Option<String>,
    pub platforms: HashMap<String, PlatformAsset>,
}

impl UpdateManifest {
    /// 当前平台资产的便捷读取（缺失时 None）。
    fn platform_asset(&self) -> Option<&PlatformAsset> {
        self.platforms.get(&platform_key())
    }
}

/// 与 `scripts/make-release-manifest.mjs` 写入的 platforms 键一致
/// （tauri 的 platform-arch 命名，本应用只有 windows-x86_64）。
pub fn platform_key() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

/// 版本比较：容忍 `v` 前缀；两侧都无法按 semver 解析时退化为字符串不等。
fn is_newer_version(candidate: &str, current: &str) -> bool {
    let parse = |value: &str| semver::Version::parse(value.trim().trim_start_matches(['v', 'V']));
    match (parse(candidate), parse(current)) {
        (Ok(candidate), Ok(current)) => candidate > current,
        _ => candidate.trim() != current.trim(),
    }
}

#[derive(Debug, Clone, Serialize)]
// rename_all 只作用于 variant 名；variant 内部字段必须用 rename_all_fields
// （serde 1.0.186+），否则序列化成 snake_case、前端读 camelCase 全是 undefined
// （「发现新版本 vundefined」真机事故）。
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "status"
)]
pub enum UpdateCheckResult {
    UpToDate {
        current_version: String,
    },
    Available {
        current_version: String,
        latest_version: String,
        notes: Option<String>,
        pub_date: Option<String>,
        size: Option<u64>,
        download_url: String,
        /// 本次清单经哪个镜像拉取（`None` = 官方直连兜底）。
        checked_via: Option<String>,
    },
    NoRelease {
        current_version: String,
    },
    Error {
        message: String,
    },
}

/// 按当前平台挑选资产并比较版本，产出给前端的检查结果。
/// `checked_via`：本次清单经哪个镜像拉取（`None` = 官方直连兜底），前端拿它
/// 做默认下载源（「检查走哪个源成功，下载默认就选哪个」）。
fn evaluate_manifest(
    manifest: UpdateManifest,
    current_version: &str,
    checked_via: Option<String>,
) -> UpdateCheckResult {
    if !is_newer_version(&manifest.version, current_version) {
        return UpdateCheckResult::UpToDate {
            current_version: current_version.to_string(),
        };
    }
    // 先解构字段再挑平台资产，避免 asset 借用与字段 move 冲突。
    let UpdateManifest {
        version,
        pub_date,
        notes,
        platforms,
    } = manifest;
    let Some(asset) = platforms.get(&platform_key()) else {
        return UpdateCheckResult::Error {
            message: format!("更新清单缺少 {} 平台条目", platform_key()),
        };
    };
    UpdateCheckResult::Available {
        checked_via,
        current_version: current_version.to_string(),
        latest_version: version,
        notes,
        pub_date,
        size: asset.size,
        download_url: asset.url.clone(),
    }
}

// ---------- HTTP ----------

fn http_agent(read_timeout: Duration) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        .timeout_read(read_timeout)
        .build()
}

/// 依次尝试镜像与直连拉取 latest.json。404 表示仓库还没有发布版本。
/// 成功时同时返回命中的**来源镜像**（`None` = 官方直连兜底）。
fn fetch_manifest_via(mirrors: &[String]) -> Result<(UpdateManifest, Option<String>), String> {
    let agent = http_agent(READ_TIMEOUT);
    let mut last_error = "未配置任何更新源。".to_string();
    for (source, candidate) in candidate_sources(mirrors, &latest_manifest_url()) {
        match agent.get(&candidate).set("User-Agent", USER_AGENT).call() {
            Ok(response) => {
                let mut body = String::new();
                if let Err(error) = response
                    .into_reader()
                    .take(MANIFEST_MAX_BYTES)
                    .read_to_string(&mut body)
                {
                    last_error = format!("读取更新清单失败：{error}");
                    continue;
                }
                match serde_json::from_str::<UpdateManifest>(&body) {
                    Ok(manifest) => return Ok((manifest, source)),
                    Err(error) => last_error = format!("解析更新清单失败：{error}"),
                }
            }
            Err(ureq::Error::Status(404, _)) => return Err(NO_RELEASE_MESSAGE.to_string()),
            Err(ureq::Error::Status(code, _)) => last_error = format!("更新源返回 HTTP {code}"),
            Err(error) => last_error = format!("连接更新源失败：{error}"),
        }
    }
    Err(last_error)
}

/// 检查更新：拉取清单 → 平台资产 → 版本比较。
pub fn check_update(mirrors: &[String], current_version: &str) -> UpdateCheckResult {
    match fetch_manifest_via(mirrors) {
        Ok((manifest, checked_via)) => evaluate_manifest(manifest, current_version, checked_via),
        Err(message) => {
            if message == NO_RELEASE_MESSAGE {
                UpdateCheckResult::NoRelease {
                    current_version: current_version.to_string(),
                }
            } else {
                UpdateCheckResult::Error { message }
            }
        }
    }
}

// ---------- 下载与安装 ----------

/// 下载编排的共享状态：pending 保存已通过校验、等待安装的安装包路径；
/// cancel 供前端取消在途下载。仅内存，不持久化。Clone 共享同一份内部状态
/// （命令层把 State 里拷出、移进 spawn_blocking 用的就是这一语义）。
#[derive(Clone, Default)]
pub struct UpdateState {
    inner: Arc<UpdateStateInner>,
}

#[derive(Debug, Clone)]
pub struct PendingUpdate {
    pub version: String,
    pub path: PathBuf,
}

#[derive(Default)]
struct UpdateStateInner {
    pending: Mutex<Option<PendingUpdate>>,
    cancel: AtomicBool,
    download_in_flight: AtomicBool,
}

/// 下载单飞 guard：`try_begin_download` 成功时返回，Drop 清除在途标志——
/// 完成 / 取消 / 失败 / panic 任何返回路径都保证槽位被释放。
struct DownloadGuard<'a> {
    state: &'a UpdateState,
}

impl Drop for DownloadGuard<'_> {
    fn drop(&mut self) {
        self.state
            .inner
            .download_in_flight
            .store(false, Ordering::SeqCst);
    }
}

/// 尝试占用下载槽位（CAS false→true）；已有下载在途时返回 None。
fn try_begin_download(state: &UpdateState) -> Option<DownloadGuard<'_>> {
    state
        .inner
        .download_in_flight
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .ok()
        .map(|_| DownloadGuard { state })
}

impl UpdateState {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock_pending(&self) -> MutexGuard<'_, Option<PendingUpdate>> {
        self.inner
            .pending
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    pub fn set_pending(&self, pending: PendingUpdate) {
        *self.lock_pending() = Some(pending);
    }

    pub fn take_pending(&self) -> Option<PendingUpdate> {
        self.lock_pending().take()
    }

    pub fn request_cancel(&self) {
        self.inner.cancel.store(true, Ordering::SeqCst);
    }

    fn is_cancelled(&self) -> bool {
        self.inner.cancel.load(Ordering::SeqCst)
    }

    fn reset_cancel(&self) {
        self.inner.cancel.store(false, Ordering::SeqCst);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "status"
)]
pub enum UpdateDownloadResult {
    Completed { version: String, sha256: String },
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateDownloadProgress {
    received: u64,
    total: Option<u64>,
}

fn emit_progress(app: &AppHandle, received: u64, total: Option<u64>) {
    let payload = UpdateDownloadProgress { received, total };
    if let Err(error) = app.emit_to(
        crate::tray::MAIN_WINDOW_LABEL,
        DOWNLOAD_PROGRESS_EVENT,
        payload,
    ) {
        log::warn!("发送下载进度事件失败：{error}");
    }
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

enum DownloadError {
    Cancelled,
    Failure(String),
}

/// 把响应体流式写入临时文件，边下边算 SHA-256 并按字节量节流发进度事件；
/// 任何失败（含取消、校验不匹配）都清理临时文件。
fn stream_to_temp(
    app: &AppHandle,
    state: &UpdateState,
    response: ureq::Response,
    asset: &PlatformAsset,
    version: &str,
) -> Result<(PendingUpdate, String), DownloadError> {
    let temp_path = std::env::temp_dir().join(format!("emobox-update-{version}-setup.exe"));
    let mut file = match std::fs::File::create(&temp_path) {
        Ok(file) => file,
        Err(error) => {
            return Err(DownloadError::Failure(format!(
                "无法写入更新临时文件：{error}"
            )));
        }
    };

    let expected = asset.sha256.trim().to_ascii_lowercase();
    let total = response
        .header("Content-Length")
        .and_then(|value| value.parse::<u64>().ok())
        .or(asset.size);
    let mut reader = response.into_reader().take(MAX_DOWNLOAD_BYTES + 1);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut received: u64 = 0;
    let mut last_reported: u64 = 0;

    loop {
        if state.is_cancelled() {
            drop(file);
            let _ = std::fs::remove_file(&temp_path);
            return Err(DownloadError::Cancelled);
        }
        let read = match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => read,
            Err(error) => {
                drop(file);
                let _ = std::fs::remove_file(&temp_path);
                return Err(DownloadError::Failure(format!("下载中断：{error}")));
            }
        };
        received += read as u64;
        if received > MAX_DOWNLOAD_BYTES {
            drop(file);
            let _ = std::fs::remove_file(&temp_path);
            return Err(DownloadError::Failure(
                "更新包超过大小上限，已中止下载。".to_string(),
            ));
        }
        hasher.update(&buffer[..read]);
        if let Err(error) = std::io::Write::write_all(&mut file, &buffer[..read]) {
            drop(file);
            let _ = std::fs::remove_file(&temp_path);
            return Err(DownloadError::Failure(format!(
                "写入更新临时文件失败：{error}"
            )));
        }
        if received - last_reported >= PROGRESS_CHUNK_BYTES {
            last_reported = received;
            emit_progress(app, received, total);
        }
    }
    // 收尾补发一次，保证进度条终值准确。
    emit_progress(app, received, total);

    let actual = to_hex(&hasher.finalize());
    if actual != expected {
        let _ = std::fs::remove_file(&temp_path);
        return Err(DownloadError::Failure(format!(
            "安装包 SHA-256 校验失败（期望 {expected}，实际 {actual}），已删除下载文件。"
        )));
    }
    Ok((
        PendingUpdate {
            version: version.to_string(),
            path: temp_path,
        },
        actual,
    ))
}

/// 下载安装包到临时目录（重新拉取清单以获取最新资产），校验通过后存入
/// pending 供 `install_pending` 启动。镜像依次尝试、直连兜底。
pub fn download_and_stage(
    app: &AppHandle,
    mirrors: &[String],
    state: &UpdateState,
) -> Result<UpdateDownloadResult, String> {
    // 单飞：同时只允许一个下载在途（关闭弹窗重开、重复点击都可能并发触发，
    // 两个下载会互相覆盖临时文件与进度事件）。
    let Some(_guard) = try_begin_download(state) else {
        return Err("已有更新下载正在进行，请等待其完成或取消。".to_string());
    };
    let manifest = fetch_manifest_via(mirrors).map(|(manifest, _)| manifest)?;
    let asset = manifest
        .platform_asset()
        .ok_or_else(|| format!("更新清单缺少 {} 平台条目", platform_key()))?
        .clone();
    state.reset_cancel();

    let agent = http_agent(READ_TIMEOUT);
    let mut last_error = "未配置任何更新源。".to_string();
    for candidate in candidate_urls(mirrors, &asset.url) {
        if state.is_cancelled() {
            return Ok(UpdateDownloadResult::Cancelled);
        }
        match agent.get(&candidate).set("User-Agent", USER_AGENT).call() {
            Ok(response) => match stream_to_temp(app, state, response, &asset, &manifest.version) {
                Ok((pending, sha256)) => {
                    state.set_pending(pending);
                    return Ok(UpdateDownloadResult::Completed {
                        version: manifest.version,
                        sha256,
                    });
                }
                Err(DownloadError::Cancelled) => {
                    return Ok(UpdateDownloadResult::Cancelled);
                }
                Err(DownloadError::Failure(message)) => last_error = message,
            },
            Err(ureq::Error::Status(code, _)) => last_error = format!("下载源返回 HTTP {code}"),
            Err(error) => last_error = format!("连接下载源失败：{error}"),
        }
    }
    Err(last_error)
}

/// 启动已下载的 NSIS 安装器并退出应用（安装器完成后由用户重新启动 EmoBox）。
/// 启动失败时把 pending 放回，允许重试。
pub fn install_pending(app: &AppHandle, state: &UpdateState) -> Result<(), String> {
    let pending = state
        .take_pending()
        .ok_or_else(|| "还没有已下载的更新包，请先下载。".to_string())?;
    if !pending.path.exists() {
        return Err("更新包文件已丢失，请重新下载。".to_string());
    }
    if let Err(error) = std::process::Command::new(&pending.path).spawn() {
        state.set_pending(pending);
        return Err(format!("无法启动安装程序：{error}"));
    }
    log::info!("已启动 v{} 更新安装程序，应用退出", pending.version);
    app.exit(0);
    Ok(())
}

// ---------- 镜像测速 ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorSpeedResult {
    pub ok: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

/// 测速 = 经镜像完整拉取一份小文件（README.md，1MB 上限）的耗时。
/// 只读、不写任何数据；失败不致命，返回 ok=false 交由前端展示。
pub fn test_mirror(mirror: &str) -> MirrorSpeedResult {
    let Some(url) = join_mirror(mirror, &speed_test_url()) else {
        return MirrorSpeedResult {
            ok: false,
            latency_ms: None,
            error: Some("镜像地址无效，须以 http(s):// 开头。".to_string()),
        };
    };
    let agent = http_agent(SPEED_TEST_READ_TIMEOUT);
    let start = Instant::now();
    match agent.get(&url).set("User-Agent", USER_AGENT).call() {
        Ok(response) => {
            let mut reader = response.into_reader();
            let mut buffer = [0u8; 8 * 1024];
            let mut bytes: usize = 0;
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(read) => bytes += read,
                    Err(error) => {
                        return MirrorSpeedResult {
                            ok: false,
                            latency_ms: None,
                            error: Some(format!("读取测速目标失败：{error}")),
                        };
                    }
                }
                if bytes > 1024 * 1024 {
                    break;
                }
            }
            MirrorSpeedResult {
                ok: true,
                latency_ms: Some(start.elapsed().as_millis() as u64),
                error: None,
            }
        }
        Err(ureq::Error::Status(code, _)) => MirrorSpeedResult {
            ok: false,
            latency_ms: None,
            error: Some(format!("测速目标返回 HTTP {code}")),
        },
        Err(error) => MirrorSpeedResult {
            ok: false,
            latency_ms: None,
            error: Some(format!("连接失败：{error}")),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_mirror_trims_and_appends_single_slash() {
        assert_eq!(
            join_mirror("https://gh-proxy.com", "https://github.com/a/b"),
            Some("https://gh-proxy.com/https://github.com/a/b".to_string())
        );
        assert_eq!(
            join_mirror("  https://ghfast.top//  ", "https://github.com/a/b"),
            Some("https://ghfast.top/https://github.com/a/b".to_string())
        );
        assert_eq!(
            join_mirror("http://127.0.0.1:8181/", "https://github.com/a/b"),
            Some("http://127.0.0.1:8181/https://github.com/a/b".to_string())
        );
    }

    #[test]
    fn join_mirror_rejects_invalid_input() {
        assert_eq!(join_mirror("", "https://github.com/a"), None);
        assert_eq!(join_mirror("   ", "https://github.com/a"), None);
        assert_eq!(join_mirror("ftp://x/", "https://github.com/a"), None);
        // 没有 scheme 的裸域名不合法（无法前缀拼接）。
        assert_eq!(join_mirror("github.com", "https://github.com/a"), None);
        assert_eq!(join_mirror("https://gh-proxy.com/", ""), None);
    }

    #[test]
    fn candidate_urls_puts_direct_last_and_dedups() {
        let mirrors = vec![
            "https://gh-proxy.com".to_string(),
            "https://github.com/".to_string(),
        ];
        assert_eq!(
            candidate_urls(&mirrors, "https://github.com/x"),
            vec![
                "https://gh-proxy.com/https://github.com/x".to_string(),
                "https://github.com/x".to_string(),
            ]
        );
        // 非法镜像被过滤，直连仍然兜底。
        assert_eq!(
            candidate_urls(&["not-a-url".to_string()], "https://github.com/x"),
            vec!["https://github.com/x".to_string()]
        );
    }

    #[test]
    fn candidate_sources_tracks_mirror_origin() {
        let mirrors = vec![
            "https://gh-proxy.com".to_string(),
            "https://github.com/".to_string(),
        ];
        assert_eq!(
            candidate_sources(&mirrors, "https://github.com/x"),
            vec![
                (
                    Some("https://gh-proxy.com".to_string()),
                    "https://gh-proxy.com/https://github.com/x".to_string()
                ),
                (None, "https://github.com/x".to_string()),
            ]
        );
    }

    #[test]
    fn version_compare_accepts_v_prefix() {
        assert!(is_newer_version("v0.2.0", "0.1.0"));
        assert!(is_newer_version("0.10.0", "0.9.9"));
        assert!(!is_newer_version("0.1.0", "0.1.0"));
        assert!(!is_newer_version("v0.1.0", "0.1.0"));
        assert!(!is_newer_version("0.1.0", "0.2.0"));
    }

    #[test]
    fn download_single_flight_guard_blocks_concurrent_start() {
        let state = UpdateState::new();
        {
            let _guard = try_begin_download(&state);
            assert!(
                try_begin_download(&state).is_none(),
                "下载在途时第二次占用应被拒绝"
            );
        }
        // guard 离开作用域（Drop）后槽位释放，可再次开始。
        assert!(try_begin_download(&state).is_some());
    }

    #[test]
    fn manifest_parses_camel_case_json() {
        let json = r###"{
            "version": "0.2.0",
            "pubDate": "2026-09-02T00:00:00Z",
            "notes": "## 更新内容\n- 修复若干问题",
            "platforms": {
                "windows-x86_64": {
                    "url": "https://github.com/ldm0715/emobox/releases/download/v0.2.0/EmoBox_0.2.0_x64-setup.exe",
                    "sha256": "deadbeef",
                    "size": 12345678
                }
            }
        }"###;
        let manifest: UpdateManifest = serde_json::from_str(json).expect("清单应可解析");
        assert_eq!(manifest.version, "0.2.0");
        assert_eq!(
            manifest.platform_asset().expect("应有 windows 资产").sha256,
            "deadbeef"
        );
    }

    #[test]
    fn evaluate_manifest_picks_windows_asset_for_newer_version() {
        let mut platforms = HashMap::new();
        platforms.insert(
            "windows-x86_64".to_string(),
            PlatformAsset {
                url: "https://github.com/ldm0715/emobox/releases/download/v0.2.0/setup.exe"
                    .to_string(),
                sha256: "abc".to_string(),
                size: Some(123),
            },
        );
        platforms.insert(
            "linux-x86_64".to_string(),
            PlatformAsset {
                url: "https://example.com/linux".to_string(),
                sha256: "xyz".to_string(),
                size: None,
            },
        );
        let manifest = UpdateManifest {
            version: "0.2.0".to_string(),
            pub_date: Some("2026-09-02".to_string()),
            notes: Some("## 更新".to_string()),
            platforms,
        };
        match evaluate_manifest(manifest, "0.1.0", Some("https://gh-proxy.com/".to_string())) {
            UpdateCheckResult::Available {
                latest_version,
                size,
                download_url,
                checked_via,
                ..
            } => {
                assert_eq!(latest_version, "0.2.0");
                assert_eq!(size, Some(123));
                assert!(download_url.ends_with("setup.exe"));
                assert_eq!(checked_via.as_deref(), Some("https://gh-proxy.com/"));
            }
            other => panic!("应为 Available，实际：{other:?}"),
        }
    }

    #[test]
    fn evaluate_manifest_reports_up_to_date_for_same_or_older() {
        let manifest = |version: &str| UpdateManifest {
            version: version.to_string(),
            pub_date: None,
            notes: None,
            platforms: HashMap::new(),
        };
        match evaluate_manifest(manifest("0.1.0"), "0.1.0", None) {
            UpdateCheckResult::UpToDate { current_version } => {
                assert_eq!(current_version, "0.1.0");
            }
            other => panic!("应为 UpToDate，实际：{other:?}"),
        }
        assert!(matches!(
            evaluate_manifest(manifest("0.0.9"), "0.1.0", None),
            UpdateCheckResult::UpToDate { .. }
        ));
    }

    #[test]
    fn evaluate_manifest_errors_when_platform_missing() {
        let manifest = UpdateManifest {
            version: "0.2.0".to_string(),
            pub_date: None,
            notes: None,
            platforms: HashMap::new(),
        };
        assert!(matches!(
            evaluate_manifest(manifest, "0.1.0", None),
            UpdateCheckResult::Error { .. }
        ));
    }
}
