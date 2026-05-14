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
) -> AppResult<String> {
    settings.validate().map_err(AppError::Validation)?;

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
        match generate_dataset_caption_once(settings, &image_data_url, user_message, cancel).await {
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
) -> AppResult<String> {
    if cancel.load(Ordering::SeqCst) {
        return Err(AppError::Cancelled);
    }

    let endpoint = normalize_chat_completions_url(&settings.endpoint_url)?;
    let system_prompt = effective_system_prompt(settings).to_string();
    let user_prompt = compose_auto_tag_user_prompt(user_message);
    let image_data_url = image_data_url.to_string();
    let model_id = settings.model_id.clone();
    let temperature = settings.temperature;
    let max_tokens = settings.max_tokens;
    let api_key = settings.api_key.trim().to_string();

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
    });

    let work = async move {
        let client = Client::new();
        let mut request = client.post(endpoint).json(&request_body);
        if !api_key.is_empty() {
            request = request.bearer_auth(api_key);
        }

        let response = request.send().await?;
        let status = response.status();
        let body = response.text().await?;

        if !status.is_success() {
            return Err(AppError::Process(format!(
                "LLM request failed ({}): {}",
                status.as_u16(),
                extract_error_message(&body)
            )));
        }

        let payload: Value = serde_json::from_str(&body)?;
        if let Some(reason) = extract_completion_failure_reason(&payload) {
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
            return Err(AppError::Process(
                "LLM response did not contain a usable caption".to_string(),
            ));
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
