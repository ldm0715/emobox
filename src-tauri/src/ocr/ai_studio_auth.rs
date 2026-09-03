//! AI Studio 网页登录窗口（内嵌 WebView）与登录态读取。
//!
//! 背景：AI Studio 的额度 / Token 查询接口（`aistudio.baidu.com`）不接受
//! `Authorization: Bearer`（实测返回 `{"errorCode":500,"errorMsg":"未登录"}`），
//! 只认网页登录 Cookie；而用户默认浏览器（Chrome/Edge）的 Cookie 受沙箱
//! 隔离、任何外部应用都拿不到。方案是开一个**内嵌 WebView 窗口**让用户在
//! 应用内登录：登录态落在应用自己的 WebView2 profile（跨重启持久），
//! Rust 经 Tauri 的 `cookies_for_url` 读取（Cookie 存储为全应用共享的
//! WebView2 profile，任意 webview 的 CookieJar 读到同一份）。
//!
//! Cookie 绝不落 localStorage / SQLite：BDUSS 等是全账号凭据，只留在
//! WebView2 的浏览器级磁盘存储里；过期时额度查询报「未登录」，前端引导
//! 重新打开登录窗口。Access Token 则在登录成功后自动抓取并推给前端，
//! 按既有惯例存 `localStorage: emobox.settings`。
//!
//! ⚠️ Windows 上 `cookies_for_url` 在**同步命令或事件处理器**里调用会死锁
//! （wry#583），本模块只在独立线程（登录轮询）与 `spawn_blocking`
//! （额度查询命令）里调用。

use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;
use std::time::Instant;

use serde::Serialize;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;

use crate::ocr::ai_studio_ocr;
use crate::tray::MAIN_WINDOW_LABEL;

/// 登录窗口 label（运行时经 `WebviewWindowBuilder` 创建，不在
/// tauri.conf.json 的静态窗口表里；远程页面不使用任何 Tauri IPC）。
pub const WINDOW_LABEL: &str = "aistudio-login";
/// 登录成功后发给主窗口的事件；payload 携带抓取到的 Access Token。
pub const AISTUDIO_LOGIN_COMPLETE_EVENT: &str = "aistudio-login-complete";
const LOGIN_URL: &str = "https://aistudio.baidu.com/";
/// 登录用户的 Access Token 查询端点（同样走网页登录 Cookie）。
const TOKEN_URL: &str = "https://aistudio.baidu.com/studio/user/token";
/// Cookie 归属域（读取 CookieJar 的键）。
const COOKIE_ORIGIN: &str = "https://aistudio.baidu.com";
/// 登录轮询间隔：登录提交后 Cookie 需要一点时间落盘。
const LOGIN_POLL_INTERVAL: Duration = Duration::from_millis(1500);
/// 轮询总预算：超时停止轮询（窗口保留，用户可再点「登录」重启流程）。
const LOGIN_POLL_DEADLINE: Duration = Duration::from_secs(600);
/// 单飞守卫：同时只有一条登录轮询线程（重复点「登录」只把窗口拉回前台）。
static LOGIN_POLLING: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStudioLoginCompletePayload {
    pub token: String,
}

/// 打开登录窗口并启动登录轮询。fire-and-forget：登录结果经
/// `aistudio-login-complete` 事件回主窗口，命令本身立即返回。
/// 若 WebView2 profile 里已有有效登录态（上次登录的 Cookie 仍在），
/// 首轮轮询即可拿到 Token，窗口短暂一闪即隐藏。
pub fn start_login_flow(app: AppHandle) -> Result<(), String> {
    if LOGIN_POLLING.swap(true, Ordering::SeqCst) {
        return show_login_window(&app);
    }
    if let Err(error) = show_login_window(&app) {
        LOGIN_POLLING.store(false, Ordering::SeqCst);
        return Err(error);
    }
    std::thread::spawn(move || login_poll(app));
    Ok(())
}

/// 创建（首次）或复用登录窗口并显示。窗口常驻隐藏不销毁（同
/// quick-search / tray-menu 模式；CloseRequested 被 lib.rs 拦截为 hide）。
fn show_login_window(app: &AppHandle) -> Result<(), String> {
    let window = match app.get_webview_window(WINDOW_LABEL) {
        Some(window) => window,
        None => create_login_window(app)?,
    };
    window
        .show()
        .map_err(|error| format!("显示 AI Studio 登录窗口失败：{error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("聚焦 AI Studio 登录窗口失败：{error}"))?;
    Ok(())
}

fn create_login_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    let url = tauri::Url::parse(LOGIN_URL).map_err(|error| format!("登录地址无效：{error}"))?;
    tauri::WebviewWindowBuilder::new(app, WINDOW_LABEL, tauri::WebviewUrl::External(url))
        .title("登录 AI Studio")
        .inner_size(1100.0, 800.0)
        .center()
        .build()
        .map_err(|error| format!("创建 AI Studio 登录窗口失败：{error}"))
}

/// 轮询登录态：每 1.5s 读一次 Cookie 并试取 Token，成功即隐藏窗口、
/// 发事件。窗口被关（拦截为 hide）/ 轮询超时都视为放弃，线程退出
/// （登录窗口本身保留，下次点「登录」直接 show）。
fn login_poll(app: AppHandle) {
    let started = Instant::now();
    loop {
        thread::sleep(LOGIN_POLL_INTERVAL);
        let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
            break;
        };
        if !window.is_visible().unwrap_or(false) {
            break;
        }
        if started.elapsed() >= LOGIN_POLL_DEADLINE {
            log::info!("AI Studio 登录轮询超时，已停止（窗口保留，可重新发起）");
            break;
        }
        let Ok(cookie_header) = read_cookie_header(&app) else {
            continue;
        };
        match fetch_token(&cookie_header) {
            Ok(token) => {
                if let Err(error) = window.hide() {
                    log::warn!("隐藏 AI Studio 登录窗口失败：{error}");
                }
                if let Err(error) = app.emit_to(
                    MAIN_WINDOW_LABEL,
                    AISTUDIO_LOGIN_COMPLETE_EVENT,
                    AiStudioLoginCompletePayload { token },
                ) {
                    log::warn!("发送 {AISTUDIO_LOGIN_COMPLETE_EVENT} 失败：{error}");
                }
                break;
            }
            // 未登录 / 网络抖动：继续等用户完成登录。
            Err(_) => continue,
        }
    }
    LOGIN_POLLING.store(false, Ordering::SeqCst);
}

