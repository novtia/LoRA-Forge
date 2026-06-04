/**
 * @file llm/http.rs
 * @description 全局共享 HTTP 客户端（reqwest）、响应体调试打印、错误提取、caption 清洗、MIME 类型等 HTTP 层工具。
 */

use std::{path::Path, sync::OnceLock, time::Duration};

use reqwest::Client;
use serde_json::Value;

use crate::{
    error::{AppError, AppResult},
    models::EndpointKind,
};

pub(crate) const LOG_FIELD_TRUNCATE_CHARS: usize = 2000;

const HTTP_CONNECT_TIMEOUT_SECS: u64 = 15;
const HTTP_TOTAL_TIMEOUT_SECS: u64 = 180;
/// 带图 + tool calling 的 chat/completions 可能超过 180s，单独放宽总超时。
const HTTP_LLM_CHAT_TIMEOUT_SECS: u64 = 600;
const HTTP_POOL_IDLE_SECS: u64 = 90;
const USER_AGENT_VALUE: &str = concat!("lora-forge/", env!("CARGO_PKG_VERSION"));

fn build_shared_client(total_timeout_secs: u64) -> Client {
    Client::builder()
        .connect_timeout(Duration::from_secs(HTTP_CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(total_timeout_secs))
        .pool_idle_timeout(Duration::from_secs(HTTP_POOL_IDLE_SECS))
        .user_agent(USER_AGENT_VALUE)
        .build()
        .expect("failed to build shared reqwest client")
}

/// 全局共享的 HTTP 客户端，避免每个请求都重建 TLS / 连接池。
pub(crate) fn shared_http_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| build_shared_client(HTTP_TOTAL_TIMEOUT_SECS))
}

/// LLM chat/completions 专用客户端（更长总超时，避免慢模型 + 多轮 tool 被 180s 截断）。
pub(crate) fn shared_llm_chat_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| build_shared_client(HTTP_LLM_CHAT_TIMEOUT_SECS))
}

/// 将 reqwest 网络错误转为更易读的诊断文案（含超时提示）。
pub(crate) fn describe_network_error(raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("timed out") || lower.contains("timeout") {
        return format!(
            "{raw} (HTTP client total timeout is {}s for chat/completions)",
            HTTP_LLM_CHAT_TIMEOUT_SECS
        );
    }
    if lower.contains("decoding response body") {
        return format!(
            "{raw} (response body may be incomplete — often caused by timeout or connection drop during read; chat timeout is {}s)",
            HTTP_LLM_CHAT_TIMEOUT_SECS
        );
    }
    raw.to_string()
}

/// 网络层失败时写入 stderr（`tauri dev` 终端可见）。
pub(crate) fn print_llm_network_error_to_stderr(phase: &str, detail: &str) {
    eprintln!("[llm] network error during {phase}: {detail}");
}

pub(crate) fn openrouter_extra_headers(kind: EndpointKind) -> &'static [(&'static str, &'static str)] {
    match kind {
        EndpointKind::OpenRouter => &[
            ("HTTP-Referer", "https://lora-forge.local"),
            ("X-Title", "LoRA Forge"),
        ],
        _ => &[],
    }
}

pub(crate) fn normalize_chat_completions_url(endpoint_url: &str) -> AppResult<String> {
    let trimmed = endpoint_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(AppError::Validation("Endpoint URL is required".to_string()));
    }
    if trimmed.ends_with("/chat/completions") {
        Ok(trimmed.to_string())
    } else {
        Ok(format!("{trimmed}/chat/completions"))
    }
}

pub(crate) fn endpoint_kind_label(kind: EndpointKind) -> &'static str {
    match kind {
        EndpointKind::Auto => "auto",
        EndpointKind::OpenAi => "openai",
        EndpointKind::OpenRouter => "openrouter",
        EndpointKind::AnthropicCompat => "anthropic",
    }
}

pub(crate) fn mime_type_for_image(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|v| v.to_str())
        .map(|v| v.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        _ => "application/octet-stream",
    }
}

/// 将本次 chat/completions 的 HTTP 响应体打印到 stderr（开发机 `tauri dev` 终端可见）。
pub(crate) fn print_llm_http_response_body_to_stderr(http_status: u16, body: &str) {
    eprintln!("[llm] ========== HTTP {http_status} ==========");
    match serde_json::from_str::<Value>(body) {
        Ok(mut value) => {
            truncate_large_string_fields(&mut value, LOG_FIELD_TRUNCATE_CHARS);
            let text = serde_json::to_string_pretty(&value).unwrap_or_else(|_| body.to_string());
            eprintln!("{text}");
        }
        Err(_) => {
            let head: String = body.chars().take(LOG_FIELD_TRUNCATE_CHARS).collect();
            eprintln!("{head}");
            if body.chars().count() > LOG_FIELD_TRUNCATE_CHARS {
                eprintln!("…(truncated {} chars)", body.chars().count() - LOG_FIELD_TRUNCATE_CHARS);
            }
        }
    }
    eprintln!("[llm] ========== end ==========");
}

