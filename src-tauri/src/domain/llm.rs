/**
 * @file domain/llm.rs
 * @description LLM 领域类型：供应商档案、全局行为设置、生效请求设置，以及 endpoint kind/推理强度/上一图注入策略等枚举。
 */

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// defaults
// ---------------------------------------------------------------------------

fn default_caption_retry_max() -> u32 {
    3
}

fn default_llm_thinking_enabled() -> bool {
    false
}

fn default_endpoint_kind() -> EndpointKind {
    EndpointKind::Auto
}

fn default_reasoning_effort() -> ReasoningEffort {
    ReasoningEffort::Default
}

fn default_prior_caption_mode() -> PriorCaptionMode {
    PriorCaptionMode::InjectAsConversation
}

fn default_u32_zero() -> u32 {
    0
}

fn default_llm_model_id() -> String {
    "gpt-4o".to_string()
}

// ---------------------------------------------------------------------------
// enums
// ---------------------------------------------------------------------------

/// 上游 chat/completions 协议口径（决定如何注入 reasoning/thinking 字段、是否发 max_completion_tokens 等）。
///
/// `Auto` 时按 `endpoint_url` 嗅探（openrouter.ai → OpenRouter、api.anthropic.com → AnthropicCompat、其余 → OpenAi）。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EndpointKind {
    Auto,
    OpenAi,
    OpenRouter,
    AnthropicCompat,
}

impl Default for EndpointKind {
    fn default() -> Self {
        Self::Auto
    }
}

/// reasoning effort 档位（仅在思维模型上生效）。`Default` 表示"用兜底策略"，`None` 表示"显式关闭思考"。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReasoningEffort {
    Default,
    Minimal,
    Low,
    Medium,
    High,
    None,
}

impl Default for ReasoningEffort {
    fn default() -> Self {
        Self::Default
    }
}

impl ReasoningEffort {
    /// OpenRouter / OpenAI 风格 `reasoning.effort` / `reasoning_effort` 的字符串值。`Default` / `None` 返回 None。
    pub fn as_effort_str(self) -> Option<&'static str> {
        match self {
            Self::Default => None,
            Self::Minimal => Some("minimal"),
            Self::Low => Some("low"),
            Self::Medium => Some("medium"),
            Self::High => Some("high"),
            Self::None => Some("none"),
        }
    }
}

/// 上一张图 caption 的注入策略。
///
/// 默认 `InjectAsConversation`：构造一个合法的 `user(prompt 文本) → assistant(上一图 caption) →
/// user(当前图+prompt)` 多轮对话——**上一轮 user 只保留 prompt 文本、不重复发送上一张图**。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PriorCaptionMode {
    /// 完全不注入（保守模式，避免模型受上一图影响）。
    Off,
    /// 默认：模拟多轮对话 `user(prompt 文本) → assistant(上一 caption) → user(当前图+prompt)`，
    /// 上一轮 user **不重复发送图片**。
    InjectAsConversation,
    /// 把上一 caption 作为额外 assistant 消息直接插在当前 user 前（不构造前置 user 轮）。
    InjectAsAssistant,
    /// 把上一 caption 嵌入当前 user 消息正文，**显式标注**"reference caption for a DIFFERENT image, do not copy"。
    InjectAsUserExample,
}

impl Default for PriorCaptionMode {
    fn default() -> Self {
        Self::InjectAsConversation
    }
}

/// 单张打标时的交互模式。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CaptionTagMode {
    /// 从图片（+ 可选备注）直接生成 caption。
    Direct,
    /// 基于现有 caption + 用户指令，通过内部工具修改。
    ConversationModify,
}

impl Default for CaptionTagMode {
    fn default() -> Self {
        Self::Direct
    }
}

impl CaptionTagMode {
    pub fn parse(raw: Option<&str>) -> Self {
        match raw.map(str::trim).filter(|s| !s.is_empty()) {
            Some("conversationModify") => Self::ConversationModify,
            _ => Self::Direct,
        }
    }
}

/// 模型条目来源：手动维护或从 /models API 拉取。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LlmModelSource {
    Manual,
    Fetched,
}

impl Default for LlmModelSource {
    fn default() -> Self {
        Self::Manual
    }
}

