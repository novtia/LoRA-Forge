/**
 * @file domain/training.rs
 * @description 训练领域类型：`JobStatus`、`TrainingConfig`（含 validate / summary_tags）、
 *   `TrainingEnvSettings`、`DiffusionPipeConfig`、`TrainingSnapshot`/`TrainingLogLine`/事件 payload 等。
 */
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::domain::project::ProjectStatus;

// ---------------------------------------------------------------------------
// JobStatus
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// serde defaults (training)
// ---------------------------------------------------------------------------

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

fn default_training_length_mode() -> String {
    "steps".to_string()
}

fn default_max_train_steps_config() -> u32 {
    6000
}

fn default_sd_scripts_path() -> String {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("sd-scripts")
        .to_string_lossy()
        .to_string()
}

// ---------------------------------------------------------------------------
// TrainingConfig
// ---------------------------------------------------------------------------

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
    // Extended sd-scripts training surface. These deliberately exclude
    // launcher/DDP internals and repository/environment settings.
    pub v2: bool,
    pub v_parameterization: bool,
    pub tokenizer_cache_dir: String,
    pub network_module: String,
    pub network_args: String,
    pub network_train_unet_only: bool,
    pub network_train_text_encoder_only: bool,
    pub dim_from_weights: bool,
    pub scale_weight_norms: String,
    pub base_weights: String,
    pub base_weights_multiplier: String,
    pub training_comment: String,
    pub no_metadata: bool,
    pub save_model_as: String,
    pub gradient_accumulation_steps: u32,
    pub full_fp16: bool,
    pub full_bf16: bool,
    pub fp8_base: bool,
    pub fp8_base_unet: bool,
    pub mem_eff_attn: bool,
    pub sdpa: bool,
    pub torch_compile: bool,
    pub dynamo_backend: String,
    pub lowram: bool,
    pub highvram: bool,
    pub no_half_vae: bool,
    pub cpu_offload_checkpointing: bool,
    pub cache_text_encoder_outputs: bool,
    pub cache_text_encoder_outputs_to_disk: bool,
    pub text_encoder_batch_size: u32,
    pub disable_mmap_load_safetensors: bool,
    pub blocks_to_swap: u32,
    pub fused_backward_pass: bool,
    pub lr_scheduler_type: String,
    pub lr_scheduler_args: String,
    pub lr_decay_steps: String,
    pub lr_scheduler_timescale: String,
    pub lr_scheduler_min_lr_ratio: String,
    pub save_n_epoch_ratio: u32,
    pub save_last_n_epochs_state: u32,
    pub save_last_n_steps_state: u32,
    pub save_state: bool,
    pub save_state_on_train_end: bool,
    pub skip_until_initial_step: bool,
    pub max_token_length: u32,
    pub noise_offset_random_strength: bool,
    pub multires_noise_iterations: u32,
    pub multires_noise_discount: String,
    pub ip_noise_gamma: String,
    pub ip_noise_gamma_random_strength: bool,
    pub adaptive_noise_scale: String,
    pub zero_terminal_snr: bool,
    pub min_timestep: u32,
    pub max_timestep: u32,
    pub loss_type: String,
    pub huber_schedule: String,
    pub huber_c: String,
    pub huber_scale: String,
    pub prior_loss_weight: String,
    pub masked_loss: bool,
    pub conditioning_data_dir: String,
    pub caption_separator: String,
    pub keep_tokens_separator: String,
    pub secondary_separator: String,
    pub enable_wildcard: bool,
    pub caption_prefix: String,
    pub caption_suffix: String,
    pub flip_aug: bool,
    pub face_crop_aug_range: String,
    pub random_crop: bool,
    pub vae_batch_size: u32,
    pub skip_cache_check: bool,
    pub skip_image_resolution: String,
    pub bucket_no_upscale: bool,
    pub resize_interpolation: String,
    pub token_warmup_min: u32,
    pub token_warmup_step: String,
    pub alpha_mask: bool,
    pub train_inpainting: bool,
    pub caption_dropout_every_n_epochs: u32,
    pub weighting_scheme: String,
    pub logit_mean: String,
    pub logit_std: String,
    pub mode_scale: String,
    pub validation_seed: u32,
    pub validation_split: String,
    pub validate_every_n_steps: u32,
    pub validate_every_n_epochs: u32,
    pub max_validation_steps: u32,
    pub log_with: String,
    pub logging_dir: String,
    pub log_prefix: String,
    pub log_tracker_name: String,
    pub wandb_run_name: String,
    pub wandb_api_key: String,
    pub log_config: bool,
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
            v2: false,
            v_parameterization: false,
            tokenizer_cache_dir: String::new(),
            network_module: String::new(),
            network_args: String::new(),
            network_train_unet_only: false,
            network_train_text_encoder_only: false,
            dim_from_weights: false,
            scale_weight_norms: String::new(),
            base_weights: String::new(),
            base_weights_multiplier: String::new(),
            training_comment: String::new(),
            no_metadata: false,
            save_model_as: "safetensors".to_string(),
            gradient_accumulation_steps: 1,
            full_fp16: false,
            full_bf16: false,
            fp8_base: false,
            fp8_base_unet: false,
            mem_eff_attn: false,
            sdpa: false,
            torch_compile: false,
            dynamo_backend: "inductor".to_string(),
            lowram: false,
            highvram: false,
            no_half_vae: false,
            cpu_offload_checkpointing: false,
            cache_text_encoder_outputs: false,
            cache_text_encoder_outputs_to_disk: false,
            text_encoder_batch_size: 0,
            disable_mmap_load_safetensors: false,
            blocks_to_swap: 0,
            fused_backward_pass: false,
            lr_scheduler_type: String::new(),
            lr_scheduler_args: String::new(),
            lr_decay_steps: String::new(),
            lr_scheduler_timescale: String::new(),
            lr_scheduler_min_lr_ratio: String::new(),
            save_n_epoch_ratio: 0,
            save_last_n_epochs_state: 0,
            save_last_n_steps_state: 0,
            save_state: false,
            save_state_on_train_end: false,
            skip_until_initial_step: false,
            max_token_length: 0,
            noise_offset_random_strength: false,
            multires_noise_iterations: 0,
            multires_noise_discount: "0.3".to_string(),
            ip_noise_gamma: String::new(),
            ip_noise_gamma_random_strength: false,
            adaptive_noise_scale: String::new(),
            zero_terminal_snr: false,
            min_timestep: 0,
            max_timestep: 0,
            loss_type: "l2".to_string(),
            huber_schedule: "snr".to_string(),
            huber_c: "0.1".to_string(),
            huber_scale: "1.0".to_string(),
            prior_loss_weight: "1.0".to_string(),
            masked_loss: false,
            conditioning_data_dir: String::new(),
            caption_separator: ",".to_string(),
            keep_tokens_separator: String::new(),
            secondary_separator: String::new(),
            enable_wildcard: false,
            caption_prefix: String::new(),
            caption_suffix: String::new(),
            flip_aug: false,
            face_crop_aug_range: String::new(),
            random_crop: false,
            vae_batch_size: 1,
            skip_cache_check: false,
            skip_image_resolution: String::new(),
            bucket_no_upscale: false,
            resize_interpolation: String::new(),
            token_warmup_min: 1,
            token_warmup_step: "0".to_string(),
            alpha_mask: false,
            train_inpainting: false,
            caption_dropout_every_n_epochs: 0,
            weighting_scheme: "uniform".to_string(),
            logit_mean: "0".to_string(),
            logit_std: "1".to_string(),
            mode_scale: "1.29".to_string(),
            validation_seed: 0,
            validation_split: "0".to_string(),
            validate_every_n_steps: 0,
            validate_every_n_epochs: 0,
            max_validation_steps: 0,
            log_with: String::new(),
            logging_dir: String::new(),
            log_prefix: String::new(),
            log_tracker_name: String::new(),
            wandb_run_name: String::new(),
            wandb_api_key: String::new(),
            log_config: false,
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
                return Err(
                    "Anima training requires the Qwen3 text encoder path (--qwen3)".to_string(),
                );
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
            return Err(
                "Epochs must be greater than zero when using epoch-based training length"
                    .to_string(),
            );
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
            let min_bucket_step =
                if script == "sdxl_train_network.py" || script == "anima_train_network.py" {
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
            return Err(
                "Sample prompt text is required when sample image generation is enabled"
                    .to_string(),
            );
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
                return Err(
                    "Sample CFG scale is required when sample image generation is enabled"
                        .to_string(),
                );
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

// ---------------------------------------------------------------------------
// TrainingEnvSettings
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// DiffusionPipeConfig
// ---------------------------------------------------------------------------

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
    pub image_micro_batch_size_per_gpu: u32,
    pub force_constant_lr: String,
    pub lr_scheduler: String,
    pub pseudo_huber_c: String,
    pub eval_every_n_steps: u32,
    pub eval_every_n_examples: u32,
    pub eval_before_first_step: bool,
    pub eval_micro_batch_size_per_gpu: u32,
    pub image_eval_micro_batch_size_per_gpu: u32,
    pub eval_gradient_accumulation_steps: u32,
    pub disable_block_swap_for_eval: bool,
    pub save_every_n_examples: u32,
    pub checkpoint_every_n_epochs: u32,
    pub reentrant_activation_checkpointing: bool,
    pub compile: bool,
    pub video_clip_mode: String,
    pub x_axis_examples: bool,
    pub uncond_fraction: String,
    pub logging_steps: u32,
    pub adapter_init_from_existing: String,
    pub adapter_dropout: String,
    pub lokr_decompose_factor: u32,
    pub lokr_rank_dropout: String,
    pub optimizer_betas: String,
    pub optimizer_eps: String,
    pub optimizer_stabilize: bool,
    pub optimizer_gradient_release: bool,
    pub optimizer_args: String,
    pub enable_wandb: bool,
    pub wandb_api_key: String,
    pub wandb_tracker_name: String,
    pub wandb_run_name: String,
    pub min_ar: String,
    pub max_ar: String,
    pub ar_buckets: String,
    pub cache_shuffle_num: u32,
    pub cache_shuffle_delimiter: String,
    pub skip_empty_caption: bool,
    pub mask_path: String,
    pub model_guidance: String,
    pub sigmoid_scale: String,
    pub diffusion_model_dtype: String,
    pub regenerate_cache: bool,
    pub trust_cache: bool,
    pub reset_dataloader: bool,
    pub reset_optimizer: bool,
    pub reset_optimizer_params: bool,
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
            image_micro_batch_size_per_gpu: 0,
            force_constant_lr: String::new(),
            lr_scheduler: "constant".to_string(),
            pseudo_huber_c: String::new(),
            eval_every_n_steps: 0,
            eval_every_n_examples: 0,
            eval_before_first_step: true,
            eval_micro_batch_size_per_gpu: 1,
            image_eval_micro_batch_size_per_gpu: 0,
            eval_gradient_accumulation_steps: 1,
            disable_block_swap_for_eval: false,
            save_every_n_examples: 0,
            checkpoint_every_n_epochs: 0,
            reentrant_activation_checkpointing: false,
            compile: false,
            video_clip_mode: "single_beginning".to_string(),
            x_axis_examples: false,
            uncond_fraction: "0".to_string(),
            logging_steps: 1,
            adapter_init_from_existing: String::new(),
            adapter_dropout: "0".to_string(),
            lokr_decompose_factor: 4,
            lokr_rank_dropout: "0".to_string(),
            optimizer_betas: "0.9,0.99".to_string(),
            optimizer_eps: "1e-8".to_string(),
            optimizer_stabilize: false,
            optimizer_gradient_release: false,
            optimizer_args: String::new(),
            enable_wandb: false,
            wandb_api_key: String::new(),
            wandb_tracker_name: String::new(),
            wandb_run_name: String::new(),
            min_ar: "0.5".to_string(),
            max_ar: "2.0".to_string(),
            ar_buckets: String::new(),
            cache_shuffle_num: 0,
            cache_shuffle_delimiter: ", ".to_string(),
            skip_empty_caption: true,
            mask_path: String::new(),
            model_guidance: "1.0".to_string(),
            sigmoid_scale: "1.0".to_string(),
            diffusion_model_dtype: String::new(),
            regenerate_cache: false,
            trust_cache: false,
            reset_dataloader: false,
            reset_optimizer: false,
            reset_optimizer_params: false,
        }
    }
}

