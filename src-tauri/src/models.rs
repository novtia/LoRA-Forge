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
    pub steps_per_epoch: u32,
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
            steps_per_epoch: 300,
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
        if self.epochs == 0 {
            return Err("Epochs must be greater than zero".to_string());
        }
        if self.save_every_n_epochs == 0 {
            return Err("Save frequency must be greater than zero".to_string());
        }
        if self.steps_per_epoch == 0 {
            return Err("Steps per epoch must be greater than zero".to_string());
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
        let max_train_steps = self.epochs.saturating_mul(self.steps_per_epoch);
        if self.initial_step > 0 && self.initial_step >= max_train_steps {
            return Err("Initial step must be smaller than the total train steps".to_string());
        }
        if self.initial_epoch > self.epochs {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetEntry {
    pub relative_path: String,
    pub name: String,
    pub kind: DatasetEntryKind,
    pub depth: u32,
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
