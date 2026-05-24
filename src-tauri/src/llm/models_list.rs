//! 从 OpenAI 兼容 `/models` 端点拉取模型列表。

use reqwest::Client;
use serde_json::Value;

use crate::{
    error::{AppError, AppResult},
};

fn shared_client() -> &'static Client {
    crate::llm::shared_http_client()
}

fn normalize_models_url(endpoint_url: &str) -> AppResult<String> {
    let trimmed = endpoint_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(AppError::Validation("Endpoint URL is required".to_string()));
    }
    if trimmed.ends_with("/models") {
        return Ok(trimmed.to_string());
    }
    if trimmed.ends_with("/chat/completions") {
        return Ok(format!(
            "{}/models",
            trimmed.trim_end_matches("/chat/completions")
        ));
    }
    Ok(format!("{trimmed}/models"))
}

pub async fn fetch_remote_model_ids(
    endpoint_url: &str,
    api_key: &str,
) -> AppResult<Vec<String>> {
    let url = normalize_models_url(endpoint_url)?;
    let mut request = shared_client().get(&url);
    if !api_key.trim().is_empty() {
        request = request.bearer_auth(api_key.trim());
    }
    let response = request
        .send()
        .await
        .map_err(|err| AppError::Network(err.to_string()))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| AppError::Network(err.to_string()))?;
    if !status.is_success() {
        let detail = extract_error_message(&body);
        let code = status.as_u16();
        if code == 429 || (500..600).contains(&code) {
            return Err(AppError::HttpServer { status: code, detail });
        }
        return Err(AppError::HttpClient { status: code, detail });
    }
    let payload: Value = serde_json::from_str(&body).map_err(|err| {
        AppError::Parse(format!("Failed to parse /models response: {err}"))
    })?;
    let mut ids = Vec::new();
    if let Some(data) = payload.get("data").and_then(Value::as_array) {
        for item in data {
            if let Some(id) = item.get("id").and_then(Value::as_str) {
                let trimmed = id.trim();
                if !trimmed.is_empty() {
                    ids.push(trimmed.to_string());
                }
            }
        }
    }
    ids.sort();
    ids.dedup();
    Ok(ids)
}

fn extract_error_message(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|payload| {
            payload
                .get("error")
                .and_then(|error| error.get("message").and_then(Value::as_str))
                .map(str::to_string)
        })
        .unwrap_or_else(|| body.trim().chars().take(400).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_models_url_from_chat_completions() {
        assert_eq!(
            normalize_models_url("https://api.example.com/v1/chat/completions").unwrap(),
            "https://api.example.com/v1/models"
        );
    }
}