// ---------------------------------------------------------------------------
// LlmSettings (effective request settings)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LlmSettings {
    pub endpoint_url: String,
    pub api_key: String,
    pub model_id: String,
    pub system_prompt: String,
    pub temperature: f32,
    pub max_tokens: u32,
    /// After the first failed LLM caption request, retry up to this many additional times (0 = no retry).
    #[serde(default = "default_caption_retry_max")]
    pub caption_retry_max: u32,
    /// Extended reasoning toggle: OpenRouter uses `reasoning` (`enabled` / `effort: "none"`); other endpoints use `thinking.type` (`enabled` / `disabled`) when applicable.
    #[serde(default = "default_llm_thinking_enabled")]
    pub thinking_enabled: bool,
    /// 显式选择上游协议类型（Auto 时按 URL 嗅探）。
    #[serde(default = "default_endpoint_kind")]
    pub endpoint_kind: EndpointKind,
    /// OpenAI o-series / GPT-5 等模型使用 `max_completion_tokens` 替代 `max_tokens`。0 表示不发送（沿用 `max_tokens`）。
    #[serde(default = "default_u32_zero")]
    pub max_completion_tokens: u32,
    /// 思维 token 预算（用于 Anthropic `thinking.budget_tokens` / OpenRouter `reasoning.max_tokens`）。0 = 不指定预算。
    #[serde(default = "default_u32_zero")]
    pub reasoning_budget: u32,
    /// reasoning 强度（Default = 用模型清单兜底；None = 显式关闭；其余按字面值发往上游）。
    #[serde(default = "default_reasoning_effort")]
    pub reasoning_effort: ReasoningEffort,
    /// 上一张图 caption 的注入策略，默认 Off（避免上一图 caption 泄漏到当前图）。
    #[serde(default = "default_prior_caption_mode")]
    pub prior_caption_mode: PriorCaptionMode,
    /// UI 选中的系统提示词预设 id（内置 / 自定义 / ad-hoc）。
    #[serde(default)]
    pub system_prompt_preset_id: String,
    /// 曾拒绝 image_url 输入的 model_id 列表；这些模型后续请求不再附带图片。
    #[serde(default)]
    pub text_only_model_ids: Vec<String>,
    /// 当前选中的供应商 id（effective 合并用；持久化在 LlmGlobalSettings）。
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub active_provider_id: String,
}

impl Default for LlmSettings {
    fn default() -> Self {
        Self {
            endpoint_url: "https://api.openai.com/v1".to_string(),
            api_key: String::new(),
            model_id: "gpt-4o".to_string(),
            system_prompt: include_str!("../../../prompts/system-prompt.en.md")
                .trim()
                .to_string(),
            temperature: 1.0,
            max_tokens: 8096,
            caption_retry_max: default_caption_retry_max(),
            thinking_enabled: default_llm_thinking_enabled(),
            endpoint_kind: default_endpoint_kind(),
            max_completion_tokens: default_u32_zero(),
            reasoning_budget: default_u32_zero(),
            reasoning_effort: default_reasoning_effort(),
            prior_caption_mode: default_prior_caption_mode(),
            system_prompt_preset_id: String::new(),
            text_only_model_ids: Vec::new(),
            active_provider_id: String::new(),
        }
    }
}

impl LlmSettings {
    /// 是否应在请求中附带图片（未被记录为纯文本模型时为 true）。
    pub fn should_include_image(&self) -> bool {
        !self
            .text_only_model_ids
            .iter()
            .any(|id| id == &self.model_id)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.endpoint_url.trim().is_empty() {
            return Err("Endpoint URL is required".to_string());
        }
        if self.model_id.trim().is_empty() {
            return Err("Model ID is required".to_string());
        }
        if !(0.0..=2.0).contains(&self.temperature) {
            return Err("Temperature must be between 0 and 2".to_string());
        }
        if self.max_tokens == 0 {
            return Err("Max tokens must be greater than zero".to_string());
        }
        if self.caption_retry_max > 20 {
            return Err("Caption retry count must be between 0 and 20".to_string());
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Provider records
// ---------------------------------------------------------------------------

/// 供应商下的一条模型记录。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderModelEntry {
    pub id: String,
    pub model_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default)]
    pub source: LlmModelSource,
}