// ---------------------------------------------------------------------------
// Snapshot / log / events
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Training repository management
// ---------------------------------------------------------------------------

/// One row in the repo manager UI — merges the curated catalog with custom
/// user-added repos, enriched with on-disk git status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingRepoStatus {
    pub id: String,
    pub name: String,
    pub description: String,
    /// Where the repo lives: `"windows"` (native git) or `"wsl"` (`wsl bash -c git …`).
    pub target: String,
    pub git_url: String,
    /// Display path: a Windows path for `windows`, or a WSL path for `wsl`.
    pub install_path: String,
    pub installed: bool,
    pub current_branch: Option<String>,
    pub current_commit: Option<String>,
    pub is_custom: bool,
}

/// Payload for adding a user-defined repository.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomRepoInput {
    pub name: String,
    pub git_url: String,
    pub target: String,
    pub install_path: String,
}

/// Persisted custom-repo definition (stored as JSON in the `training_repos` table).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomRepoRecord {
    pub id: String,
    pub name: String,
    pub git_url: String,
    pub target: String,
    pub install_path: String,
    pub created_at: i64,
}

/// Streamed line from an in-flight clone/pull task.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoTaskLogEvent {
    pub repo_id: String,
    pub task_id: String,
    pub line: String,
    pub level: String,
}

/// Lifecycle transition for a repo task.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoTaskStateEvent {
    pub repo_id: String,
    pub task_id: String,
    /// `"download"` | `"update"` | `"delete"`.
    pub kind: String,
    /// `"running"` | `"completed"` | `"failed"`.
    pub status: String,
    pub message: Option<String>,
}