pub(crate) fn truncate_large_string_fields(value: &mut Value, max_chars: usize) {
    match value {
        Value::String(s) => {
            if let Some(rest) = s.strip_prefix("data:") {
                if let Some((mime, payload)) = rest.split_once(',') {
                    let bytes_hint = payload.len();
                    *s = format!("data:{mime},...(omitted {bytes_hint} chars)");
                    return;
                }
            }
            let char_count = s.chars().count();
            if char_count > max_chars {
                let truncated: String = s.chars().take(max_chars).collect();
                *s = format!("{truncated}…(truncated {} chars)", char_count - max_chars);
            }
        }
        Value::Array(arr) => {
            for v in arr.iter_mut() {
                truncate_large_string_fields(v, max_chars);
            }
        }
        Value::Object(map) => {
            for (_, v) in map.iter_mut() {
                truncate_large_string_fields(v, max_chars);
            }
        }
        _ => {}
    }
}

/// 解析错误消息：优先 `error.message`，否则截断 body 前 400 字符。
pub(crate) fn extract_error_message(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|payload| {
            payload
                .get("error")
                .filter(|v| !matches!(v, Value::Null))
                .and_then(|error| {
                    error
                        .get("message")
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                        .or_else(|| error.as_str().map(ToString::to_string))
                })
        })
        .unwrap_or_else(|| body.trim().chars().take(400).collect())
}

/// 严格白名单：只采纳 `choices[0].message.content` 是 string 或包含 `type="text"` 的分片。
pub(crate) fn extract_user_visible_caption(payload: &Value) -> Option<String> {
    let content = payload.pointer("/choices/0/message/content");
    if let Some(text) = extract_caption_from_message_content(content) {
        return Some(text);
    }
    payload
        .pointer("/choices/0/text")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn extract_caption_from_message_content(content: Option<&Value>) -> Option<String> {
    match content? {
        Value::Null => None,
        Value::String(s) => non_empty_text(s),
        Value::Array(parts) => {
            let mut chunks: Vec<String> = Vec::new();
            for part in parts {
                let Value::Object(map) = part else { continue };
                let typ_raw = map.get("type").and_then(Value::as_str);
                let typ = typ_raw.unwrap_or("text").trim().to_ascii_lowercase();
                if is_hidden_or_non_text_part(&typ) {
                    continue;
                }
                if typ_raw.is_some()
                    && !matches!(typ.as_str(), "text" | "output_text" | "input_text")
                {
                    continue;
                }
                if let Some(t) = map.get("text").and_then(Value::as_str) {
                    if let Some(trimmed) = non_empty_text(t) {
                        chunks.push(trimmed);
                    }
                } else if let Some(t) = map.get("content").and_then(Value::as_str) {
                    if let Some(trimmed) = non_empty_text(t) {
                        chunks.push(trimmed);
                    }
                }
            }
            non_empty_text(&chunks.join(" "))
        }
        Value::Object(map) => map
            .get("text")
            .and_then(Value::as_str)
            .and_then(non_empty_text)
            .or_else(|| {
                map.get("content")
                    .and_then(Value::as_str)
                    .and_then(non_empty_text)
            }),
        _ => None,
    }
}

fn is_hidden_or_non_text_part(typ: &str) -> bool {
    typ.contains("reasoning")
        || typ.contains("thinking")
        || typ.contains("thought")
        || typ == "image_url"
        || typ == "input_image"
        || typ == "refusal"
}

/// 命中以下任一 `finish_reason` / `native_finish_reason` 即视为内容审核阻断。
pub(crate) fn blocking_finish_reason(payload: &Value) -> Option<String> {
    const BLOCKED: &[&str] = &[
        "content_filter",
        "prohibited_content",
        "safety",
        "recitation",
        "blocklist",
        "blocked",
    ];
    let pick = |val: &Value| -> Option<String> {
        let s = val.as_str()?.trim();
        let lower = s.to_ascii_lowercase().replace('-', "_");
        if BLOCKED.iter().any(|b| lower.contains(b)) {
            Some(s.to_string())
        } else {
            None
        }
    };
    if let Some(s) = payload.pointer("/choices/0/finish_reason").and_then(pick) {
        return Some(s);
    }
    payload.pointer("/choices/0/native_finish_reason").and_then(pick)
}

pub(crate) fn non_empty_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
}

