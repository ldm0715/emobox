//! 百度 AI Studio PaddleOCR 同步 API 客户端（Phase 32）。
//!
//! API 形态（AI Studio 帮助文档「PP-OCR 服务化部署调用示例及 API 介绍」）：
//! - endpoint：用户在 aistudio.baidu.com/paddleocr/task 创建的**个人 API_URL**。
//!   模型（PP-OCRv5 / PP-OCRv6 / PaddleOCR-VL 等）在创建该 URL 时选定，
//!   请求体没有 model 字段——URL 本身即绑定了模型。
//! - 鉴权：请求头 `Authorization: token <Access Token>`。
//! - 请求：POST JSON `{"file": "<base64 图片>", "fileType": 1}`（1 = 图片）。
//! - 响应：`{"logId":…, "errorCode":0, "errorMsg":"Success",
//!   "result":{"ocrResults":[{"prunedResult":{…,"rec_texts":["…"]},…}]}}`；
//!   失败时 errorCode 非 0（异步文档的错误码体系：12001 每日配额、12002 频率限制）。
//!
//! 不用异步 API（/api/v2/ocr/jobs 轮询）——那是为多页 PDF / 批量文档设计的，
//! 表情包单张场景单次同步 POST 延迟更低、实现更简单。

use std::io::Read;
use std::time::Duration;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// OCR 云端识别单张可能要数秒，读取超时放宽。
const READ_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_RESPONSE_BYTES: u64 = 16 * 1024 * 1024;
const USER_AGENT: &str = "Mozilla/5.0 (compatible; EmoBox/0.1)";

/// 对用户填写的 AI Studio 配置做基础校验，返回（API URL, Token）。
pub fn validate_config(api_url: &str, token: &str) -> Result<(String, String), String> {
    let api_url = api_url.trim();
    let token = token.trim();
    if api_url.is_empty() {
        return Err("未配置 AI Studio API URL".to_string());
    }
    if !(api_url.starts_with("https://") || api_url.starts_with("http://")) {
        return Err("AI Studio API URL 必须以 http(s):// 开头".to_string());
    }
    if token.is_empty() {
        return Err("未配置 AI Studio Access Token".to_string());
    }
    Ok((api_url.to_string(), token.to_string()))
}

/// 识别一张 PNG 图片，返回按行的识别文本。
pub fn recognize_lines(
    api_url: &str,
    token: &str,
    png_bytes: &[u8],
) -> Result<Vec<String>, String> {
    let (api_url, token) = validate_config(api_url, token)?;
    use base64::Engine as _;
    let file_base64 = base64::engine::general_purpose::STANDARD.encode(png_bytes);

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        .timeout_read(READ_TIMEOUT)
        .build();
    let response = agent
        .post(&api_url)
        .set("User-Agent", USER_AGENT)
        .set("Authorization", &format!("token {token}"))
        .set("Content-Type", "application/json")
        .send(
            serde_json::json!({ "file": file_base64, "fileType": 1 })
                .to_string()
                .as_bytes(),
        )
        .map_err(|error| match error {
            ureq::Error::Status(code, response) => {
                let detail = read_error_message(response);
                format!("AI Studio OCR 请求失败（HTTP {code}）：{detail}")
            }
            other => format!("连接 AI Studio OCR 失败：{other}"),
        })?;

    let mut body = String::new();
    response
        .into_reader()
        .take(MAX_RESPONSE_BYTES)
        .read_to_string(&mut body)
        .map_err(|error| format!("读取 AI Studio OCR 响应失败：{error}"))?;
    parse_ocr_response(&body)
}

/// 尽力从错误响应体里取出 errorMsg / errorMsg 字段，取不到退回原文截断。
fn read_error_message(response: ureq::Response) -> String {
    let mut body = String::new();
    let _ = response
        .into_reader()
        .take(MAX_RESPONSE_BYTES)
        .read_to_string(&mut body);
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&body) {
        for key in ["errorMsg", "error_msg", "message"] {
            if let Some(message) = value.get(key).and_then(|v| v.as_str()) {
                return message.to_string();
            }
        }
    }
    let truncated: String = body.chars().take(200).collect();
    if truncated.is_empty() {
        "无响应体".to_string()
    } else {
        truncated
    }
}

