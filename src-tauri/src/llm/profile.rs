//! LLM 端点 / 模型适配层。
//!
//! 目标：让 `auto_tag_image` 流程能根据 `LlmSettings.endpoint_kind`、`model_id` 智能决定
//!
//! * 上游 HTTP 协议口径（OpenAI / OpenRouter / Anthropic 兼容）
//! * 该模型是否「思维模型」（决定是否注入 reasoning / thinking 字段、是否禁用 temperature）
//! * 该次请求的 reasoning / thinking 负载（effort / budget / 顶层 reasoning_effort 等）
//!
//! 见上层注释；本文件只描述策略，不发出 HTTP。

use serde_json::{json, Value};

use crate::models::{EndpointKind, LlmSettings, ReasoningEffort};

/// 解析最终生效的 endpoint kind：用户显式设置时优先，`Auto` 时按 URL 嗅探。
pub fn classify_endpoint(settings: &LlmSettings) -> EndpointKind {
    match settings.endpoint_kind {
        EndpointKind::Auto => sniff_endpoint_kind(&settings.endpoint_url),
        explicit => explicit,
    }
}

fn sniff_endpoint_kind(endpoint_url: &str) -> EndpointKind {
    let host = endpoint_url.to_ascii_lowercase();
    if host.contains("openrouter.ai") {
        EndpointKind::OpenRouter
    } else if host.contains("api.anthropic.com") || host.contains("anthropic.") {
        EndpointKind::AnthropicCompat
    } else {
        EndpointKind::OpenAi
    }
}

/// 是否为「思维模型」。命中即视为需要注入 reasoning/thinking 字段、并在 OpenAI 协议下避免 temperature。
///
/// 兜底清单基于公开模型 id 前缀/包含关系（保持大小写不敏感）。误判率可控；用户可通过设置
/// `reasoning_effort = None` 显式关闭。
pub fn is_thinking_model(model_id: &str) -> bool {
    let id = model_id.to_ascii_lowercase();

    // OpenAI o-series 与 GPT-5 系列
    if id.starts_with("o1") || id.starts_with("o3") || id.starts_with("o4") {
        return true;
    }
    if id.starts_with("gpt-5") || id.contains("/gpt-5") {
        return true;
    }

    // Gemini thinking 系列
    if id.contains("gemini") && (id.contains("thinking") || id.contains("-pro") || id.contains("2.5")) {
        return true;
    }

    // Claude thinking / extended reasoning
    if id.contains("claude")
        && (id.contains("thinking") || id.contains("opus-4") || id.contains("sonnet-4"))
    {
        return true;
    }

    // Qwen3 thinking
    if id.contains("qwen3") && id.contains("thinking") {
        return true;
    }

    // DeepSeek R1 系列
    if id.contains("deepseek") && (id.contains("r1") || id.contains("reasoner")) {
        return true;
    }

    // Grok reasoning
    if id.contains("grok") && id.contains("reasoning") {
        return true;
    }

    false
}

/// 计算「最终发送」的 reasoning 字段（OpenRouter / Anthropic 风格）或 OpenAI `reasoning_effort` 顶层字段。
///
/// * `OpenRouter`：返回 `Some(("reasoning", {...}))`，`reasoning_budget > 0` 则发 `{"max_tokens": budget}`，否则发 `{"effort": "..."}`。
///   用户 `reasoning_effort = None` → 发 `{"effort": "none"}`。
///   普通（非思维）模型默认不发；仅当用户 `thinking_enabled = true` 才发 `{"enabled": true}`。
/// * `AnthropicCompat`：思维模型返回 `Some(("thinking", {"type":"enabled","budget_tokens":...}))`，普通模型不发。
/// * `OpenAi`：思维模型返回 `Some(("reasoning_effort", "high"/"medium"/...))`，普通模型不发。
///
/// 返回 `(field_name, value)`；调用方负责把它写进 request body。
pub fn build_reasoning_payload(
    kind: EndpointKind,
    settings: &LlmSettings,
    is_thinking: bool,
) -> Option<(&'static str, Value)> {
    match kind {
        EndpointKind::OpenRouter => build_openrouter_reasoning(settings, is_thinking),
        EndpointKind::AnthropicCompat => build_anthropic_thinking(settings, is_thinking),
        EndpointKind::OpenAi | EndpointKind::Auto => build_openai_reasoning(settings, is_thinking),
    }
}

fn build_openrouter_reasoning(
    settings: &LlmSettings,
    is_thinking: bool,
) -> Option<(&'static str, Value)> {
    // 用户显式关闭 → 始终发 effort: none（即使是 thinking 模型也明确请求关闭）
    if matches!(settings.reasoning_effort, ReasoningEffort::None) {
        return Some(("reasoning", json!({ "effort": "none" })));
    }

    if !is_thinking {
        // 非思维模型：仅在用户显式打开 thinking_enabled 时发 enabled，否则不发任何字段
        if settings.thinking_enabled {
            return Some(("reasoning", json!({ "enabled": true })));
        }
        return None;
    }

    // 思维模型：默认 effort=high（除非用户显式选了别的）；budget>0 改用 max_tokens
    if settings.reasoning_budget > 0 {
        return Some((
            "reasoning",
            json!({ "max_tokens": settings.reasoning_budget }),
        ));
    }

    let effort = settings
        .reasoning_effort
        .as_effort_str()
        .unwrap_or("high");
    Some(("reasoning", json!({ "effort": effort })))
}

