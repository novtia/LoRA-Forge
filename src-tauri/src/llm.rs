use std::{fs, path::Path};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::Client;
use serde_json::{json, Value};

use crate::{
    error::{AppError, AppResult},
    models::LlmSettings,
};

const DEFAULT_SYSTEM_PROMPT: &str = include_str!("../../prompts/system-prompt.en.md");
const AUTO_TAG_PROMPT: &str = "Generate a concise, training-ready caption for this image for a Stable Diffusion or LoRA dataset. Return only a comma-separated caption with no preamble. Include subject, appearance, clothing, pose, framing, environment, lighting, and style cues when visible. Keep it factual and useful for image training.";
const WD14_PROMPT: &str = "Generate dense booru-style tags for this image. Return only comma-separated tags with no preamble, no numbering, and no explanation. Prefer short descriptive tags covering subject, hair, face, clothing, pose, camera angle, environment, lighting, and quality details.";

pub async fn generate_dataset_caption(
    settings: &LlmSettings,
    image_path: &Path,
    mode: &str,
) -> AppResult<String> {
    settings.validate().map_err(AppError::Validation)?;

    let image_bytes = fs::read(image_path)?;
    let image_data_url = format!(
        "data:{};base64,{}",
        mime_type_for_image(image_path),
        STANDARD.encode(image_bytes)
    );
    let endpoint = normalize_chat_completions_url(&settings.endpoint_url)?;
    let user_prompt = if mode == "wd14" {
        WD14_PROMPT
    } else {
        AUTO_TAG_PROMPT
    };
    let system_prompt = effective_system_prompt(settings);

    let request_body = json!({
        "model": settings.model_id,
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
        "temperature": settings.temperature,
        "max_tokens": settings.max_tokens,
    });

    let client = Client::new();
    let mut request = client.post(endpoint).json(&request_body);

    if !settings.api_key.trim().is_empty() {
        request = request.bearer_auth(settings.api_key.trim());
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
            "LLM response was blocked by the provider's content filter. Try another model/provider or use WD14 for this image."
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