pub(crate) fn response_excerpt(body: &str) -> String {
    let excerpt = body.trim().chars().take(400).collect::<String>();
    if excerpt.is_empty() {
        "<empty response>".to_string()
    } else {
        excerpt
    }
}

/// 清洗 caption（剥离 fenced code block / 前缀 / 引号 / 空行）。
pub(crate) fn sanitize_caption(raw: &str) -> String {
    let mut text = strip_fenced_code_block(raw);
    text = strip_leading_preamble(&text);
    let collapsed: String = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    let mut cur = collapsed.trim().to_string();
    loop {
        let stripped = cur
            .trim()
            .trim_matches('`')
            .trim_matches('"')
            .trim_matches('\'')
            .trim_matches('\u{201C}')
            .trim_matches('\u{201D}')
            .trim_matches('\u{2018}')
            .trim_matches('\u{2019}')
            .to_string();
        if stripped == cur {
            break;
        }
        cur = stripped;
    }
    cur
}

fn strip_fenced_code_block(raw: &str) -> String {
    let trimmed = raw.trim();
    if !trimmed.starts_with("```") {
        return raw.to_string();
    }
    let after_open = match trimmed.find('\n') {
        Some(i) => &trimmed[i + 1..],
        None => return raw.to_string(),
    };
    if let Some(end) = after_open.rfind("```") {
        after_open[..end].to_string()
    } else {
        after_open.to_string()
    }
}

fn strip_leading_preamble(raw: &str) -> String {
    let trimmed = raw.trim_start();
    let lower = trimmed.to_ascii_lowercase();
    const PREFIXES: &[&str] = &[
        "here is a caption:",
        "here is the caption:",
        "here's a caption:",
        "here's the caption:",
        "caption:",
        "tags:",
        "output:",
        "result:",
    ];
    for prefix in PREFIXES {
        if lower.starts_with(prefix) {
            return trimmed[prefix.len()..].trim_start().to_string();
        }
    }
    raw.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extract_string_content() {
        let v = json!({"choices": [{"message": {"content": "  pretty image  "}}]});
        assert_eq!(extract_user_visible_caption(&v), Some("pretty image".to_string()));
    }

    #[test]
    fn ignore_reasoning_part_type() {
        let v = json!({
            "choices": [{"message": {"content": [{"type": "reasoning.text", "text": "let me think..."}]},
                "native_finish_reason": "PROHIBITED_CONTENT"}]
        });
        assert_eq!(extract_user_visible_caption(&v), None);
    }

    #[test]
    fn accept_text_part_only() {
        let v = json!({
            "choices": [{"message": {"content": [{"type": "reasoning", "text": "ignored"},{"type": "text", "text": "good caption"}]}}]
        });
        assert_eq!(extract_user_visible_caption(&v), Some("good caption".to_string()));
    }

    #[test]
    fn finish_reason_blocked() {
        let v = json!({"choices": [{"finish_reason": "content_filter", "message": {"content": "x"}}]});
        assert!(blocking_finish_reason(&v).is_some());
        let v2 = json!({"choices": [{"finish_reason": "stop", "native_finish_reason": "PROHIBITED_CONTENT"}]});
        assert!(blocking_finish_reason(&v2).is_some());
        let v3 = json!({"choices": [{"finish_reason": "stop"}]});
        assert!(blocking_finish_reason(&v3).is_none());
    }

    #[test]
    fn sanitize_preserves_newlines() {
        let raw = "1girl, solo\nCenter image: a girl standing.\nUpper image: a boy kneeling.";
        assert_eq!(sanitize_caption(raw), raw);
    }

    #[test]
    fn sanitize_strips_fenced_code() {
        assert_eq!(sanitize_caption("```\ngirl, smiling, outdoor\n```"), "girl, smiling, outdoor");
    }

    #[test]
    fn sanitize_strips_preamble() {
        assert_eq!(sanitize_caption("Caption: girl, smiling"), "girl, smiling");
    }

    #[test]
    fn truncate_data_url_in_log() {
        let mut v = json!({"image_url": {"url": "data:image/png;base64,AAAA1234567890"}});
        truncate_large_string_fields(&mut v, 4);
        assert_eq!(
            v["image_url"]["url"],
            Value::String("data:image/png;base64,...(omitted 14 chars)".to_string())
        );
    }

    #[test]
    fn error_passthrough_includes_payload_error() {
        let body = "{\"error\":{\"message\":\"bad key\"}}";
        assert_eq!(extract_error_message(body), "bad key");
    }
}
