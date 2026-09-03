//! 百度 AI Studio PaddleOCR 云端 OCR 客户端（Phase 32；2026-09 迁移到 v2 异步任务 API）。
//!
//! API 形态（AI Studio 帮助文档「异步 API 完整调用示例」）：
//! - 提交任务：`POST https://paddleocr.aistudio-app.com/api/v2/ocr/jobs`，
//!   multipart/form-data：`file`（图片字节）+ `model`（如 PP-OCRv6——模型从
//!   旧版的"URL 绑定"改成了必填请求参数）+ `optionalPayload`（JSON 字符串）；
//!   鉴权 `Authorization: Bearer <Access Token>`。
//!   响应信封 `{"traceId":…, "code":0, "msg":"…", "data":{"jobId":"…"}}`。
//! - 轮询：`GET …/api/v2/ocr/jobs/{jobId}`（同样带 Bearer），`data.state` ∈
//!   pending / running / done / failed；failed 时 `data.errorMsg` 给出原因；
//!   done 时 `data.resultUrl.jsonUrl` 指向结果文件（GET 它不需要鉴权）。
//! - 结果：JSONL，每行一页 `{"result":{"ocrResults":[{"prunedResult":
//!   {…,"rec_texts":["…"]}}]}}`，PP-OCR 系列产线的结构与旧同步 API 一致。
//! - 错误：信封 `code` 非 0（401 token 无效、10010 队列满、12001 每日页数
//!   上限、12002 频率限制、5xx 系统错误），HTTP 状态与 code 一一对应。
//!
//! 迁移原因：旧版同步 API（个人 API_URL + `{"file": base64}` JSON）2026-09
//! 起服务端已下线，继续请求只会得到 `{"code":500,"msg":"Internal Server Error"}`。

use std::io::Read;
use std::thread;
use std::time::Duration;
use std::time::Instant;

/// 官方异步 API 的任务提交端点；用户没填地址（或填的是已下线的旧版地址）时兜底。
const DEFAULT_JOB_URL: &str = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";
/// 默认识别模型（官方控制台示例当前值；设置里可切换）。
pub const DEFAULT_MODEL: &str = "PP-OCRv6";
/// PP-OCR 产线的可选参数（官方示例值）：跳过文档方向 / 矫正 / 文本行方向
/// 分类——表情包单张小图用不上这些文档级分析，跳过更快。
const OPTIONAL_PAYLOAD: &str =
    r#"{"useDocOrientationClassify":false,"useDocUnwarping":false,"useTextlineOrientation":false}"#;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// 单次 HTTP（提交 / 轮询 / 拉结果）的读取超时。
const READ_TIMEOUT: Duration = Duration::from_secs(30);
/// 轮询间隔与总预算：表情包是单张小图，正常几秒 done；服务端排队（pending）
/// 超过预算按云端错误处理、中止整批（剩余行保持 NULL 等回填）。
const POLL_INTERVAL: Duration = Duration::from_secs(2);
const POLL_DEADLINE: Duration = Duration::from_secs(120);
const MAX_RESPONSE_BYTES: u64 = 16 * 1024 * 1024;
const USER_AGENT: &str = "Mozilla/5.0 (compatible; EmoBox/0.1)";

/// 对用户填写的 AI Studio 配置做基础校验，返回（API URL, Token）。
/// API URL 允许留空（留空走 `resolve_job_url` 的官方默认端点），填了则必须是 http(s)。
pub fn validate_config(api_url: &str, token: &str) -> Result<(String, String), String> {
    let api_url = api_url.trim();
    let token = token.trim();
    if !api_url.is_empty() && !(api_url.starts_with("https://") || api_url.starts_with("http://")) {
        return Err("AI Studio API URL 必须以 http(s):// 开头".to_string());
    }
    if token.is_empty() {
        return Err("未配置 AI Studio Access Token".to_string());
    }
    Ok((api_url.to_string(), token.to_string()))
}