/// 读取 `aistudio.baidu.com` 的登录 Cookie，拼成 `name=value; …` 请求头。
/// Cookie 存储是全应用共享的 WebView2 profile：优先用登录窗口的
/// CookieJar（登录页写入方），窗口不存在时用主窗口的（读到同一份）。
/// 只可在独立线程 / `spawn_blocking` 里调用（wry#583 死锁警告）。
pub fn read_cookie_header(app: &AppHandle) -> Result<String, String> {
    let url =
        tauri::Url::parse(COOKIE_ORIGIN).map_err(|error| format!("Cookie 域无效：{error}"))?;
    let webview = app
        .get_webview_window(WINDOW_LABEL)
        .or_else(|| app.get_webview_window(MAIN_WINDOW_LABEL))
        .ok_or_else(|| "找不到可读取 Cookie 的窗口".to_string())?;
    let cookies = webview
        .cookies_for_url(url)
        .map_err(|error| format!("读取 AI Studio 登录 Cookie 失败：{error}"))?;
    Ok(cookies
        .iter()
        .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
        .collect::<Vec<_>>()
        .join("; "))
}

/// 带登录 Cookie 抓取当前用户的 Access Token（`/studio/user/token`）。
/// 未登录（Cookie 缺失或无效）返回 `NOT_LOGGED_IN` 哨兵。
pub fn fetch_token(cookie_header: &str) -> Result<String, String> {
    let cookie_header = cookie_header.trim();
    if cookie_header.is_empty() {
        return Err(ai_studio_ocr::NOT_LOGGED_IN.to_string());
    }
    let body = ai_studio_ocr::get_with_cookie(TOKEN_URL, cookie_header, "Token 查询")?;
    parse_token_body(&body)
}

/// 解析 Token 响应：`{"errorCode":0,"result":{"token":"…"}}`。信封键是
/// `errorCode`/`errorMsg`（网页控制台 API），经 `envelope_error` 统一翻译。
/// 独立成纯函数便于单测锁定契约。
pub fn parse_token_body(body: &str) -> Result<String, String> {
    let value: serde_json::Value = serde_json::from_str(body)
        .map_err(|error| format!("AI Studio Token 响应不是有效 JSON：{error}"))?;
    if let Some(code) = value.get("errorCode").and_then(|v| v.as_i64())
        && code != 0
    {
        let message = value
            .get("errorMsg")
            .and_then(|v| v.as_str())
            .unwrap_or("未知错误");
        return Err(ai_studio_ocr::envelope_error(code, message));
    }
    value
        .pointer("/result/token")
        .and_then(|v| v.as_str())
        .filter(|token| !token.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "AI Studio Token 响应缺少 result.token 字段".to_string())
}

#[cfg(test)]
mod tests {
    use super::fetch_token;
    use super::parse_token_body;
    use crate::ocr::ai_studio_ocr::NOT_LOGGED_IN;

    #[test]
    fn token_body_parses_result_token() {
        let body =
            r#"{"logId":"l","errorCode":0,"errorMsg":"Success","result":{"token":"abc123"}}"#;
        assert_eq!(parse_token_body(body).expect("parse"), "abc123");
    }

    #[test]
    fn token_body_maps_not_logged_in_to_sentinel() {
        let error = parse_token_body(r#"{"errorCode":500,"errorMsg":"未登录","result":null}"#)
            .expect_err("not logged in");
        assert_eq!(error, NOT_LOGGED_IN);
    }

    #[test]
    fn token_body_translates_envelope_error_codes() {
        let error = parse_token_body(r#"{"errorCode":401,"errorMsg":"invalid token"}"#)
            .expect_err("auth error");
        assert!(error.contains("Token"), "actual: {error}");
    }

    #[test]
    fn token_body_rejects_malformed_payloads() {
        assert!(parse_token_body("not json").is_err());
        assert!(parse_token_body(r#"{"errorCode":0}"#).is_err());
        // 空字符串 Token 视为缺失。
        assert!(parse_token_body(r#"{"errorCode":0,"result":{"token":""}}"#).is_err());
    }

    #[test]
    fn token_requires_cookie() {
        assert_eq!(fetch_token("").expect_err("no cookie"), NOT_LOGGED_IN);
    }
}