/// 解析 AI Studio OCR 响应体，返回识别文本行。独立成纯函数便于单测锁定契约。
pub fn parse_ocr_response(body: &str) -> Result<Vec<String>, String> {
    let value: serde_json::Value = serde_json::from_str(body)
        .map_err(|error| format!("AI Studio OCR 响应不是有效 JSON：{error}"))?;

    if let Some(code) = value.get("errorCode").and_then(|v| v.as_i64())
        && code != 0
    {
        let message = value
            .get("errorMsg")
            .and_then(|v| v.as_str())
            .unwrap_or("未知错误");
        return Err(friendly_error(code, message));
    }

    let results = value
        .pointer("/result/ocrResults")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "AI Studio OCR 响应缺少 result.ocrResults 字段".to_string())?;
    let first = results
        .first()
        .ok_or_else(|| "AI Studio OCR 响应的 ocrResults 为空".to_string())?;
    let lines = first
        .pointer("/prunedResult/rec_texts")
        .and_then(|v| v.as_array())
        .ok_or_else(|| {
            "AI Studio OCR 响应缺少 rec_texts 字段：该 API URL 对应的模型可能不是 PP-OCR 产线，\
             请在 AI Studio task 页面为 PP-OCRv5/v6 模型创建 API URL"
                .to_string()
        })?;
    Ok(lines
        .iter()
        .filter_map(|line| line.as_str().map(|s| s.to_string()))
        .collect())
}

fn friendly_error(code: i64, message: &str) -> String {
    match code {
        12001 => "AI Studio OCR 每日调用额度已用完".to_string(),
        12002 => "AI Studio OCR 请求过于频繁，请稍后再试".to_string(),
        _ => format!("AI Studio OCR 返回错误 {code}：{message}"),
    }
}

#[cfg(test)]
mod tests {
    use super::{friendly_error, parse_ocr_response, validate_config};

    #[test]
    fn parses_success_response_rec_texts() {
        let body = r#"{
            "logId": "abc-123",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "ocrResults": [
                    {
                        "prunedResult": {
                            "rec_texts": ["开心", "哈哈哈哈哈", "good morning"],
                            "rec_scores": [0.98, 0.91, 0.87]
                        },
                        "ocrImage": "base64jpeg"
                    }
                ],
                "dataInfo": {}
            }
        }"#;
        let lines = parse_ocr_response(body).expect("parse");
        assert_eq!(lines, vec!["开心", "哈哈哈哈哈", "good morning"]);
    }

    #[test]
    fn parses_error_code_as_friendly_error() {
        let body = r#"{"errorCode": 12001, "errorMsg": "daily quota exceeded"}"#;
        let error = parse_ocr_response(body).expect_err("quota error");
        assert!(error.contains("每日调用额度已用完"), "actual: {error}");
    }

    #[test]
    fn missing_rec_texts_names_the_field_and_model_hint() {
        let body = r##"{"errorCode": 0, "result": {"ocrResults": [{"prunedResult": {"markdown": "# x"}}]}}"##;
        let error = parse_ocr_response(body).expect_err("missing rec_texts");
        assert!(error.contains("rec_texts"), "actual: {error}");
        assert!(error.contains("PP-OCR"), "actual: {error}");
    }

    #[test]
    fn missing_ocr_results_is_an_error() {
        let body = r#"{"errorCode": 0, "result": {}}"#;
        let error = parse_ocr_response(body).expect_err("missing ocrResults");
        assert!(error.contains("ocrResults"), "actual: {error}");
    }

    #[test]
    fn invalid_json_is_an_error() {
        assert!(parse_ocr_response("not json").is_err());
    }

    #[test]
    fn non_string_lines_are_skipped() {
        let body = r#"{"errorCode": 0, "result": {"ocrResults": [{"prunedResult": {"rec_texts": ["ok", 3, null]}}]}}"#;
        assert_eq!(parse_ocr_response(body).expect("parse"), vec!["ok"]);
    }

    #[test]
    fn validates_config() {
        assert!(validate_config("", "tok").is_err());
        assert!(validate_config("ftp://x", "tok").is_err());
        assert!(validate_config("https://x", "  ").is_err());
        let (url, token) = validate_config("  https://api.example.com/ocr  ", " tok ").expect("ok");
        assert_eq!(url, "https://api.example.com/ocr");
        assert_eq!(token, "tok");
    }

    #[test]
    fn quota_and_rate_errors_are_translated() {
        assert!(friendly_error(12001, "x").contains("额度"));
        assert!(friendly_error(12002, "x").contains("频繁"));
        assert!(friendly_error(500, "boom").contains("500"));
    }
}
