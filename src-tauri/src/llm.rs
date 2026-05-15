use std::{
    fs,
    future::Future,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::Client;
use serde_json::{json, Value};
use tokio::time::sleep;

use crate::{
    error::{AppError, AppResult},
    models::LlmSettings,
    state::AppState,
};

const DEFAULT_SYSTEM_PROMPT: &str = include_str!("../../prompts/system-prompt.en.md");
const AUTO_TAG_PROMPT: &str = "Generate a concise, training-ready caption for this image for a Stable Diffusion or LoRA dataset. Return only a comma-separated caption with no preamble. Include subject, appearance, clothing, pose, framing, environment, lighting, and style cues when visible. Keep it factual and useful for image training.";

fn compose_auto_tag_user_prompt(user_message: Option<&str>) -> String {
    match user_message.map(str::trim).filter(|s| !s.is_empty()) {
        None => AUTO_TAG_PROMPT.to_string(),
        Some(extra) => format!(
            "{}\n\nAdditional notes from the user (treat as authoritative if they correct a misread of the image):\n{}",
            AUTO_TAG_PROMPT, extra
        ),
    }
}

pub async fn generate_dataset_caption(
    settings: &LlmSettings,
    image_path: &Path,
    user_message: Option<&str>,
    cancel: &Arc<AtomicBool>,
    log_sink: Option<AppState>,
) -> AppResult<String> {
    settings.validate().map_err(AppError::Validation)?;

    let display_image = image_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("image")
        .to_string();

    let image_bytes = fs::read(image_path)?;
    let image_data_url = format!(
        "data:{};base64,{}",
        mime_type_for_image(image_path),
        STANDARD.encode(image_bytes)
    );

    let max_extra_attempts = settings.caption_retry_max;
    let mut last_err_msg = String::new();

    for attempt in 0..=max_extra_attempts {
        if cancel.load(Ordering::SeqCst) {
            return Err(AppError::Cancelled);
        }
        if attempt > 0 {
            sleep(Duration::from_millis(400 + 350 * (attempt - 1) as u64)).await;
        }
        if cancel.load(Ordering::SeqCst) {
            return Err(AppError::Cancelled);
        }
        match generate_dataset_caption_once(
            settings,
            &image_data_url,
            user_message,
            cancel,
            display_image.clone(),
            log_sink.clone(),
        )
        .await {
            Ok(caption) => return Ok(caption),
            Err(AppError::Cancelled) => return Err(AppError::Cancelled),
            Err(e) => last_err_msg = e.to_string(),
        }
    }

    Err(AppError::Process(format!(
        "LLM caption failed after {} attempt(s): {}",
        max_extra_attempts.saturating_add(1),
        last_err_msg
    )))
}

async fn run_with_cancel<T, F>(future: F, cancel: &Arc<AtomicBool>) -> AppResult<T>
where
    F: Future<Output = AppResult<T>>,
{
    tokio::pin!(future);
    loop {
        tokio::select! {
            result = &mut future => return result,
            _ = tokio::time::sleep(Duration::from_millis(100)) => {
                if cancel.load(Ordering::SeqCst) {
                    return Err(AppError::Cancelled);
                }
            }
        }
    }
}

async fn generate_dataset_caption_once(
    settings: &LlmSettings,
    image_data_url: &str,
    user_message: Option<&str>,
    cancel: &Arc<AtomicBool>,
    display_image: String,
    log_sink: Option<AppState>,
) -> AppResult<String> {
    if cancel.load(Ordering::SeqCst) {
        return Err(AppError::Cancelled);
    }

    let endpoint = normalize_chat_completions_url(&settings.endpoint_url)?;
    let endpoint_log = endpoint.clone();
    let display_log = display_image.clone();

    let system_prompt = effective_system_prompt(settings).to_string();
    let user_prompt = compose_auto_tag_user_prompt(user_message);
    let image_data_url = image_data_url.to_string();
    let model_id = settings.model_id.clone();
    let model_log = model_id.clone();
    let temperature = settings.temperature;
    let max_tokens = settings.max_tokens;
    let thinking_type = if settings.thinking_enabled {
        "enabled"
    } else {
        "disabled"
    };
    let api_key = settings.api_key.trim().to_string();
    let log = log_sink;

    let request_body = json!({
        "model": model_id,
        "messages": [
            {
                "role": "system",
                "content": system_prompt,
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": user_prompt,
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": image_data_url,
                        },
                    }
                ]
            }
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "thinking": {
            "type": thinking_type,
        },
    });

    let llm_request_log_preview =
        format_llm_request_for_api_log(&request_body, !api_key.is_empty());

    let work = async move {
        if let Some(ref st) = log {
            st.push_api_log(
                "llm",
                "info",
                format!(
                    "请求 caption · {} · model={} · {}",
                    display_log,
                    model_log,
                    endpoint_log.trim()
                ),
            );
            st.push_api_log("llm", "info", llm_request_log_preview);
        }

        let client = Client::new();
        let mut request = client.post(endpoint).json(&request_body);
        if !api_key.is_empty() {
            request = request.bearer_auth(api_key);
        }

        let response = request.send().await?;
        let status = response.status();
        let body = response.text().await?;

        if !status.is_success() {
            let detail = extract_error_message(&body);
            if let Some(ref st) = log {
                st.push_api_log(
                    "llm",
                    "error",
                    format!("HTTP {} · {}", status.as_u16(), detail),
                );
            }
            return Err(AppError::Process(format!(
                "LLM request failed ({}): {}",
                status.as_u16(),
                detail
            )));
        }

        let payload: Value = serde_json::from_str(&body)?;
        if let Some(reason) = extract_completion_failure_reason(&payload) {
            if let Some(ref st) = log {
                st.push_api_log("llm", "warn", reason.clone());
            }
            return Err(AppError::Process(reason));
        }
        let content = extract_message_content(&payload).ok_or_else(|| {
            AppError::Process(format!(
                "LLM response did not contain message content. Response excerpt: {}",
                response_excerpt(&body)
            ))
        })?;
        let caption = sanitize_caption(&content);

        if caption.is_empty() {
            if let Some(ref st) = log {
                st.push_api_log("llm", "warn", "响应正文为空或无可用 caption".to_string());
            }
            return Err(AppError::Process(
                "LLM response did not contain a usable caption".to_string(),
            ));
        }

        if let Some(ref st) = log {
            st.push_api_log(
                "llm",
                "info",
                format!("响应 OK HTTP {} · caption_len={}", status.as_u16(), caption.len()),
            );
        }

        Ok(caption)
    };

    run_with_cancel(work, cancel).await
}

