/**
 * @file lora_provider_bridge.rs
 * @description 将 lora 项目的 LLM 供应商库合并进 Agent `Settings`，替代 agent.db 内独立供应商配置。
 */
use rusqlite::Connection;

use crate::agent_error::{AppError, AppResult};
use crate::data::db::DbConn;
use crate::data::settings::{self, active_provider, ModelProvider, ModelServiceModel, Settings};
use crate::domain::llm::EndpointKind;
use crate::infra::db::repos::llm as lora_llm;

fn map_lora_err(error: crate::error::AppError) -> AppError {
    AppError::Other(error.to_string())
}

/**
 * 从 agent.db 读取 Agent 本地偏好（宽高比、历史轮数等），不含供应商列表。
 */
fn read_agent_local(agent_conn: &DbConn) -> AppResult<Settings> {
    let mut stmt = agent_conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut settings = Settings {
        default_aspect_ratio: "auto".into(),
        default_image_size: "auto".into(),
        ..Default::default()
    };

    for row in rows {
        let (key, value) = row?;
        match key.as_str() {
            settings::KEY_DEFAULT_RATIO => settings.default_aspect_ratio = value,
            settings::KEY_DEFAULT_SIZE => settings.default_image_size = value,
            settings::KEY_SYSTEM_PROMPT => settings.system_prompt = value,
            settings::KEY_TEMPERATURE => settings.temperature = parse_optional_f64(&value),
            settings::KEY_TOP_P => settings.top_p = parse_optional_f64(&value),
            settings::KEY_MAX_TOKENS => settings.max_tokens = parse_optional_i64(&value),
            settings::KEY_FREQ_PENALTY => settings.frequency_penalty = parse_optional_f64(&value),
            settings::KEY_PRES_PENALTY => settings.presence_penalty = parse_optional_f64(&value),
            settings::KEY_HISTORY_TURNS => {
                if let Some(n) = parse_optional_i64(&value) {
                    settings.history_turns = n.max(0);
                }
            }
            _ => {}
        }
    }

    Ok(settings)
}

/**
 * 读取合并后的 Agent 设置：供应商来自 lora.db，本地偏好来自 agent.db。
 */
pub fn read_merged(agent_conn: &DbConn, lora_conn: &Connection) -> AppResult<Settings> {
    let mut settings = read_agent_local(agent_conn)?;
    let global = lora_llm::load_llm_global_settings(lora_conn).map_err(map_lora_err)?;
    let summaries = lora_llm::list_llm_providers(lora_conn).map_err(map_lora_err)?;

    settings.model_services = summaries
        .iter()
        .filter_map(|summary| {
            lora_llm::get_llm_provider(lora_conn, &summary.id)
                .ok()
                .map(|provider| lora_provider_to_model_provider(&provider))
        })
        .collect();

    settings.active_provider_id = global.active_provider_id.clone();
    settings.model = global.active_model_id.clone();

    if settings.system_prompt.trim().is_empty() {
        settings.system_prompt = global.system_prompt.clone();
    }
    settings.temperature = Some(global.temperature as f64);
    settings.max_tokens = Some(global.max_tokens as i64);

    if let Some((endpoint, api_key, model)) = active_provider(&settings).map(|provider| {
        let model = if provider.models.iter().any(|m| m.id == settings.model) {
            settings.model.clone()
        } else {
            provider
                .models
                .first()
                .map(|m| m.id.clone())
                .unwrap_or_default()
        };
        (provider.endpoint.clone(), provider.api_key.clone(), model)
    }) {
        settings.endpoint = endpoint;
        settings.api_key = api_key;
        settings.model = model;
    } else {
        settings.endpoint.clear();
        settings.api_key.clear();
        settings.model.clear();
    }

    Ok(settings)
}

/**
 * 将模型/供应商切换写入 lora 全局选择。
 */
pub fn set_active_selection(
    lora_conn: &Connection,
    provider_id: &str,
    model_id: &str,
) -> AppResult<()> {
    lora_llm::set_active_llm_selection(lora_conn, provider_id, model_id).map_err(map_lora_err)?;
    Ok(())
}

