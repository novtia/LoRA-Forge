//! Helpers for assembling a [`ChatRequest`] from persisted settings.
//!
//! Historically this module also exposed `chat()` / `chat_stream()`
//! wrappers around [`crate::ai::providers::ProviderFactory`]. Those were
//! removed in favour of the agent-layer entry point
//! [`crate::ai::agent::run_agent`] with [`crate::ai::agent::ProviderQueryEngine`],
//! which adds task tracking, tool turns, and cancellation on top of the same
//! provider call.

use crate::ai::chat::{AttachmentBytes, ChatRequest, HistoryTurn, ProviderConfig};
use crate::ai::parameters::GenerationParameters;
use crate::ai::providers::{self, OPENAI_SDK};
use crate::data::settings;
use crate::agent_error::{AppError, AppResult};

/**
 * OpenAI 兼容 SDK 的 endpoint 需补全 `/chat/completions`，与 lora 打标流程一致。
 */
fn normalize_openai_compat_endpoint(sdk: &str, endpoint: &str) -> AppResult<String> {
    if providers::normalize_sdk(sdk) != OPENAI_SDK {
        return Ok(endpoint.trim().to_string());
    }
    let trimmed = endpoint.trim();
    if trimmed.contains("/responses")
        || trimmed.contains(":generateContent")
        || trimmed.contains("/messages")
        || trimmed.contains("/images/")
    {
        return Ok(trimmed.to_string());
    }
    crate::llm::http::normalize_chat_completions_url(trimmed)
        .map_err(|error| AppError::Config(error.to_string()))
}

pub fn build_chat_request(
    settings: &settings::Settings,
    prompt: String,
    attachments: Vec<AttachmentBytes>,
    system_prompt: String,
    history: Vec<HistoryTurn>,
    parameters: GenerationParameters,
) -> AppResult<ChatRequest> {
    let provider = settings::active_provider(settings)
        .ok_or_else(|| AppError::Config("no enabled model provider configured".into()))?;

    if provider.api_key.trim().is_empty() {
        return Err(AppError::Config("missing provider API key".into()));
    }
    if provider.endpoint.trim().is_empty() {
        return Err(AppError::Config("missing provider endpoint".into()));
    }
    if settings.model.trim().is_empty() {
        return Err(AppError::Config("missing active model".into()));
    }

    let sdk = providers::normalize_sdk(&provider.sdk);
    let endpoint = normalize_openai_compat_endpoint(&sdk, &provider.endpoint)?;

    Ok(ChatRequest {
        provider: ProviderConfig {
            id: provider.id.clone(),
            name: provider.name.clone(),
            sdk,
            endpoint,
            api_key: provider.api_key.clone(),
        },
        model: settings.model.clone(),
        prompt,
        attachments,
        system_prompt,
        history,
        parameters,
        tools: Vec::new(),
        tool_results: Vec::new(),
        pending_assistant_turn: None,
    })
}