fn effective_system_prompt(settings: &LlmSettings) -> &str {
    if settings.system_prompt.trim().is_empty() {
        DEFAULT_SYSTEM_PROMPT.trim()
    } else {
        settings.system_prompt.trim()
    }
}

/// Max chars per text field in API log preview (system/user text).
const LLM_LOG_MAX_MESSAGE_TEXT_CHARS: usize = 8000;

fn format_llm_request_for_api_log(body: &Value, has_bearer_token: bool) -> String {
    let safe = redact_llm_chat_request_for_log(body);
    let pretty = serde_json::to_string_pretty(&safe).unwrap_or_else(|_| "{}".to_string());
    let auth_line = if has_bearer_token {
        "Authorization: Bearer *** (redacted)"
    } else {
        "Authorization: (none)"
    };
    format!(
        "请求参数（图片 data URL 已省略；过长文本已截断）\n{auth_line}\n{pretty}"
    )
}

fn redact_llm_chat_request_for_log(body: &Value) -> Value {
    let mut v = body.clone();
    if let Some(Value::Array(messages)) = v.get_mut("messages") {
        for msg in messages.iter_mut() {
            redact_one_chat_message_for_log(msg);
        }
    }
    v
}

fn redact_one_chat_message_for_log(msg: &mut Value) {
    let Some(obj) = msg.as_object_mut() else {
        return;
    };
    let Some(content) = obj.get_mut("content") else {
        return;
    };
    match content {
        Value::String(text) => {
            *content = Value::String(truncate_for_llm_log(text));
        }
        Value::Array(parts) => {
            for part in parts {
                let Some(part_obj) = part.as_object_mut() else {
                    continue;
                };
                match part_obj.get("type").and_then(|t| t.as_str()) {
                    Some("text") => {
                        if let Some(Value::String(text)) = part_obj.get_mut("text") {
                            *text = truncate_for_llm_log(text);
                        }
                    }
                    Some("image_url") => {
                        if let Some(img) = part_obj
                            .get_mut("image_url")
                            .and_then(|image| image.as_object_mut())
                        {
                            if let Some(url_val) = img.get_mut("url") {
                                let summary = match url_val {
                                    Value::String(s) if s.starts_with("data:") => {
                                        format!("<data URL omitted, {} bytes>", s.len())
                                    }
                                    Value::String(s) => {
                                        format!("<url omitted, {} bytes>", s.len())
                                    }
                                    _ => "<omitted>".to_string(),
                                };
                                *url_val = Value::String(summary);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
}

fn truncate_for_llm_log(s: &str) -> String {
    let max = LLM_LOG_MAX_MESSAGE_TEXT_CHARS;
    let count = s.chars().count();
    if count <= max {
        return s.to_string();
    }
    let head: String = s.chars().take(max).collect();
    format!("{head}... [truncated, total {count} chars]")
}

fn normalize_chat_completions_url(endpoint_url: &str) -> AppResult<String> {
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

fn extract_error_message(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|payload| {
            payload
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| body.trim().chars().take(400).collect())
}

fn extract_message_content(payload: &Value) -> Option<String> {
    payload
        .pointer("/choices/0/message/content")
        .and_then(extract_text_content)
        .or_else(|| {
            payload
                .pointer("/choices/0/text")
                .and_then(extract_text_content)
        })
        .or_else(|| payload.get("output_text").and_then(extract_text_content))
        .or_else(|| {
            payload
                .pointer("/output/0/content")
                .and_then(extract_text_content)
        })
}

fn extract_completion_failure_reason(payload: &Value) -> Option<String> {
    if let Some(refusal) = payload
        .pointer("/choices/0/message/refusal")
        .and_then(extract_text_content)
    {
        return Some(format!("LLM refused to generate a caption: {refusal}"));
    }

    let finish_reason = payload
        .pointer("/choices/0/finish_reason")
        .and_then(Value::as_str);
    let native_finish_reason = payload
        .pointer("/choices/0/native_finish_reason")
        .and_then(Value::as_str);

    if matches!(finish_reason, Some("content_filter"))
        || matches!(native_finish_reason, Some("content_filter"))
    {
        return Some(
            "LLM response was blocked by the provider's content filter. Try another model/provider, or add clearer user notes for this image."
                .to_string(),
        );
    }

    None
}

fn extract_text_content(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => non_empty_text(text),
        Value::Array(parts) => {
            let text = parts
                .iter()
                .filter_map(extract_text_content)
                .collect::<Vec<_>>()
                .join(" ");

            non_empty_text(&text)
        }
        Value::Object(map) => map
            .get("text")
            .and_then(extract_text_content)
            .or_else(|| map.get("content").and_then(extract_text_content))
            .or_else(|| map.get("output_text").and_then(extract_text_content))
            .or_else(|| map.get("value").and_then(extract_text_content)),
        _ => None,
    }
}

fn non_empty_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn response_excerpt(body: &str) -> String {
    let excerpt = body.trim().chars().take(400).collect::<String>();
    if excerpt.is_empty() {
        "<empty response>".to_string()
    } else {
        excerpt
    }
}

fn sanitize_caption(raw: &str) -> String {
    raw.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .trim_matches('`')
        .trim_matches('"')
        .trim_matches('\'')
        .to_string()
}

fn mime_type_for_image(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        _ => "application/octet-stream",
    }
}