fn build_anthropic_thinking(
    settings: &LlmSettings,
    is_thinking: bool,
) -> Option<(&'static str, Value)> {
    if !is_thinking && !settings.thinking_enabled {
        return None;
    }
    let budget = if settings.reasoning_budget > 0 {
        settings.reasoning_budget
    } else {
        // 兜底：max_tokens 一半，至少 1024
        (settings.max_tokens / 2).max(1024)
    };
    Some((
        "thinking",
        json!({
            "type": "enabled",
            "budget_tokens": budget,
        }),
    ))
}

fn build_openai_reasoning(
    settings: &LlmSettings,
    is_thinking: bool,
) -> Option<(&'static str, Value)> {
    if !is_thinking {
        return None;
    }
    // 用户显式 None 也照发；非 thinking 模型上面已经返回
    let effort = settings
        .reasoning_effort
        .as_effort_str()
        .unwrap_or("high");
    Some(("reasoning_effort", Value::String(effort.to_string())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::PriorCaptionMode;

    fn mk(endpoint: &str, model: &str) -> LlmSettings {
        LlmSettings {
            endpoint_url: endpoint.to_string(),
            api_key: String::new(),
            model_id: model.to_string(),
            system_prompt: String::new(),
            temperature: 1.0,
            max_tokens: 4096,
            caption_retry_max: 0,
            thinking_enabled: false,
            endpoint_kind: EndpointKind::Auto,
            max_completion_tokens: 0,
            reasoning_budget: 0,
            reasoning_effort: ReasoningEffort::Default,
            prior_caption_mode: PriorCaptionMode::Off,
            system_prompt_preset_id: String::new(),
            text_only_model_ids: Vec::new(),
            active_provider_id: String::new(),
        }
    }

    #[test]
    fn sniff_openrouter() {
        let s = mk("https://openrouter.ai/api/v1", "google/gemini-2.5-flash");
        assert_eq!(classify_endpoint(&s), EndpointKind::OpenRouter);
    }

    #[test]
    fn sniff_openai_default() {
        let s = mk("https://api.openai.com/v1", "gpt-4o");
        assert_eq!(classify_endpoint(&s), EndpointKind::OpenAi);
    }

    #[test]
    fn detect_thinking_models() {
        assert!(is_thinking_model("o4-mini"));
        assert!(is_thinking_model("gpt-5-pro"));
        assert!(is_thinking_model("google/gemini-2.5-pro"));
        assert!(is_thinking_model("anthropic/claude-opus-4-thinking"));
        assert!(!is_thinking_model("gpt-4o"));
        assert!(!is_thinking_model("google/gemini-1.5-flash"));
    }

    #[test]
    fn openrouter_thinking_default_high() {
        let s = mk(
            "https://openrouter.ai/api/v1",
            "google/gemini-2.5-pro",
        );
        let payload = build_reasoning_payload(EndpointKind::OpenRouter, &s, true).unwrap();
        assert_eq!(payload.0, "reasoning");
        assert_eq!(payload.1, json!({ "effort": "high" }));
    }

    #[test]
    fn openrouter_thinking_budget_overrides_effort() {
        let mut s = mk(
            "https://openrouter.ai/api/v1",
            "google/gemini-2.5-pro",
        );
        s.reasoning_budget = 2048;
        let payload = build_reasoning_payload(EndpointKind::OpenRouter, &s, true).unwrap();
        assert_eq!(payload.1, json!({ "max_tokens": 2048 }));
    }

    #[test]
    fn openrouter_explicit_none() {
        let mut s = mk(
            "https://openrouter.ai/api/v1",
            "google/gemini-2.5-pro",
        );
        s.reasoning_effort = ReasoningEffort::None;
        let payload = build_reasoning_payload(EndpointKind::OpenRouter, &s, true).unwrap();
        assert_eq!(payload.1, json!({ "effort": "none" }));
    }

    #[test]
    fn openrouter_non_thinking_no_payload() {
        let s = mk("https://openrouter.ai/api/v1", "openai/gpt-4o");
        assert!(build_reasoning_payload(EndpointKind::OpenRouter, &s, false).is_none());
    }

    #[test]
    fn openai_thinking_emits_reasoning_effort() {
        let s = mk("https://api.openai.com/v1", "o4-mini");
        let payload = build_reasoning_payload(EndpointKind::OpenAi, &s, true).unwrap();
        assert_eq!(payload.0, "reasoning_effort");
        assert_eq!(payload.1, Value::String("high".to_string()));
    }

    #[test]
    fn anthropic_thinking_default_budget() {
        let s = mk("https://api.anthropic.com/v1", "claude-opus-4");
        let payload = build_reasoning_payload(EndpointKind::AnthropicCompat, &s, true).unwrap();
        assert_eq!(payload.0, "thinking");
        // max_tokens=4096 → budget = max(1024, 2048) = 2048
        assert_eq!(
            payload.1,
            json!({"type":"enabled","budget_tokens":2048})
        );
    }
}