/// 把用户配置的 API 地址归一化为异步任务端点：
/// - 留空 → 官方默认端点；
/// - 已是 `…/api/v2/ocr/jobs` → 原样（去尾斜杠）；
/// - 官方域名但路径不对（只填了 base 或旧路径）→ 官方任务端点；
/// - 旧版同步 API 的 `aistudio.baidu.com` 个人地址（服务端已下线）→ 官方任务端点；
/// - 其余（自建网关）→ 原样，轮询端点在其后拼 `/{jobId}`。
fn resolve_job_url(api_url: &str) -> String {
    let trimmed = api_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return DEFAULT_JOB_URL.to_string();
    }
    if trimmed.ends_with("/api/v2/ocr/jobs") {
        return trimmed.to_string();
    }
    let Some(host) = trimmed.split("://").nth(1) else {
        return trimmed.to_string();
    };
    let host = host
        .split(['/', '?'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if host == "paddleocr.aistudio-app.com" || host == "aistudio.baidu.com" {
        return DEFAULT_JOB_URL.to_string();
    }
    trimmed.to_string()
}

/// 模型名归一化：留空回默认（存量用户还没推送过模型字段）。
fn normalize_model(model: &str) -> String {
    let trimmed = model.trim();
    if trimmed.is_empty() {
        DEFAULT_MODEL.to_string()
    } else {
        trimmed.to_string()
    }
}

/// 识别一张 PNG 图片，返回按行的识别文本。
/// 异步任务流：提交 → 轮询状态 → 拉结果 JSONL。
pub fn recognize_lines(
    api_url: &str,
    token: &str,
    model: &str,
    png_bytes: &[u8],
) -> Result<Vec<String>, String> {
    let (api_url, token) = validate_config(api_url, token)?;
    let model = normalize_model(model);
    let job_url = resolve_job_url(&api_url);
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        .timeout_read(READ_TIMEOUT)
        .build();

    let job_id = submit_job(&agent, &job_url, &token, &model, png_bytes)?;
    let started = Instant::now();
    loop {
        if started.elapsed() >= POLL_DEADLINE {
            return Err(format!(
                "AI Studio OCR 任务在 {}s 内未完成，已放弃（官方队列排队较久时请稍后回填重试）",
                POLL_DEADLINE.as_secs()
            ));
        }
        thread::sleep(POLL_INTERVAL);
        let body = poll_job(&agent, &job_url, &job_id, &token)?;
        match parse_job_state(&body)? {
            JobState::Done { json_url } => {
                let body = fetch_result_lines(&agent, &json_url)?;
                return parse_result_jsonl(&body);
            }
            JobState::Failed { message } => {
                return Err(format!("AI Studio OCR 任务失败：{message}"));
            }
            JobState::Pending => continue,
        }
    }
}

fn submit_job(
    agent: &ureq::Agent,
    job_url: &str,
    token: &str,
    model: &str,
    png_bytes: &[u8],
) -> Result<String, String> {
    let boundary = format!(
        "emobox-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let body = build_multipart_body(&boundary, model, png_bytes);
    let response = agent
        .post(job_url)
        .set("User-Agent", USER_AGENT)
        .set("Authorization", &format!("Bearer {token}"))
        .set(
            "Content-Type",
            &format!("multipart/form-data; boundary={boundary}"),
        )
        .send_bytes(&body)
        .map_err(|error| map_http_error(error, "提交任务"))?;
    let body = read_body(response, "读取 AI Studio OCR 提交响应失败")?;
    parse_job_id(&body)
}

fn poll_job(
    agent: &ureq::Agent,
    job_url: &str,
    job_id: &str,
    token: &str,
) -> Result<String, String> {
    let response = agent
        .get(&format!("{job_url}/{job_id}"))
        .set("User-Agent", USER_AGENT)
        .set("Authorization", &format!("Bearer {token}"))
        .call()
        .map_err(|error| map_http_error(error, "查询任务状态"))?;
    read_body(response, "读取 AI Studio OCR 状态响应失败")
}

fn fetch_result_lines(agent: &ureq::Agent, json_url: &str) -> Result<String, String> {
    let response = agent
        .get(json_url)
        .set("User-Agent", USER_AGENT)
        .call()
        .map_err(|error| map_http_error(error, "拉取识别结果"))?;
    read_body(response, "读取 AI Studio OCR 结果文件失败")
}

fn read_body(response: ureq::Response, read_error: &str) -> Result<String, String> {
    let mut body = String::new();
    response
        .into_reader()
        .take(MAX_RESPONSE_BYTES)
        .read_to_string(&mut body)
        .map_err(|error| format!("{read_error}：{error}"))?;
    Ok(body)
}

/// 构造任务提交的 multipart/form-data 请求体（字段与官方示例一致：
/// `model`、`optionalPayload` 为文本字段，`file` 为二进制图片）。
fn build_multipart_body(boundary: &str, model: &str, png_bytes: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(png_bytes.len() + 512);
    body.extend_from_slice(
        format!(
            "--{boundary}\r\n\
             Content-Disposition: form-data; name=\"model\"\r\n\r\n\
             {model}\r\n\
             --{boundary}\r\n\
             Content-Disposition: form-data; name=\"optionalPayload\"\r\n\r\n\
             {OPTIONAL_PAYLOAD}\r\n\
             --{boundary}\r\n\
             Content-Disposition: form-data; name=\"file\"; filename=\"image.png\"\r\n\
             Content-Type: image/png\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(png_bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

fn map_http_error(error: ureq::Error, action: &str) -> String {
    let ureq::Error::Status(code, response) = error else {
        return format!("连接 AI Studio OCR 失败（{action}）：{error}");
    };
    let mut body = String::new();
    let _ = response
        .into_reader()
        .take(MAX_RESPONSE_BYTES)
        .read_to_string(&mut body);
    format!(
        "AI Studio OCR {action}失败（HTTP {code}）：{}",
        error_detail(&body)
    )
}

/// 从错误响应体提取可读信息：JSON 信封按错误码翻译（401/12001/…），其次取
/// msg 类字段，最后退回原文截断。独立成纯函数便于单测锁定契约。
fn error_detail(body: &str) -> String {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(body) {
        let message = ["msg", "errorMsg", "error_msg", "message"]
            .iter()
            .find_map(|key| {
                value
                    .get(*key)
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
                    .filter(|s| !s.is_empty())
            });
        let code = value
            .get("code")
            .and_then(|v| v.as_i64())
            .filter(|code| *code != 0);
        if let Some(code) = code {
            return friendly_error(code, message.as_deref().unwrap_or("未知错误"));
        }
        if let Some(message) = message {
            return message;
        }
    }
    let truncated: String = body.chars().take(200).collect();
    if truncated.is_empty() {
        "无响应体".to_string()
    } else {
        truncated
    }
}

/// 新版 API 错误码 → 用户可读文案（帮助文档「错误码」节）。
fn friendly_error(code: i64, message: &str) -> String {
    match code {
        401 => "AI Studio Access Token 无效或已过期，请重新生成".to_string(),
        10010 => "AI Studio OCR 任务队列已满，请稍后再试".to_string(),
        12001 => "AI Studio OCR 已达每日调用页数上限（免费额度）".to_string(),
        12002 => "AI Studio OCR 请求过于频繁，请稍后再试".to_string(),
        10007 => {
            format!("AI Studio OCR 模型参数错误（{message}）：请在设置中改用 PP-OCRv6 / PP-OCRv5")
        }
        _ => format!("AI Studio OCR 返回错误 {code}：{message}"),
    }
}

/// 解析任务提交响应，返回 jobId。独立成纯函数便于单测锁定契约。
fn parse_job_id(body: &str) -> Result<String, String> {
    let value: serde_json::Value = serde_json::from_str(body)
        .map_err(|error| format!("AI Studio OCR 提交响应不是有效 JSON：{error}"))?;
    if let Some(code) = value.get("code").and_then(|v| v.as_i64())
        && code != 0
    {
        let message = value
            .get("msg")
            .and_then(|v| v.as_str())
            .unwrap_or("未知错误");
        return Err(friendly_error(code, message));
    }
    match value.pointer("/data/jobId") {
        Some(serde_json::Value::String(job_id)) => Ok(job_id.clone()),
        Some(serde_json::Value::Number(job_id)) => Ok(job_id.to_string()),
        _ => Err("AI Studio OCR 提交响应缺少 data.jobId 字段".to_string()),
    }
}

/// 轮询状态解析结果。
#[derive(Debug)]
enum JobState {
    Pending,
    Done { json_url: String },
    Failed { message: String },
}

/// 解析任务状态轮询响应。未知 state 一律按 pending 继续等（信封错误码
/// 优先拦截真实故障）。独立成纯函数便于单测锁定契约。
fn parse_job_state(body: &str) -> Result<JobState, String> {
    let value: serde_json::Value = serde_json::from_str(body)
        .map_err(|error| format!("AI Studio OCR 状态响应不是有效 JSON：{error}"))?;
    if let Some(code) = value.get("code").and_then(|v| v.as_i64())
        && code != 0
    {
        let message = value
            .get("msg")
            .and_then(|v| v.as_str())
            .unwrap_or("未知错误");
        return Err(friendly_error(code, message));
    }
    let data = value
        .get("data")
        .ok_or_else(|| "AI Studio OCR 状态响应缺少 data 字段".to_string())?;
    match data.get("state").and_then(|v| v.as_str()) {
        Some("done") => {
            let json_url = data
                .pointer("/resultUrl/jsonUrl")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "AI Studio OCR 任务完成但缺少 resultUrl.jsonUrl".to_string())?
                .to_string();
            Ok(JobState::Done { json_url })
        }
        Some("failed") => {
            let message = data
                .get("errorMsg")
                .and_then(|v| v.as_str())
                .unwrap_or("未知原因");
            Ok(JobState::Failed {
                message: message.to_string(),
            })
        }
        _ => Ok(JobState::Pending),
    }
}

/// 解析结果 JSONL：每行一页的 `{"result":{"ocrResults":[…]}}`，收集所有
/// `prunedResult.rec_texts`。独立成纯函数便于单测锁定契约。
fn parse_result_jsonl(body: &str) -> Result<Vec<String>, String> {
    let mut lines = Vec::new();
    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let value: serde_json::Value = serde_json::from_str(line)
            .map_err(|error| format!("AI Studio OCR 结果行不是有效 JSON：{error}"))?;
        let results = value
            .pointer("/result/ocrResults")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                "AI Studio OCR 结果缺少 result.ocrResults 字段：请把设置中的识别模型\
                 换成 PP-OCRv6 / PP-OCRv5（文档解析类模型不返回 OCR 文本）"
                    .to_string()
            })?;
        for result in results {
            if let Some(texts) = result
                .pointer("/prunedResult/rec_texts")
                .and_then(|v| v.as_array())
            {
                lines.extend(texts.iter().filter_map(|t| t.as_str().map(str::to_string)));
            }
        }
    }
    Ok(lines)
}

#[cfg(test)]
mod tests {
    use super::DEFAULT_JOB_URL;
    use super::DEFAULT_MODEL;
    use super::JobState;
    use super::build_multipart_body;
    use super::error_detail;
    use super::friendly_error;
    use super::normalize_model;
    use super::parse_job_id;
    use super::parse_job_state;
    use super::parse_result_jsonl;
    use super::resolve_job_url;
    use super::validate_config;

    #[test]
    fn resolves_job_url_from_user_config() {
        assert_eq!(resolve_job_url(""), DEFAULT_JOB_URL);
        assert_eq!(resolve_job_url("  "), DEFAULT_JOB_URL);
        assert_eq!(
            resolve_job_url("https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"),
            DEFAULT_JOB_URL
        );
        assert_eq!(
            resolve_job_url("https://paddleocr.aistudio-app.com/api/v2/ocr/jobs/"),
            DEFAULT_JOB_URL
        );
        assert_eq!(
            resolve_job_url("https://paddleocr.aistudio-app.com"),
            DEFAULT_JOB_URL
        );
        assert_eq!(
            resolve_job_url("https://paddleocr.aistudio-app.com/some/thing"),
            DEFAULT_JOB_URL
        );
        // 旧版同步 API 的个人地址已下线，统一映射到官方默认端点。
        assert_eq!(
            resolve_job_url("https://aistudio.baidu.com/llm/lmapi/v3/abc"),
            DEFAULT_JOB_URL
        );
        // 自建网关：原样使用（轮询端点在其后拼 /{jobId}）。
        assert_eq!(
            resolve_job_url("https://gw.example.com/api/v2/ocr/jobs"),
            "https://gw.example.com/api/v2/ocr/jobs"
        );
        assert_eq!(
            resolve_job_url("https://gw.example.com/foo"),
            "https://gw.example.com/foo"
        );
    }

    #[test]
    fn multipart_body_carries_model_payload_and_file() {
        let png = vec![0x89u8, b'P', b'N', b'G', 0x01, 0x02];
        let body = build_multipart_body("bnd", "PP-OCRv6", &png);
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("--bnd\r\n"), "actual: {text}");
        assert!(
            text.contains("Content-Disposition: form-data; name=\"model\"\r\n\r\nPP-OCRv6\r\n"),
            "actual: {text}"
        );
        assert!(
            text.contains(
                "Content-Disposition: form-data; name=\"optionalPayload\"\r\n\r\n\
                 {\"useDocOrientationClassify\":false"
            ),
            "actual: {text}"
        );
        assert!(
            text.contains(
                "Content-Disposition: form-data; name=\"file\"; filename=\"image.png\"\r\n\
                 Content-Type: image/png\r\n\r\n"
            ),
            "actual: {text}"
        );
        assert!(text.ends_with("\r\n--bnd--\r\n"), "actual: {text}");
        // 图片字节原样保留在文件字段头部之后。
        let payload_start = body
            .windows(png.len())
            .position(|window| window == png.as_slice())
            .expect("file bytes present");
        assert!(payload_start > 100);
    }

    #[test]
    fn parses_job_id_from_submit_response() {
        let body = r#"{"traceId":"t","code":0,"msg":"Success","data":{"jobId":"job-1"}}"#;
        assert_eq!(parse_job_id(body).expect("parse"), "job-1");
        let numeric = r#"{"code":0,"data":{"jobId":42}}"#;
        assert_eq!(parse_job_id(numeric).expect("parse"), "42");
    }

    #[test]
    fn job_id_error_envelope_is_translated() {
        let error = parse_job_id(r#"{"traceId":"t","code":12001,"msg":"page limit exceeded"}"#)
            .expect_err("quota error");
        assert!(error.contains("每日"), "actual: {error}");
    }

    #[test]
    fn job_id_missing_is_an_error() {
        assert!(parse_job_id(r#"{"code":0,"data":{}}"#).is_err());
        assert!(parse_job_id("not json").is_err());
    }

    #[test]
    fn job_state_parses_done_pending_and_failed() {
        let done = parse_job_state(
            r#"{"code":0,"data":{"state":"done","resultUrl":{"jsonUrl":"https://x/y.jsonl"}}}"#,
        )
        .expect("done");
        assert!(
            matches!(done, JobState::Done { ref json_url } if json_url == "https://x/y.jsonl"),
            "actual: {done:?}"
        );
        assert!(matches!(
            parse_job_state(r#"{"code":0,"data":{"state":"running"}}"#).expect("running"),
            JobState::Pending
        ));
        assert!(matches!(
            parse_job_state(r#"{"code":0,"data":{"state":"pending"}}"#).expect("pending"),
            JobState::Pending
        ));
        let failed = parse_job_state(
            r#"{"code":0,"data":{"state":"failed","errorMsg":"file can not parse"}}"#,
        )
        .expect("failed");
        assert!(
            matches!(failed, JobState::Failed { ref message } if message == "file can not parse"),
            "actual: {failed:?}"
        );
    }

    #[test]
    fn job_state_error_envelope_is_translated() {
        let error = parse_job_state(r#"{"traceId":"t","code":12002,"msg":"too many requests"}"#)
            .expect_err("rate error");
        assert!(error.contains("频繁"), "actual: {error}");
    }

    #[test]
    fn done_state_without_json_url_is_an_error() {
        let error =
            parse_job_state(r#"{"code":0,"data":{"state":"done"}}"#).expect_err("missing jsonUrl");
        assert!(error.contains("jsonUrl"), "actual: {error}");
    }

    #[test]
    fn parses_jsonl_lines_collecting_all_rec_texts() {
        let body = concat!(
            r#"{"logId":"1","result":{"ocrResults":[{"prunedResult":{"rec_texts":["开心","哈哈"]}}]}}"#,
            "\n",
            r#"{"logId":"2","result":{"ocrResults":[{"prunedResult":{"rec_texts":["good morning",3]}}]}}"#,
            "\n\n",
        );
        assert_eq!(
            parse_result_jsonl(body).expect("parse"),
            vec!["开心", "哈哈", "good morning"]
        );
    }

    #[test]
    fn jsonl_without_ocr_results_names_the_model_hint() {
        let body =
            r##"{"logId":"1","result":{"layoutParsingResults":[{"markdown":{"text":"# x"}}]}}"##;
        let error = parse_result_jsonl(body).expect_err("markdown model");
        assert!(error.contains("ocrResults"), "actual: {error}");
        assert!(error.contains("PP-OCRv6"), "actual: {error}");
    }

    #[test]
    fn jsonl_without_any_text_is_empty_success() {
        let body = r#"{"logId":"1","result":{"ocrResults":[{"prunedResult":{"rec_texts":[]}}]}}"#;
        assert_eq!(
            parse_result_jsonl(body).expect("parse"),
            Vec::<String>::new()
        );
        assert_eq!(
            parse_result_jsonl("  \n ").expect("parse"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn error_detail_translates_envelope_codes() {
        assert!(
            error_detail(r#"{"traceId":"t","code":12001,"msg":"page limit exceeded"}"#)
                .contains("每日"),
            "quota error"
        );
        assert_eq!(error_detail(r#"{"msg":"boom"}"#), "boom");
        assert_eq!(
            error_detail("plain Gateway timeout"),
            "plain Gateway timeout"
        );
        assert_eq!(error_detail(""), "无响应体");
    }

    #[test]
    fn known_error_codes_are_translated() {
        assert!(friendly_error(401, "x").contains("Token"), "unauthorized");
        assert!(friendly_error(12001, "x").contains("每日"), "quota");
        assert!(friendly_error(12002, "x").contains("频繁"), "rate");
        assert!(
            friendly_error(10007, "bad model").contains("PP-OCRv6"),
            "model"
        );
        assert!(friendly_error(10010, "x").contains("队列"), "queue");
        assert!(friendly_error(599, "boom").contains("599"), "generic");
    }

    #[test]
    fn model_defaults_when_blank() {
        assert_eq!(normalize_model(""), DEFAULT_MODEL);
        assert_eq!(normalize_model("  PP-OCRv5  "), "PP-OCRv5");
    }

    #[test]
    fn validates_config() {
        // API URL 允许留空（留空走官方默认端点）。
        let (url, token) = validate_config("", "tok").expect("ok");
        assert_eq!(url, "");
        assert_eq!(token, "tok");
        assert!(validate_config("ftp://x", "tok").is_err());
        assert!(validate_config("https://x", "  ").is_err());
        let (url, token) = validate_config("  https://api.example.com/ocr  ", " tok ").expect("ok");
        assert_eq!(url, "https://api.example.com/ocr");
        assert_eq!(token, "tok");
    }
}
