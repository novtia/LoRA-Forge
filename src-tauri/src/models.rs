use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProjectStatus {
    Ready,
    Running,
    Paused,
    Completed,
    Error,
    Interrupted,
    Aborted,
}

impl Default for ProjectStatus {
    fn default() -> Self {
        Self::Ready
    }
}

impl ProjectStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Completed => "completed",
            Self::Error => "error",
            Self::Interrupted => "interrupted",
            Self::Aborted => "aborted",
        }
    }

    pub fn from_db(value: &str) -> Self {
        match value {
            "running" => Self::Running,
            "paused" => Self::Paused,
            "completed" => Self::Completed,
            "error" => Self::Error,
            "interrupted" => Self::Interrupted,
            "aborted" => Self::Aborted,
            _ => Self::Ready,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum JobStatus {
    Running,
    Paused,
    Completed,
    Failed,
    Interrupted,
    Aborted,
}

impl Default for JobStatus {
    fn default() -> Self {
        Self::Interrupted
    }
}

impl JobStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Interrupted => "interrupted",
            Self::Aborted => "aborted",
        }
    }

    pub fn from_db(value: &str) -> Self {
        match value {
            "running" => Self::Running,
            "paused" => Self::Paused,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "aborted" => Self::Aborted,
            _ => Self::Interrupted,
        }
    }

    pub fn to_project_status(self) -> ProjectStatus {
        match self {
            Self::Running => ProjectStatus::Running,
            Self::Paused => ProjectStatus::Paused,
            Self::Completed => ProjectStatus::Completed,
            Self::Failed => ProjectStatus::Error,
            Self::Interrupted => ProjectStatus::Interrupted,
            Self::Aborted => ProjectStatus::Aborted,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub dataset_path: String,
    pub output_path: String,
    pub status: ProjectStatus,
    pub tags: Vec<String>,
    pub size_bytes: u64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TrainingConfig {
    pub training_script: String,
    pub pretrained_model: String,
    pub resolution: String,
    pub vae: String,
    /// Qwen3-0.6B path (directory or `.safetensors`). Required when training with `anima_train_network.py`.
    pub anima_qwen3: String,
    /// Learning rate for Anima LLM adapter. Use `0` to freeze (recommended). Empty omits the flag (sd-scripts default).
    pub anima_llm_adapter_lr: String,
    pub clip_skip: u32,
    pub network_dim: u32,
    pub network_alpha: u32,
    pub conv_dim: u32,
    pub conv_alpha: u32,
    pub network_dropout: String,
    pub batch_size: u32,
    /// `steps` → CLI `--max_train_steps` (`max_train_steps`). `epochs` → `--max_train_epochs` (`epochs`). Mutually exclusive.
    #[serde(default = "default_training_length_mode")]
    pub training_length_mode: String,
    /// Total optimizer steps when `training_length_mode == "steps"`.
    #[serde(default = "default_max_train_steps_config")]
    pub max_train_steps: u32,
    pub epochs: u32,
    pub save_every_n_epochs: u32,
    pub mixed_precision: String,
    pub save_precision: String,
    pub optimizer: String,
    pub optimizer_args: String,
    pub lr_scheduler: String,
    pub lr_scheduler_num_cycles: String,
    pub lr_scheduler_power: String,
    pub base_lr: String,
    pub unet_lr: String,
    pub text_encoder_lr: String,
    pub lr_warmup_steps: u32,
    pub min_snr_gamma: String,
    pub noise_offset: String,
    pub max_grad_norm: String,
    pub seed: u32,
    pub keep_tokens: u32,
    pub caption_dropout_rate: String,
    pub caption_tag_dropout_rate: String,
    pub dataset_repeats: u32,
    pub enable_bucket: bool,
    pub min_bucket_reso: u32,
    pub max_bucket_reso: u32,
    pub bucket_reso_steps: u32,
    pub cache_latents: bool,
    pub cache_latents_to_disk: bool,
    pub max_data_loader_workers: u32,
    pub persistent_data_loader_workers: bool,
    pub gradient_checkpointing: bool,
    pub xformers: bool,
    pub shuffle_captions: bool,
    pub color_jitter: bool,
    pub save_every_n_steps: u32,
    pub save_last_n_epochs: u32,
    pub save_last_n_steps: u32,
    pub sample_every_n_steps: u32,
    pub sample_at_first: bool,
    pub sample_every_n_epochs: u32,
    pub sample_prompts: String,
    pub sample_negative_prompt: String,
    pub sample_width: u32,
    pub sample_height: u32,
    pub sample_steps: u32,
    pub sample_cfg_scale: String,
    pub sample_seed: u32,
    pub sample_sampler: String,
    pub network_weights: String,
    pub resume: String,
    pub initial_epoch: u32,
    pub initial_step: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TrainingEnvSettings {
    pub sd_scripts_path: String,
    pub python_executable: String,
    #[serde(default = "default_wsl_distro")]
    pub wsl_distro: String,
    pub diffusion_pipe_wsl_path: String,
    pub diffusion_pipe_venv_path: String,
    #[serde(default = "default_num_gpus")]
    pub num_gpus: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DiffusionPipeConfig {
    pub model_type: String,
    pub model_path: String,
    pub transformer_path: String,
    pub vae_path: String,
    pub llm_path: String,
    pub clip_path: String,
    pub model_dtype: String,
    pub transformer_dtype: String,
    pub timestep_sample_method: String,
    pub adapter_type: String,
    #[serde(default = "default_lora_rank")]
    pub lora_rank: u32,
    pub lora_dtype: String,
    pub optimizer_type: String,
    pub lr: String,
    pub weight_decay: String,
    #[serde(default = "default_dp_epochs")]
    pub epochs: u32,
    pub max_steps: u32,
    #[serde(default = "default_u32_one")]
    pub micro_batch_size_per_gpu: u32,
    #[serde(default = "default_u32_one")]
    pub gradient_accumulation_steps: u32,
    pub gradient_clipping: String,
    #[serde(default = "default_warmup_steps")]
    pub warmup_steps: u32,
    pub activation_checkpointing: String,
    pub blocks_to_swap: u32,
    pub save_dtype: String,
    #[serde(default = "default_save_every_n_epochs")]
    pub save_every_n_epochs: u32,
    pub save_every_n_steps: u32,
    #[serde(default = "default_u32_one")]
    pub eval_every_n_epochs: u32,
    #[serde(default = "default_checkpoint_minutes")]
    pub checkpoint_every_n_minutes: u32,
    pub dataset_resolutions: String,
    pub enable_ar_bucket: bool,
    #[serde(default = "default_num_ar_buckets")]
    pub num_ar_buckets: u32,
    pub frame_buckets: String,
    #[serde(default = "default_u32_one")]
    pub num_repeats: u32,
    pub resume_from_checkpoint: String,
    pub nccl_disable: bool,
    pub steps_per_print: u32,
}

impl Default for DiffusionPipeConfig {
    fn default() -> Self {
        Self {
            model_type: "hunyuan-video".to_string(),
            model_path: String::new(),
            transformer_path: String::new(),
            vae_path: String::new(),
            llm_path: String::new(),
            clip_path: String::new(),
            model_dtype: "bfloat16".to_string(),
            transformer_dtype: "float8".to_string(),
            timestep_sample_method: "logit_normal".to_string(),
            adapter_type: "lora".to_string(),
            lora_rank: 32,
            lora_dtype: "bfloat16".to_string(),
            optimizer_type: "adamw_optimi".to_string(),
            lr: "2e-5".to_string(),
            weight_decay: "0.01".to_string(),
            epochs: 1000,
            max_steps: 0,
            micro_batch_size_per_gpu: 1,
            gradient_accumulation_steps: 1,
            gradient_clipping: "1.0".to_string(),
            warmup_steps: 100,
            activation_checkpointing: "true".to_string(),
            blocks_to_swap: 0,
            save_dtype: "bfloat16".to_string(),
            save_every_n_epochs: 5,
            save_every_n_steps: 0,
            eval_every_n_epochs: 1,
            checkpoint_every_n_minutes: 120,
            dataset_resolutions: "512".to_string(),
            enable_ar_bucket: true,
            num_ar_buckets: 7,
            frame_buckets: "1,33".to_string(),
            num_repeats: 1,
            resume_from_checkpoint: String::new(),
            nccl_disable: true,
            steps_per_print: 1,
        }
    }
}

fn default_wsl_distro() -> String {
    "Ubuntu".to_string()
}

fn default_num_gpus() -> u32 {
    1
}

fn default_lora_rank() -> u32 {
    32
}

fn default_dp_epochs() -> u32 {
    1000
}

fn default_u32_one() -> u32 {
    1
}

fn default_warmup_steps() -> u32 {
    100
}

fn default_save_every_n_epochs() -> u32 {
    5
}

fn default_checkpoint_minutes() -> u32 {
    120
}

fn default_num_ar_buckets() -> u32 {
    7
}

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

fn default_training_length_mode() -> String {
    "steps".to_string()
}

fn default_max_train_steps_config() -> u32 {
    6000
}

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
///
/// 这是经实测最稳的默认：
/// * 给了模型完整的多轮对话上下文（assistant 不再是凭空冒出来的）
/// * 不重复发送上一张图，token 压力可控
/// * 不让上一张露骨图片在 Gemini / Claude 等的安全模型里触发二次审核 —— 上一张图 + 上一张
///   露骨 caption 同时出现时，部分 thinking 模型会把后续 token 全花在 reasoning 上、`completion=0`
///   返回 `PROHIBITED_CONTENT`（NSFW LoRA 数据集批量打标时尤其常见）。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PriorCaptionMode {
    /// 完全不注入（保守模式，避免模型受上一图影响）。
    Off,
    /// 默认：模拟多轮对话 `user(prompt 文本) → assistant(上一 caption) → user(当前图+prompt)`，
    /// 上一轮 user **不重复发送图片**。
    InjectAsConversation,
    /// 把上一 caption 作为额外 assistant 消息直接插在当前 user 前（不构造前置 user 轮）。
    /// 结构上不合法（assistant 凭空冒出），但部分模型容忍。
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
            system_prompt: include_str!("../../prompts/system-prompt.en.md")
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

fn default_llm_model_id() -> String {
    "gpt-4o".to_string()
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

impl LlmSettings {
    /// 是否应在请求中附带图片（未被记录为纯文本模型时为 true）。
    pub fn should_include_image(&self) -> bool {
        !self
            .text_only_model_ids
            .iter()
            .any(|id| id == &self.model_id)
    }
}

fn default_sd_scripts_path() -> String {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("sd-scripts")
        .to_string_lossy()
        .to_string()
}

impl Default for TrainingEnvSettings {
    fn default() -> Self {
        Self {
            sd_scripts_path: default_sd_scripts_path(),
            python_executable: String::new(),
            wsl_distro: default_wsl_distro(),
            diffusion_pipe_wsl_path: String::new(),
            diffusion_pipe_venv_path: String::new(),
            num_gpus: default_num_gpus(),
        }
    }
}

impl Default for TrainingConfig {
    fn default() -> Self {
        Self {
            training_script: "train_network.py".to_string(),
            pretrained_model: "runwayml/stable-diffusion-v1-5".to_string(),
            resolution: "1024x1024".to_string(),
            vae: String::new(),
            anima_qwen3: String::new(),
            anima_llm_adapter_lr: "0".to_string(),
            clip_skip: 0,
            network_dim: 128,
            network_alpha: 64,
            conv_dim: 0,
            conv_alpha: 0,
            network_dropout: "0".to_string(),
            batch_size: 4,
            training_length_mode: default_training_length_mode(),
            max_train_steps: default_max_train_steps_config(),
            epochs: 20,
            save_every_n_epochs: 1,
            mixed_precision: "bf16".to_string(),
            save_precision: String::new(),
            optimizer: "AdamW8bit".to_string(),
            optimizer_args: String::new(),
            lr_scheduler: "cosine_with_restarts".to_string(),
            lr_scheduler_num_cycles: String::new(),
            lr_scheduler_power: String::new(),
            base_lr: "1.50e-4".to_string(),
            unet_lr: "1.50e-4".to_string(),
            text_encoder_lr: "5.0e-5".to_string(),
            lr_warmup_steps: 0,
            min_snr_gamma: "5".to_string(),
            noise_offset: "0.1".to_string(),
            max_grad_norm: "0".to_string(),
            seed: 0,
            keep_tokens: 0,
            caption_dropout_rate: "0".to_string(),
            caption_tag_dropout_rate: "0".to_string(),
            dataset_repeats: 1,
            enable_bucket: false,
            min_bucket_reso: 256,
            max_bucket_reso: 1024,
            bucket_reso_steps: 64,
            cache_latents: true,
            cache_latents_to_disk: false,
            max_data_loader_workers: 2,
            persistent_data_loader_workers: false,
            gradient_checkpointing: true,
            xformers: true,
            shuffle_captions: true,
            color_jitter: false,
            save_every_n_steps: 0,
            save_last_n_epochs: 0,
            save_last_n_steps: 0,
            sample_every_n_steps: 0,
            sample_at_first: false,
            sample_every_n_epochs: 0,
            sample_prompts: String::new(),
            sample_negative_prompt: String::new(),
            sample_width: 1024,
            sample_height: 1024,
            sample_steps: 30,
            sample_cfg_scale: "7.5".to_string(),
            sample_seed: 0,
            sample_sampler: "ddim".to_string(),
            network_weights: String::new(),
            resume: String::new(),
            initial_epoch: 0,
            initial_step: 0,
        }
    }
}

impl Default for LlmSettings {
    fn default() -> Self {
        Self {
            endpoint_url: "https://api.openai.com/v1".to_string(),
            api_key: String::new(),
            model_id: "gpt-4o".to_string(),
            system_prompt: include_str!("../../prompts/system-prompt.en.md")
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

impl TrainingConfig {
    pub fn validate(&self) -> Result<(), String> {
        let script = self.training_script.trim();
        if !matches!(
            script,
            "train_network.py" | "sdxl_train_network.py" | "anima_train_network.py"
        ) {
            return Err(format!("Unsupported training script: '{script}'"));
        }
        if self.pretrained_model.trim().is_empty() {
            return Err("Pretrained model is required".to_string());
        }
        if script == "anima_train_network.py" {
            if self.anima_qwen3.trim().is_empty() {
                return Err("Anima training requires the Qwen3 text encoder path (--qwen3)".to_string());
            }
            if self.vae.trim().is_empty() {
                return Err("Anima training requires the Qwen-Image VAE path (--vae)".to_string());
            }
            let llm_lr = self.anima_llm_adapter_lr.trim();
            if !llm_lr.is_empty() {
                llm_lr.parse::<f64>().map_err(|_| {
                    format!("LLM adapter LR must be a valid number, got '{llm_lr}'")
                })?;
            }
        }
        let (width, height) = parse_resolution_dimensions(&self.resolution)?;
        if self.batch_size == 0 {
            return Err("Batch size must be greater than zero".to_string());
        }
        let length_mode = self.training_length_mode.to_ascii_lowercase();
        if length_mode != "steps" && length_mode != "epochs" {
            return Err(format!(
                "Training length mode must be 'steps' or 'epochs', got '{}'",
                self.training_length_mode.trim()
            ));
        }
        if length_mode == "steps" {
            if self.max_train_steps == 0 {
                return Err("Max train steps must be greater than zero when using step-based training length".to_string());
            }
        } else if self.epochs == 0 {
            return Err("Epochs must be greater than zero when using epoch-based training length".to_string());
        }
        if self.save_every_n_epochs == 0 {
            return Err("Save frequency must be greater than zero".to_string());
        }
        if self.dataset_repeats == 0 {
            return Err("Dataset repeats must be greater than zero".to_string());
        }
        if self.enable_bucket {
            if self.bucket_reso_steps == 0 {
                return Err("Bucket resolution steps must be greater than zero".to_string());
            }
            if self.min_bucket_reso == 0 || self.max_bucket_reso == 0 {
                return Err("Bucket resolutions must be greater than zero".to_string());
            }
            if self.min_bucket_reso > self.max_bucket_reso {
                return Err(
                    "Minimum bucket resolution cannot exceed maximum bucket resolution".to_string(),
                );
            }
            let min_bucket_step = if script == "sdxl_train_network.py" || script == "anima_train_network.py"
            {
                32
            } else {
                64
            };
            if self.bucket_reso_steps % min_bucket_step != 0 {
                return Err(format!(
                    "Bucket resolution steps must be divisible by {min_bucket_step} for {script}"
                ));
            }
            if self.min_bucket_reso > width.min(height) {
                return Err("Minimum bucket resolution must be less than or equal to the smaller training resolution side".to_string());
            }
            if self.max_bucket_reso < width.max(height) {
                return Err("Maximum bucket resolution must be greater than or equal to the larger training resolution side".to_string());
            }
        }
        if length_mode == "steps" {
            if self.initial_step > 0 && self.initial_step >= self.max_train_steps {
                return Err("Initial step must be smaller than the total train steps".to_string());
            }
        }
        if length_mode == "epochs" && self.initial_epoch > self.epochs {
            return Err("Initial epoch cannot exceed the total epochs".to_string());
        }
        let sample_sampler = self.sample_sampler.trim();
        if !sample_sampler.is_empty()
            && !matches!(
                sample_sampler,
                "ddim"
                    | "pndm"
                    | "lms"
                    | "euler"
                    | "euler_a"
                    | "heun"
                    | "dpm_2"
                    | "dpm_2_a"
                    | "dpmsolver"
                    | "dpmsolver++"
                    | "dpmsingle"
                    | "k_lms"
                    | "k_euler"
                    | "k_euler_a"
                    | "k_dpm_2"
                    | "k_dpm_2_a"
            )
        {
            return Err(format!("Unsupported sample sampler: '{sample_sampler}'"));
        }
        let sample_enabled =
            self.sample_at_first || self.sample_every_n_steps > 0 || self.sample_every_n_epochs > 0;
        if sample_enabled
            && !self
                .sample_prompts
                .lines()
                .any(|line| !line.trim().is_empty())
        {
            return Err("Sample prompt text is required when sample image generation is enabled".to_string());
        }
        if sample_enabled && (self.sample_width == 0 || self.sample_height == 0) {
            return Err("Sample image width and height must be greater than zero".to_string());
        }
        if sample_enabled && self.sample_steps == 0 {
            return Err("Sample image steps must be greater than zero".to_string());
        }
        if sample_enabled {
            let cfg_scale = self.sample_cfg_scale.trim();
            if cfg_scale.is_empty() {
                return Err("Sample CFG scale is required when sample image generation is enabled".to_string());
            }
            cfg_scale.parse::<f64>().map_err(|_| {
                format!(
                    "Sample CFG scale must be a valid number, got '{}'",
                    self.sample_cfg_scale.trim()
                )
            })?;
        }
        Ok(())
    }

    pub fn summary_tags(&self) -> Vec<String> {
        let script = self.training_script.trim();
        let model_tag = self
            .pretrained_model
            .split('/')
            .next_back()
            .unwrap_or("MODEL")
            .replace('-', "_")
            .to_uppercase();
        if script == "anima_train_network.py" {
            vec![
                "ANIMA".to_string(),
                model_tag,
                format!("DIM: {}", self.network_dim),
                self.optimizer.to_uppercase(),
            ]
        } else {
            vec![
                model_tag,
                format!("DIM: {}", self.network_dim),
                self.optimizer.to_uppercase(),
            ]
        }
    }
}

fn parse_resolution_dimensions(value: &str) -> Result<(u32, u32), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Resolution is required".to_string());
    }

    let normalized = trimmed.replace('x', ",").replace('X', ",");
    let parts = normalized
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();

    let parse_part = |part: &str| {
        part.parse::<u32>()
            .map_err(|_| format!("Resolution must be numeric, got '{trimmed}'"))
    };

    match parts.as_slice() {
        [square] => {
            let value = parse_part(square)?;
            if value == 0 {
                Err("Resolution must be greater than zero".to_string())
            } else {
                Ok((value, value))
            }
        }
        [width, height] => {
            let width = parse_part(width)?;
            let height = parse_part(height)?;
            if width == 0 || height == 0 {
                Err("Resolution must be greater than zero".to_string())
            } else {
                Ok((width, height))
            }
        }
        _ => Err(format!(
            "Resolution must look like '1024', '1024x1024', or '768,1344', got '{trimmed}'"
        )),
    }
}

impl LlmSettings {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BaiduTranslateSettings {
    pub app_id: String,
    pub secret_key: String,
}

impl Default for BaiduTranslateSettings {
    fn default() -> Self {
        Self {
            app_id: String::new(),
            secret_key: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrainingSnapshot {
    pub epoch: u32,
    pub epoch_total: u32,
    pub step: u32,
    pub step_total: u32,
    pub loss: f64,
    pub lr: f64,
    pub runtime_seconds: u64,
    pub pid: Option<u32>,
    pub status: JobStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingLogLine {
    pub seq: i64,
    pub stream: String,
    pub level: String,
    pub channel: String,
    pub kind: Option<String>,
    pub stage: Option<String>,
    pub code: Option<String>,
    pub message: Option<String>,
    pub metrics: Option<Value>,
    pub raw_line: Option<String>,
    pub line: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LossPoint {
    pub step: u32,
    pub loss: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveJobSummary {
    pub job_id: String,
    pub project_id: String,
    pub project_name: String,
    pub checkpoint_name: String,
    pub status: JobStatus,
    pub pid: Option<u32>,
    pub runtime_seconds: u64,
    pub epoch: u32,
    pub epoch_total: u32,
    pub step: u32,
    pub step_total: u32,
    pub loss: f64,
    pub lr: f64,
    pub recent_logs: Vec<TrainingLogLine>,
    pub history: Vec<LossPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub cpu_percent: f32,
    pub memory_used_gb: f32,
    pub memory_total_gb: f32,
    pub gpu_name: String,
    pub gpu_temp_c: f32,
    pub gpu_util_percent: f32,
    pub vram_used_gb: f32,
    pub vram_total_gb: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInfo {
    pub gpu_name: String,
    pub vram_total_gb: f32,
    pub detected_at: i64,
    pub source: String,
}

impl Default for HardwareInfo {
    fn default() -> Self {
        Self {
            gpu_name: "LOCAL DEVICE".to_string(),
            vram_total_gb: 24.0,
            detected_at: 0,
            source: "default".to_string(),
        }
    }
}

impl Default for SystemStats {
    fn default() -> Self {
        Self {
            cpu_percent: 0.0,
            memory_used_gb: 0.0,
            memory_total_gb: 0.0,
            gpu_name: "LOCAL DEVICE".to_string(),
            gpu_temp_c: 0.0,
            gpu_util_percent: 0.0,
            vram_used_gb: 0.0,
            vram_total_gb: 24.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DatasetEntryKind {
    Directory,
    Image,
    File,
}

/// Logical role of a directory group in the dataset.
/// `Normal` = regular training images; `Reg` = regularization images (`is_reg = true` in sd-scripts).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum DatasetGroupType {
    #[default]
    Normal,
    Reg,
}

impl DatasetGroupType {
    pub fn from_str(s: &str) -> Self {
        match s {
            "reg" => Self::Reg,
            _ => Self::Normal,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetEntry {
    pub relative_path: String,
    pub name: String,
    pub kind: DatasetEntryKind,
    pub depth: u32,
    /// Present only for `Directory` kind entries.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_type: Option<DatasetGroupType>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetImagePathMapping {
    pub old_relative_path: String,
    pub new_relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchDatasetImageMutationResult {
    pub entries: Vec<DatasetEntry>,
    pub path_mappings: Vec<DatasetImagePathMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetAsset {
    pub relative_path: String,
    pub name: String,
    pub file_path: String,
    pub caption: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetPreviewAsset {
    pub relative_path: String,
    pub name: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleImageEntry {
    pub relative_path: String,
    pub name: String,
    pub file_path: String,
    pub depth: u32,
    pub modified_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingProgressEvent {
    pub project_id: String,
    pub job_id: String,
    pub snapshot: TrainingSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingLogEvent {
    pub project_id: String,
    pub job_id: String,
    pub entry: TrainingLogLine,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingStateChangedEvent {
    pub project_id: String,
    pub job_id: String,
    pub status: JobStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiLogEntry {
    pub created_at: i64,
    pub source: String,
    pub level: String,
    pub message: String,
}