/// LLM 供应商（连接档案 + 模型列表）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProvider {
    pub id: String,
    pub name: String,
    pub endpoint_url: String,
    pub api_key: String,
    #[serde(default = "default_endpoint_kind")]
    pub endpoint_kind: EndpointKind,
    #[serde(default)]
    pub models: Vec<LlmProviderModelEntry>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 列表展示用（apiKey 脱敏）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderSummary {
    pub id: String,
    pub name: String,
    pub endpoint_url: String,
    pub endpoint_kind: EndpointKind,
    pub models: Vec<LlmProviderModelEntry>,
    pub has_api_key: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl LlmProvider {
    pub fn to_summary(&self) -> LlmProviderSummary {
        LlmProviderSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            endpoint_url: self.endpoint_url.clone(),
            endpoint_kind: self.endpoint_kind,
            models: self.models.clone(),
            has_api_key: !self.api_key.trim().is_empty(),
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("Provider name is required".to_string());
        }
        if self.endpoint_url.trim().is_empty() {
            return Err("Endpoint URL is required".to_string());
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Global persisted behaviour
// ---------------------------------------------------------------------------

/// 全局 LLM 行为设置（不含连接信息）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LlmGlobalSettings {
    pub active_provider_id: String,
    pub active_model_id: String,
    pub system_prompt: String,
    pub temperature: f32,
    pub max_tokens: u32,
    #[serde(default = "default_caption_retry_max")]
    pub caption_retry_max: u32,
    #[serde(default = "default_llm_thinking_enabled")]
    pub thinking_enabled: bool,
    #[serde(default = "default_u32_zero")]
    pub max_completion_tokens: u32,
    #[serde(default = "default_u32_zero")]
    pub reasoning_budget: u32,
    #[serde(default = "default_reasoning_effort")]
    pub reasoning_effort: ReasoningEffort,
    #[serde(default = "default_prior_caption_mode")]
    pub prior_caption_mode: PriorCaptionMode,
    #[serde(default)]
    pub system_prompt_preset_id: String,
    #[serde(default)]
    pub text_only_model_ids: Vec<String>,
}

impl Default for LlmGlobalSettings {
    fn default() -> Self {
        Self {
            active_provider_id: String::new(),
            active_model_id: default_llm_model_id(),
            system_prompt: include_str!("../../../prompts/system-prompt.en.md")
                .trim()
                .to_string(),
            temperature: 1.0,
            max_tokens: 8096,
            caption_retry_max: default_caption_retry_max(),
            thinking_enabled: default_llm_thinking_enabled(),
            max_completion_tokens: default_u32_zero(),
            reasoning_budget: default_u32_zero(),
            reasoning_effort: default_reasoning_effort(),
            prior_caption_mode: default_prior_caption_mode(),
            system_prompt_preset_id: String::new(),
            text_only_model_ids: Vec::new(),
        }
    }
}

impl LlmGlobalSettings {
    pub fn validate(&self) -> Result<(), String> {
        if !(0.0..=2.0).contains(&self.temperature) {
            return Err("Temperature must be between 0 and 2".to_string());
        }
        if self.max_tokens == 0 {
            return Err("Max tokens must be greater than zero".to_string());
        }
        if self.caption_retry_max > 20 {
            return Err("Caption retry count must be between 0 and 20".to_string());
        }
        Ok(())
    }

    pub fn apply_behavior_to(&self, settings: &mut LlmSettings) {
        settings.system_prompt = self.system_prompt.clone();
        settings.temperature = self.temperature;
        settings.max_tokens = self.max_tokens;
        settings.caption_retry_max = self.caption_retry_max;
        settings.thinking_enabled = self.thinking_enabled;
        settings.max_completion_tokens = self.max_completion_tokens;
        settings.reasoning_budget = self.reasoning_budget;
        settings.reasoning_effort = self.reasoning_effort;
        settings.prior_caption_mode = self.prior_caption_mode;
        settings.system_prompt_preset_id = self.system_prompt_preset_id.clone();
        settings.text_only_model_ids = self.text_only_model_ids.clone();
        settings.active_provider_id = self.active_provider_id.clone();
    }

    pub fn ingest_behavior_from(&mut self, settings: &LlmSettings) {
        self.system_prompt = settings.system_prompt.clone();
        self.temperature = settings.temperature;
        self.max_tokens = settings.max_tokens;
        self.caption_retry_max = settings.caption_retry_max;
        self.thinking_enabled = settings.thinking_enabled;
        self.max_completion_tokens = settings.max_completion_tokens;
        self.reasoning_budget = settings.reasoning_budget;
        self.reasoning_effort = settings.reasoning_effort;
        self.prior_caption_mode = settings.prior_caption_mode;
        self.system_prompt_preset_id = settings.system_prompt_preset_id.clone();
        self.text_only_model_ids = settings.text_only_model_ids.clone();
        if !settings.active_provider_id.is_empty() {
            self.active_provider_id = settings.active_provider_id.clone();
        }
    }
}

/// 把 `LlmGlobalSettings` 与 `LlmProvider` 合并为一次请求需要的 `LlmSettings`。
pub fn resolve_effective_llm_settings(
    global: &LlmGlobalSettings,
    provider: Option<&LlmProvider>,
) -> LlmSettings {
    let mut settings = LlmSettings::default();
    global.apply_behavior_to(&mut settings);

    if let Some(p) = provider {
        settings.endpoint_url = p.endpoint_url.clone();
        settings.api_key = p.api_key.clone();
        settings.endpoint_kind = p.endpoint_kind;
        if !global.active_model_id.trim().is_empty() {
            settings.model_id = global.active_model_id.clone();
        } else if let Some(first) = p.models.first() {
            settings.model_id = first.model_id.clone();
        }
    }

    settings
}