fn normalize_openai_compat_endpoint(sdk: &str, endpoint_url: &str) -> String {
    if crate::ai::providers::normalize_sdk(sdk) != crate::ai::providers::OPENAI_SDK {
        return endpoint_url.trim().to_string();
    }
    let trimmed = endpoint_url.trim();
    if trimmed.contains("/responses")
        || trimmed.contains(":generateContent")
        || trimmed.contains("/messages")
        || trimmed.contains("/images/")
    {
        return trimmed.to_string();
    }
    crate::llm::http::normalize_chat_completions_url(trimmed)
        .unwrap_or_else(|_| trimmed.to_string())
}

fn lora_provider_to_model_provider(provider: &crate::domain::llm::LlmProvider) -> ModelProvider {
    let has_credentials =
        !provider.endpoint_url.trim().is_empty() && !provider.api_key.trim().is_empty();
    let sdk = endpoint_kind_to_sdk(provider.endpoint_kind, &provider.endpoint_url);
    ModelProvider {
        id: provider.id.clone(),
        name: provider.name.clone(),
        sdk: sdk.clone(),
        avatar: String::new(),
        endpoint: normalize_openai_compat_endpoint(&sdk, &provider.endpoint_url),
        api_key: provider.api_key.clone(),
        enabled: has_credentials,
        models: provider
            .models
            .iter()
            .map(|entry| ModelServiceModel {
                id: entry.model_id.clone(),
                name: entry
                    .label
                    .clone()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| short_model_name(&entry.model_id)),
                group: model_group(&entry.model_id),
                capabilities: infer_capabilities(&entry.model_id),
                context_window: None,
            })
            .collect(),
    }
}

fn endpoint_kind_to_sdk(kind: EndpointKind, endpoint_url: &str) -> String {
    match kind {
        EndpointKind::AnthropicCompat => crate::ai::providers::CLAUDE_SDK.into(),
        EndpointKind::OpenRouter | EndpointKind::OpenAi | EndpointKind::Auto => {
            sniff_sdk_from_url(endpoint_url)
        }
    }
}

fn sniff_sdk_from_url(endpoint_url: &str) -> String {
    let lower = endpoint_url.to_ascii_lowercase();
    if lower.contains("generativelanguage.googleapis.com") || lower.contains("gemini") {
        crate::ai::providers::GEMINI_SDK.into()
    } else if lower.contains("x.ai") || lower.contains("grok") {
        crate::ai::providers::GROK_SDK.into()
    } else if lower.contains("volces.com") || lower.contains("ark") {
        crate::ai::providers::ARK_IMAGES_SDK.into()
    } else if lower.contains("anthropic") {
        crate::ai::providers::CLAUDE_SDK.into()
    } else {
        crate::ai::providers::OPENAI_SDK.into()
    }
}

fn parse_optional_f64(value: &str) -> Option<f64> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        trimmed.parse().ok()
    }
}

fn parse_optional_i64(value: &str) -> Option<i64> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        trimmed.parse().ok()
    }
}

fn short_model_name(id: &str) -> String {
    id.rsplit('/').next().unwrap_or(id).to_string()
}

fn model_group(id: &str) -> String {
    id.split('/').next().unwrap_or("custom").to_string()
}

fn infer_capabilities(id: &str) -> Vec<String> {
    let id = id.to_ascii_lowercase();
    let mut out = Vec::new();
    if id.contains("image")
        || id.contains("vision")
        || id.contains("gemini")
        || id.contains("flux")
        || id.contains("gpt-5")
    {
        out.push("vision".into());
    }
    if id.contains("search") || id.contains("sonar") {
        out.push("web".into());
    }
    if id.contains("reason") || id.contains("thinking") || id.contains("o1") || id.contains("o3") {
        out.push("reasoning".into());
    }
    if out.is_empty() {
        out.push("text".into());
    }
    out
}
