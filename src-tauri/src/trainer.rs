use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, Instant},
};

use rusqlite::OptionalExtension;
use serde::Deserialize;
use serde_json::{Map, Value};
use sysinfo::System;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, BufReader};

use crate::{
    db,
    error::{AppError, AppResult},
    hardware,
    models::{
        ActiveJobSummary, HardwareInfo, JobStatus, ProjectRecord, ProjectStatus, SystemStats,
        TrainingConfig, TrainingEnvSettings, TrainingLogEvent, TrainingProgressEvent,
        TrainingSnapshot, TrainingStateChangedEvent,
    },
    state::{AppState, RuntimeJob, RuntimeJobControlMode},
    utils::now_ts,
};

pub const TRAINING_PROGRESS_EVENT: &str = "training-progress";
pub const TRAINING_LOG_EVENT: &str = "training-log-line";
pub const TRAINING_STATE_EVENT: &str = "training-state-changed";
pub const SYSTEM_STATS_EVENT: &str = "system-stats-updated";
const STRUCTURED_LOG_PREFIX: &str = "@@LORA_FORGE_LOG@@";
const STRUCTURED_LOG_SCHEMA: &str = "lora-forge.training.log/v1";
const ABORT_GRACE_PERIOD: Duration = Duration::from_secs(3);
const ABORT_POLL_INTERVAL: Duration = Duration::from_millis(200);

fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(program);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    cmd
}

fn training_subprocess_command(program: impl AsRef<std::ffi::OsStr>) -> tokio::process::Command {
    tokio::process::Command::new(program)
}

#[derive(Default)]
struct ParsedProgress {
    epoch: Option<u32>,
    epoch_total: Option<u32>,
    step: Option<u32>,
    step_total: Option<u32>,
    loss: Option<f64>,
    lr: Option<f64>,
    runtime_seconds: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct StructuredLogRecord {
    schema: Option<String>,
    kind: String,
    stage: String,
    code: String,
    level: String,
    message: String,
    #[serde(default)]
    metrics: Map<String, Value>,
}

pub fn start_system_stats_publisher(app: AppHandle, state: AppState) {
    tauri::async_runtime::spawn(async move {
        loop {
            let stats = collect_system_stats(&state);
            let _ = app.emit(SYSTEM_STATS_EVENT, stats);
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
    });
}

pub fn collect_system_stats(state: &AppState) -> SystemStats {
    let mut system = System::new_all();
    system.refresh_memory();
    system.refresh_cpu_usage();
    let hardware = state.hardware_info().unwrap_or_default();
    let realtime_gpu = hardware::query_gpu_runtime_metrics();

    let total_memory = bytes_to_gb(system.total_memory());
    let used_memory = bytes_to_gb(system.used_memory());
    let cpu_usage = system.global_cpu_usage();
    let gpu_name = realtime_gpu
        .as_ref()
        .map(|metrics| metrics.gpu_name.clone())
        .unwrap_or_else(|| hardware.gpu_name.clone());
    let vram_total_gb = realtime_gpu
        .as_ref()
        .map(|metrics| metrics.vram_total_gb.max(1.0))
        .unwrap_or_else(|| hardware.vram_total_gb.max(1.0));
    let gpu_temp_c = realtime_gpu
        .as_ref()
        .map(|metrics| metrics.gpu_temp_c)
        .unwrap_or(63.0);
    let gpu_util_percent = realtime_gpu
        .as_ref()
        .map(|metrics| metrics.gpu_util_percent)
        .unwrap_or_else(|| (cpu_usage * 1.4).clamp(12.0, 98.0));
    let vram_used_gb = realtime_gpu
        .as_ref()
        .map(|metrics| metrics.vram_used_gb)
        .unwrap_or_else(|| {
            estimate_vram_usage(vram_total_gb, used_memory, total_memory, &hardware)
        });

    SystemStats {
        cpu_percent: cpu_usage,
        memory_used_gb: used_memory,
        memory_total_gb: total_memory,
        gpu_name,
        gpu_temp_c,
        gpu_util_percent,
        vram_used_gb,
        vram_total_gb,
    }
}

pub async fn start_training(
    app: AppHandle,
    state: AppState,
    project: ProjectRecord,
    config: TrainingConfig,
) -> AppResult<ActiveJobSummary> {
    if state.runtime_job(&project.id)?.is_some() {
        return Err(AppError::Validation(format!(
            "Project '{}' already has a running trainer",
            project.name
        )));
    }

    let env_settings = state.with_db(db::load_training_env)?;

    let job_id = format!("{}-{}", project.id, now_ts());
    let control_file = state.paths().jobs_dir.join(format!("{job_id}.control"));
    fs::write(&control_file, "running")?;

    let (mut command, control_mode) =
        build_training_command(&state, &project, &config, &env_settings, &job_id)?;
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    let mut child = command.spawn()?;
    let pid = child.id();
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Process("Trainer stdout pipe was unavailable".to_string()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Process("Trainer stderr pipe was unavailable".to_string()))?;

    state.with_db(|connection| {
        db::create_job(connection, &job_id, &project.id, pid, JobStatus::Running)?;
        db::update_project_status(connection, &project.id, ProjectStatus::Running)?;
        let initial_snapshot = TrainingSnapshot {
            epoch: 1,
            epoch_total: config.epochs,
            step: 0,
            step_total: config.epochs.saturating_mul(config.steps_per_epoch),
            loss: 0.185,
            lr: parse_lr(&config.base_lr),
            runtime_seconds: 0,
            pid,
            status: JobStatus::Running,
        };
        db::append_snapshot(connection, &job_id, &initial_snapshot)?;
        db::append_log(
            connection,
            &job_id,
            "stdout",
            "info",
            "Bootstrapping trainer process...",
            now_ts(),
            Some("lifecycle"),
            Some("bootstrap"),
            Some("TRAINER_BOOTSTRAP"),
            Some("Bootstrapping trainer process..."),
            None,
            None,
        )?;
        Ok(())
    })?;

    let runtime_job = RuntimeJob {
        job_id: job_id.clone(),
        project_id: project.id.clone(),
        pid,
        control_file: control_file.clone(),
        control_mode,
        child: std::sync::Arc::new(tokio::sync::Mutex::new(child)),
    };
    state.insert_runtime_job(runtime_job.clone())?;

    emit_state_change(&app, &project.id, &job_id, JobStatus::Running);

    let stdout_state = state.clone();
    let stdout_app = app.clone();
    let stdout_job_id = job_id.clone();
    let stdout_project_id = project.id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = stream_logs(
            stdout_app,
            stdout_state,
            stdout_project_id,
            stdout_job_id,
            "stdout",
            stdout,
        )
        .await
        {
            eprintln!("stdout stream failed: {error}");
        }
    });

    let stderr_state = state.clone();
    let stderr_app = app.clone();
    let stderr_job_id = job_id.clone();
    let stderr_project_id = project.id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = stream_logs(
            stderr_app,
            stderr_state,
            stderr_project_id,
            stderr_job_id,
            "stderr",
            stderr,
        )
        .await
        {
            eprintln!("stderr stream failed: {error}");
        }
    });

    let wait_state = state.clone();
    let wait_app = app.clone();
    let wait_project_id = project.id.clone();
    let wait_job_id = job_id.clone();
    tauri::async_runtime::spawn(async move {
        let final_status = match wait_for_child(runtime_job).await {
            Ok((child_pid, success)) => {
                let status =
                    final_status_after_exit(&wait_state, &wait_job_id, &control_file, success);
                finalize_job(
                    &wait_state,
                    &wait_project_id,
                    &wait_job_id,
                    status,
                    child_pid,
                )
            }
            Err(error) => {
                eprintln!("trainer wait failed: {error}");
                finalize_job(
                    &wait_state,
                    &wait_project_id,
                    &wait_job_id,
                    JobStatus::Failed,
                    None,
                )
            }
        };

        wait_state.remove_runtime_job(&wait_project_id).ok();
        emit_state_change(&wait_app, &wait_project_id, &wait_job_id, final_status);
    });

    state
        .with_db(|connection| db::get_active_job(connection, Some(&project.id)))?
        .ok_or_else(|| AppError::Process("Failed to load started job summary".to_string()))
}

fn build_training_command(
    state: &AppState,
    project: &ProjectRecord,
    config: &TrainingConfig,
    env_settings: &TrainingEnvSettings,
    job_id: &str,
) -> AppResult<(tokio::process::Command, RuntimeJobControlMode)> {
    let sd_scripts_path = resolve_sd_scripts_path(env_settings)?;
    let train_script_path = resolve_training_script_path(config, &sd_scripts_path)?;

    let python_executable = resolve_python_executable(env_settings, &sd_scripts_path);
    if looks_like_path(&python_executable) && !Path::new(&python_executable).exists() {
        return Err(AppError::Validation(format!(
            "Python executable was not found: '{}'",
            python_executable
        )));
    }
    if looks_like_path(&config.network_weights) && !config.network_weights.trim().is_empty() {
        let network_weights = Path::new(config.network_weights.trim());
        if !network_weights.exists() {
            return Err(AppError::Validation(format!(
                "Network weights were not found: '{}'",
                config.network_weights.trim()
            )));
        }
    }
    if looks_like_path(&config.resume) && !config.resume.trim().is_empty() {
        let resume_path = Path::new(config.resume.trim());
        if !resume_path.exists() {
            return Err(AppError::Validation(format!(
                "Resume state was not found: '{}'",
                config.resume.trim()
            )));
        }
    }
    let dataset_config_path = state
        .paths()
        .jobs_dir
        .join(format!("{job_id}.dataset.toml"));
    write_dataset_config(project, config, &dataset_config_path)?;
    let sample_output_dir = PathBuf::from(&project.root_path).join("sample");
    fs::create_dir_all(&sample_output_dir)?;
    let sample_prompts_path = if sample_generation_enabled(config) {
        let destination = state
            .paths()
            .jobs_dir
            .join(format!("{job_id}.sample-prompts.json"));
        write_sample_prompts_file(config, &destination)?;
        Some(destination)
    } else {
        None
    };

    let max_train_steps = config.epochs.saturating_mul(config.steps_per_epoch).max(1);
    let resolution = parse_resolution(&config.resolution)?;
    let is_anima = config.training_script.trim() == "anima_train_network.py";
    let network_module = if is_anima {
        "networks.lora_anima"
    } else {
        "networks.lora"
    };

    if is_anima {
        let qwen3 = config.anima_qwen3.trim();
        if looks_like_path(qwen3) && !Path::new(qwen3).exists() {
            return Err(AppError::Validation(format!(
                "Qwen3 path was not found: '{qwen3}'"
            )));
        }
    }

    let mut command = training_subprocess_command(&python_executable);
    command
        .arg("-u")
        .arg(&train_script_path)
        .arg("--dataset_config")
        .arg(&dataset_config_path)
        .arg("--pretrained_model_name_or_path")
        .arg(config.pretrained_model.trim())
        .arg("--output_dir")
        .arg(&project.output_path)
        .arg("--output_name")
        .arg(&project.id)
        .arg("--resolution")
        .arg(resolution)
        .arg("--save_model_as")
        .arg("safetensors")
        .arg("--network_module")
        .arg(network_module)
        .arg("--network_dim")
        .arg(config.network_dim.to_string())
        .arg("--network_alpha")
        .arg(config.network_alpha.to_string())
        .arg("--train_batch_size")
        .arg(config.batch_size.to_string())
        .arg("--max_train_steps")
        .arg(max_train_steps.to_string())
        .arg("--save_every_n_epochs")
        .arg(config.save_every_n_epochs.to_string())
        .arg("--learning_rate")
        .arg(require_numeric_arg("Base LR", &config.base_lr)?)
        .arg("--optimizer_type")
        .arg(config.optimizer.trim())
        .arg("--lr_scheduler")
        .arg(config.lr_scheduler.trim())
        .arg("--lr_warmup_steps")
        .arg(config.lr_warmup_steps.to_string())
        .arg("--mixed_precision")
        .arg(config.mixed_precision.trim())
        .arg("--max_data_loader_n_workers")
        .arg(config.max_data_loader_workers.to_string())
        .arg("--caption_extension")
        .arg(".txt")
        .arg("--console_log_simple")
        .current_dir(&sd_scripts_path)
        .env(
            "LORA_FORGE_SAMPLE_DIR",
            sample_output_dir.to_string_lossy().to_string(),
        )
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONIOENCODING", "utf-8");

    if !config.vae.trim().is_empty() {
        command.arg("--vae").arg(config.vae.trim());
    }
    if is_anima {
        command.arg("--qwen3").arg(config.anima_qwen3.trim());
        let llm_lr = config.anima_llm_adapter_lr.trim();
        if !llm_lr.is_empty() {
            append_optional_numeric_arg(
                &mut command,
                "--llm_adapter_lr",
                "LLM adapter LR",
                llm_lr,
            )?;
        }
    }
    if !config.unet_lr.trim().is_empty() {
        command
            .arg("--unet_lr")
            .arg(require_numeric_arg("UNet LR", &config.unet_lr)?);
    }
    if !config.text_encoder_lr.trim().is_empty() {
        command.arg("--text_encoder_lr").arg(require_numeric_arg(
            "Text Encoder LR",
            &config.text_encoder_lr,
        )?);
    }
    if !is_anima && config.clip_skip > 0 {
        command.arg("--clip_skip").arg(config.clip_skip.to_string());
    }
    if !config.optimizer_args.trim().is_empty() {
        append_multi_value_arg(
            &mut command,
            "--optimizer_args",
            split_argument_list(&config.optimizer_args),
        );
    }
    if config.seed > 0 {
        command.arg("--seed").arg(config.seed.to_string());
    }
    if !config.save_precision.trim().is_empty() {
        command
            .arg("--save_precision")
            .arg(config.save_precision.trim());
    }
    if config.cache_latents {
        command.arg("--cache_latents");
    }
    if config.cache_latents_to_disk {
        command.arg("--cache_latents_to_disk");
    }
    if config.persistent_data_loader_workers {
        command.arg("--persistent_data_loader_workers");
    }
    if config.gradient_checkpointing {
        command.arg("--gradient_checkpointing");
    }
    if config.xformers {
        command.arg("--xformers");
    }
    if config.shuffle_captions {
        command.arg("--shuffle_caption");
    }
    if config.color_jitter {
        command.arg("--color_aug");
    }
    if config.keep_tokens > 0 {
        command
            .arg("--keep_tokens")
            .arg(config.keep_tokens.to_string());
    }
    if config.conv_dim > 0 {
        append_multi_value_arg(
            &mut command,
            "--network_args",
            vec![
                format!("conv_dim={}", config.conv_dim),
                format!("conv_alpha={}", config.conv_alpha),
            ],
        );
    }
    if config.save_every_n_steps > 0 {
        command
            .arg("--save_every_n_steps")
            .arg(config.save_every_n_steps.to_string());
    }
    if config.save_last_n_epochs > 0 {
        command
            .arg("--save_last_n_epochs")
            .arg(config.save_last_n_epochs.to_string());
    }
    if config.save_last_n_steps > 0 {
        command
            .arg("--save_last_n_steps")
            .arg(config.save_last_n_steps.to_string());
    }
    if config.sample_every_n_steps > 0 {
        command
            .arg("--sample_every_n_steps")
            .arg(config.sample_every_n_steps.to_string());
    }
    if config.sample_at_first {
        command.arg("--sample_at_first");
    }
    if config.sample_every_n_epochs > 0 {
        command
            .arg("--sample_every_n_epochs")
            .arg(config.sample_every_n_epochs.to_string());
    }
    if let Some(sample_prompts_path) = &sample_prompts_path {
        command
            .arg("--sample_prompts")
            .arg(sample_prompts_path);
    }
    if sample_generation_enabled(config) && !config.sample_sampler.trim().is_empty() {
        command
            .arg("--sample_sampler")
            .arg(config.sample_sampler.trim());
    }
    if !config.network_weights.trim().is_empty() {
        command
            .arg("--network_weights")
            .arg(config.network_weights.trim());
    }
    if !config.resume.trim().is_empty() {
        command.arg("--resume").arg(config.resume.trim());
    }
    if config.initial_epoch > 0 {
        command
            .arg("--initial_epoch")
            .arg(config.initial_epoch.to_string());
    }
    if config.initial_step > 0 {
        command
            .arg("--initial_step")
            .arg(config.initial_step.to_string());
    }
    append_optional_numeric_arg(
        &mut command,
        "--noise_offset",
        "Noise Offset",
        &config.noise_offset,
    )?;
    append_optional_numeric_arg(
        &mut command,
        "--network_dropout",
        "Network Dropout",
        &config.network_dropout,
    )?;
    append_optional_numeric_arg(
        &mut command,
        "--caption_dropout_rate",
        "Caption Dropout Rate",
        &config.caption_dropout_rate,
    )?;
    append_optional_numeric_arg(
        &mut command,
        "--caption_tag_dropout_rate",
        "Caption Tag Dropout Rate",
        &config.caption_tag_dropout_rate,
    )?;
    append_optional_numeric_arg(
        &mut command,
        "--max_grad_norm",
        "Max Grad Norm",
        &config.max_grad_norm,
    )?;
    append_optional_numeric_arg(
        &mut command,
        "--min_snr_gamma",
        "Min SNR Gamma",
        &config.min_snr_gamma,
    )?;
    append_optional_numeric_arg(
        &mut command,
        "--lr_scheduler_num_cycles",
        "LR Scheduler Num Cycles",
        &config.lr_scheduler_num_cycles,
    )?;
    append_optional_numeric_arg(
        &mut command,
        "--lr_scheduler_power",
        "LR Scheduler Power",
        &config.lr_scheduler_power,
    )?;

    Ok((command, RuntimeJobControlMode::ProcessSignals))
}

fn resolve_sd_scripts_path(env_settings: &TrainingEnvSettings) -> AppResult<PathBuf> {
    let configured = env_settings.sd_scripts_path.trim();
    let candidate = if configured.is_empty() {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("sd-scripts")
    } else {
        PathBuf::from(configured)
    };

    let resolved = if candidate.is_absolute() {
        candidate
    } else {
        std::env::current_dir()?.join(candidate)
    };

    if resolved.is_dir() {
        Ok(resolved)
    } else {
        Err(AppError::Validation(format!(
            "sd-scripts directory was not found: '{}'",
            resolved.display()
        )))
    }
}

fn resolve_training_script_path(
    config: &TrainingConfig,
    sd_scripts_path: &Path,
) -> AppResult<PathBuf> {
    let script_name = match config.training_script.trim() {
        "" => "train_network.py",
        "train_network.py" | "sdxl_train_network.py" | "anima_train_network.py" => {
            config.training_script.trim()
        }
        other => {
            return Err(AppError::Validation(format!(
                "Unsupported training script: '{other}'"
            )))
        }
    };
    let train_script_path = sd_scripts_path.join(script_name);
    if !train_script_path.exists() {
        return Err(AppError::Validation(format!(
            "Could not find {script_name} in '{}'",
            sd_scripts_path.display()
        )));
    }
    Ok(train_script_path)
}

fn resolve_python_executable(env_settings: &TrainingEnvSettings, sd_scripts_path: &Path) -> String {
    let configured = env_settings.python_executable.trim();
    if !configured.is_empty() {
        return configured.to_string();
    }

    let windows_venv = sd_scripts_path
        .join(".venv")
        .join("Scripts")
        .join("python.exe");
    if windows_venv.is_file() {
        return windows_venv.to_string_lossy().to_string();
    }

    let unix_venv = sd_scripts_path.join(".venv").join("bin").join("python");
    if unix_venv.is_file() {
        return unix_venv.to_string_lossy().to_string();
    }

    "python".to_string()
}

fn looks_like_path(value: &str) -> bool {
    value.contains('\\') || value.contains('/') || value.contains(':') || value.starts_with('.')
}

fn write_dataset_config(
    project: &ProjectRecord,
    config: &TrainingConfig,
    destination: &Path,
) -> AppResult<()> {
    let dataset_root = PathBuf::from(&project.dataset_path);
    let image_dirs = collect_dataset_image_dirs(&dataset_root)?;
    if image_dirs.is_empty() {
        return Err(AppError::Validation(format!(
            "Dataset is empty for project '{}'. Add images before starting training.",
            project.name
        )));
    }

    let mut config_toml = String::from("[[datasets]]\n");
    if config.enable_bucket {
        config_toml.push_str("enable_bucket = true\n");
        config_toml.push_str(&format!("min_bucket_reso = {}\n", config.min_bucket_reso));
        config_toml.push_str(&format!("max_bucket_reso = {}\n", config.max_bucket_reso));
        config_toml.push_str(&format!(
            "bucket_reso_steps = {}\n",
            config.bucket_reso_steps
        ));
    }
    for image_dir in image_dirs {
        config_toml.push_str("\n  [[datasets.subsets]]\n");
        config_toml.push_str(&format!(
            "  image_dir = {}\n",
            toml_string(&image_dir.to_string_lossy())
        ));
        config_toml.push_str(&format!("  num_repeats = {}\n", config.dataset_repeats));
        config_toml.push_str("  caption_extension = \".txt\"\n");
    }

    fs::write(destination, config_toml)?;
    Ok(())
}

fn collect_dataset_image_dirs(root: &Path) -> AppResult<Vec<PathBuf>> {
    let mut directories = Vec::new();
    visit_dataset_dirs(root, &mut directories)?;
    directories.sort();
    directories.dedup();
    Ok(directories)
}

fn visit_dataset_dirs(current: &Path, directories: &mut Vec<PathBuf>) -> AppResult<bool> {
    if !current.exists() {
        return Ok(false);
    }

    let mut has_direct_images = false;
    let mut has_nested_images = false;
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            if visit_dataset_dirs(&path, directories)? {
                has_nested_images = true;
            }
        } else if is_image_file(&path) {
            has_direct_images = true;
        }
    }

    if has_direct_images {
        directories.push(current.to_path_buf());
    }

    Ok(has_direct_images || has_nested_images)
}

fn is_image_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "bmp"
            )
        })
        .unwrap_or(false)
}

fn toml_string(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
            .replace('\t', "\\t")
    )
}

fn parse_resolution(value: &str) -> AppResult<String> {
    let (width, height) = parse_resolution_dimensions(value)?;
    Ok(format!("{width},{height}"))
}

fn require_numeric_arg(label: &str, value: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{label} is required")));
    }
    trimmed.parse::<f64>().map_err(|_| {
        AppError::Validation(format!("{label} must be a valid number, got '{trimmed}'"))
    })?;
    Ok(trimmed.to_string())
}

fn append_optional_numeric_arg(
    command: &mut tokio::process::Command,
    flag: &str,
    label: &str,
    value: &str,
) -> AppResult<()> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    trimmed.parse::<f64>().map_err(|_| {
        AppError::Validation(format!("{label} must be a valid number, got '{trimmed}'"))
    })?;
    command.arg(flag).arg(trimmed);
    Ok(())
}

fn append_multi_value_arg(command: &mut tokio::process::Command, flag: &str, values: Vec<String>) {
    if values.is_empty() {
        return;
    }
    command.arg(flag);
    for value in values {
        command.arg(value);
    }
}

fn split_argument_list(value: &str) -> Vec<String> {
    value
        .split_whitespace()
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn sample_generation_enabled(config: &TrainingConfig) -> bool {
    config.sample_at_first || config.sample_every_n_steps > 0 || config.sample_every_n_epochs > 0
}

fn write_sample_prompts_file(config: &TrainingConfig, destination: &Path) -> AppResult<()> {
    let prompts = config
        .sample_prompts
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|prompt| {
            let mut entry = serde_json::Map::new();
            entry.insert("prompt".to_string(), Value::String(prompt.to_string()));
            entry.insert("width".to_string(), Value::from(config.sample_width));
            entry.insert("height".to_string(), Value::from(config.sample_height));
            entry.insert("sample_steps".to_string(), Value::from(config.sample_steps));

            let cfg_scale = config.sample_cfg_scale.trim().parse::<f64>().map_err(|_| {
                AppError::Validation(format!(
                    "Sample CFG scale must be a valid number, got '{}'",
                    config.sample_cfg_scale.trim()
                ))
            })?;
            entry.insert("scale".to_string(), Value::from(cfg_scale));

            if !config.sample_negative_prompt.trim().is_empty() {
                entry.insert(
                    "negative_prompt".to_string(),
                    Value::String(config.sample_negative_prompt.trim().to_string()),
                );
            }
            if config.sample_seed > 0 {
                entry.insert("seed".to_string(), Value::from(config.sample_seed));
            }

            Ok(Value::Object(entry))
        })
        .collect::<AppResult<Vec<_>>>()?;

    fs::write(destination, serde_json::to_string_pretty(&prompts)?)?;
    Ok(())
}

fn parse_resolution_dimensions(value: &str) -> AppResult<(u32, u32)> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Resolution is required".to_string()));
    }

    let normalized = trimmed.replace('x', ",").replace('X', ",");
    let parts = normalized
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();

    let parse_part = |part: &str| {
        part.parse::<u32>().map_err(|_| {
            AppError::Validation(format!("Resolution must be numeric, got '{trimmed}'"))
        })
    };

    match parts.as_slice() {
        [square] => {
            let value = parse_part(square)?;
            if value == 0 {
                Err(AppError::Validation(
                    "Resolution must be greater than zero".to_string(),
                ))
            } else {
                Ok((value, value))
            }
        }
        [width, height] => {
            let width = parse_part(width)?;
            let height = parse_part(height)?;
            if width == 0 || height == 0 {
                Err(AppError::Validation(
                    "Resolution must be greater than zero".to_string(),
                ))
            } else {
                Ok((width, height))
            }
        }
        _ => Err(AppError::Validation(format!(
            "Resolution must look like '1024', '1024x1024', or '768,1344', got '{trimmed}'"
        ))),
    }
}

async fn set_process_suspended(runtime_job: &RuntimeJob, suspend: bool) -> AppResult<()> {
    let pid = runtime_job
        .pid
        .ok_or_else(|| AppError::Process("Trainer process is no longer running".to_string()))?;

    #[cfg(target_os = "windows")]
    let mut command = {
        let action = if suspend {
            "Suspend-Process"
        } else {
            "Resume-Process"
        };
        let mut command = hidden_command("powershell");
        command
            .arg("-NoProfile")
            .arg("-Command")
            .arg(format!("{action} -Id {pid}"));
        command
    };

    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let signal = if suspend { "-STOP" } else { "-CONT" };
        let mut command = hidden_command("kill");
        command.arg(signal).arg(pid.to_string());
        command
    };

    let status = command.status().await?;
    if status.success() {
        Ok(())
    } else {
        let action = if suspend { "pause" } else { "resume" };
        Err(AppError::Process(format!(
            "Failed to {action} trainer process {pid}"
        )))
    }
}

pub async fn pause_training(
    app: AppHandle,
    state: AppState,
    project_id: &str,
) -> AppResult<ActiveJobSummary> {
    let runtime_job = state
        .runtime_job(project_id)?
        .ok_or_else(|| AppError::NotFound(format!("No running job found for '{project_id}'")))?;

    match runtime_job.control_mode {
        RuntimeJobControlMode::ControlFile => {
            fs::write(&runtime_job.control_file, "paused")?;
        }
        RuntimeJobControlMode::ProcessSignals => {
            set_process_suspended(&runtime_job, true).await?;
        }
    }
    state.with_db(|connection| {
        db::update_job_status(
            connection,
            &runtime_job.job_id,
            JobStatus::Paused,
            None,
            None,
        )?;
        db::update_project_status(connection, project_id, ProjectStatus::Paused)?;
        Ok(())
    })?;

    emit_state_change(&app, project_id, &runtime_job.job_id, JobStatus::Paused);

    state
        .with_db(|connection| db::get_active_job(connection, Some(project_id)))?
        .ok_or_else(|| AppError::NotFound(format!("No job summary found for '{project_id}'")))
}

pub async fn resume_training(
    app: AppHandle,
    state: AppState,
    project_id: &str,
) -> AppResult<ActiveJobSummary> {
    let runtime_job = state
        .runtime_job(project_id)?
        .ok_or_else(|| AppError::NotFound(format!("No paused job found for '{project_id}'")))?;

    match runtime_job.control_mode {
        RuntimeJobControlMode::ControlFile => {
            fs::write(&runtime_job.control_file, "running")?;
        }
        RuntimeJobControlMode::ProcessSignals => {
            set_process_suspended(&runtime_job, false).await?;
        }
    }
    state.with_db(|connection| {
        db::update_job_status(
            connection,
            &runtime_job.job_id,
            JobStatus::Running,
            None,
            None,
        )?;
        db::update_project_status(connection, project_id, ProjectStatus::Running)?;
        Ok(())
    })?;

    emit_state_change(&app, project_id, &runtime_job.job_id, JobStatus::Running);

    state
        .with_db(|connection| db::get_active_job(connection, Some(project_id)))?
        .ok_or_else(|| AppError::NotFound(format!("No job summary found for '{project_id}'")))
}

pub async fn abort_training(
    app: AppHandle,
    state: AppState,
    project_id: &str,
) -> AppResult<ActiveJobSummary> {
    let runtime_job = state
        .runtime_job(project_id)?
        .ok_or_else(|| AppError::NotFound(format!("No active job found for '{project_id}'")))?;

    if matches!(runtime_job.control_mode, RuntimeJobControlMode::ControlFile) {
        fs::write(&runtime_job.control_file, "aborted")?;
    }
    state.with_db(|connection| {
        db::update_job_status(
            connection,
            &runtime_job.job_id,
            JobStatus::Aborted,
            None,
            Some(now_ts()),
        )?;
        db::update_project_status(connection, project_id, ProjectStatus::Aborted)?;
        Ok(())
    })?;

    match runtime_job.control_mode {
        RuntimeJobControlMode::ControlFile => {
            let exited = wait_for_runtime_job_exit(&state, &runtime_job, ABORT_GRACE_PERIOD).await?;
            if !exited {
                force_kill_process(runtime_job.pid).await?;
            }
        }
        RuntimeJobControlMode::ProcessSignals => {
            force_kill_process(runtime_job.pid).await?;
        }
    }

    emit_state_change(&app, project_id, &runtime_job.job_id, JobStatus::Aborted);

    state
        .with_db(|connection| db::get_active_job(connection, Some(project_id)))?
        .ok_or_else(|| AppError::NotFound(format!("No job summary found for '{project_id}'")))
}

pub fn run_mock_trainer_from_env() -> bool {
    let args = std::env::args().collect::<Vec<_>>();
    if args.get(1).map(String::as_str) != Some("__mock_trainer") {
        return false;
    }

    if let Err(error) = run_mock_trainer(&args[2..]) {
        eprintln!("{error}");
        std::process::exit(1);
    }

    true
}

/// Reads stdout/stderr from the trainer and dispatches each logical "line".
///
/// We can't use `read_until(b'\n', …)` here because tqdm (used by sd-scripts) emits
/// in-place progress updates terminated with `\r` and *no* `\n`. With a strict
/// newline boundary those updates would sit in the BufReader until the next true
/// newline (often the end of an epoch), making step/loss appear to update in
/// bursts. Instead we drain the stream byte-by-byte and split on either `\r`
/// or `\n`, so every carriage-return-terminated tqdm frame is forwarded to the
/// progress parser as soon as it arrives.
///
/// A small inline buffer accumulates the current in-flight line; any leftover
/// non-terminated text at EOF is still flushed so the final message is never
/// lost.
async fn stream_logs<R>(
    app: AppHandle,
    state: AppState,
    project_id: String,
    job_id: String,
    stream: &str,
    reader: R,
) -> AppResult<()>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut reader = BufReader::new(reader);
    let mut chunk = [0_u8; 4096];
    let mut pending: Vec<u8> = Vec::with_capacity(1024);

    loop {
        let n = reader.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        for &byte in &chunk[..n] {
            if byte == b'\n' || byte == b'\r' {
                flush_pending(&app, &state, &project_id, &job_id, stream, &mut pending).await?;
            } else {
                pending.push(byte);
            }
        }
    }

    flush_pending(&app, &state, &project_id, &job_id, stream, &mut pending).await?;

    Ok(())
}

async fn flush_pending(
    app: &AppHandle,
    state: &AppState,
    project_id: &str,
    job_id: &str,
    stream: &str,
    pending: &mut Vec<u8>,
) -> AppResult<()> {
    if pending.is_empty() {
        return Ok(());
    }
    let text = String::from_utf8_lossy(pending).into_owned();
    pending.clear();
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    handle_stream_line(app, state, project_id, job_id, stream, trimmed).await
}

async fn handle_stream_line(
    app: &AppHandle,
    state: &AppState,
    project_id: &str,
    job_id: &str,
    stream: &str,
    line: &str,
) -> AppResult<()> {
    let created_at = now_ts();
    let structured = parse_structured_log_line(line);
    let level = structured
        .as_ref()
        .map(|record| normalize_log_level(&record.level))
        .unwrap_or_else(|| infer_log_level(line));
    let display_line = structured
        .as_ref()
        .map(|record| record.message.as_str())
        .unwrap_or(line);
    let metrics_json = structured
        .as_ref()
        .and_then(|record| serialize_metrics(&record.metrics));
    let entry = state.with_db(|connection| {
        db::append_log(
            connection,
            job_id,
            stream,
            &level,
            display_line,
            created_at,
            structured.as_ref().map(|record| record.kind.as_str()),
            structured.as_ref().map(|record| record.stage.as_str()),
            structured.as_ref().map(|record| record.code.as_str()),
            structured.as_ref().map(|record| record.message.as_str()),
            metrics_json.as_deref(),
            structured.as_ref().map(|_| line),
        )
    })?;

    let _ = app.emit(
        TRAINING_LOG_EVENT,
        TrainingLogEvent {
            project_id: project_id.to_string(),
            job_id: job_id.to_string(),
            entry,
        },
    );

    let fallback_progress = if structured.is_none() && !job_has_structured_logs(state, job_id)? {
        parse_progress_line(line)
    } else {
        None
    };

    if let Some(progress) = structured
        .as_ref()
        .and_then(progress_from_structured_log)
        .or(fallback_progress)
    {
        let snapshot = build_snapshot_from_progress(state, project_id, job_id, progress)?;
        state.with_db(|connection| db::append_snapshot(connection, job_id, &snapshot))?;
        let _ = app.emit(
            TRAINING_PROGRESS_EVENT,
            TrainingProgressEvent {
                project_id: project_id.to_string(),
                job_id: job_id.to_string(),
                snapshot,
            },
        );
    }

    Ok(())
}

async fn wait_for_child(runtime_job: RuntimeJob) -> AppResult<(Option<u32>, bool)> {
    let mut child = runtime_job.child.lock().await;
    let pid = child.id();
    let status = child.wait().await?;
    Ok((pid, status.success()))
}

async fn wait_for_runtime_job_exit(
    state: &AppState,
    runtime_job: &RuntimeJob,
    timeout: Duration,
) -> AppResult<bool> {
    let Some(pid) = runtime_job.pid else {
        return Ok(true);
    };

    let deadline = Instant::now() + timeout;
    loop {
        if !is_process_running(pid).await? {
            return Ok(true);
        }

        let active_job = state.runtime_job(&runtime_job.project_id)?;
        if active_job
            .as_ref()
            .map(|job| job.job_id != runtime_job.job_id)
            .unwrap_or(true)
        {
            return Ok(true);
        }

        if Instant::now() >= deadline {
            return Ok(false);
        }

        tokio::time::sleep(ABORT_POLL_INTERVAL).await;
    }
}

async fn force_kill_process(pid: Option<u32>) -> AppResult<()> {
    let Some(pid) = pid else {
        return Ok(());
    };

    if !is_process_running(pid).await? {
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = hidden_command("taskkill");
        command
            .arg("/PID")
            .arg(pid.to_string())
            .arg("/T")
            .arg("/F");
        command
    };

    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let mut command = hidden_command("kill");
        command.arg("-KILL").arg(pid.to_string());
        command
    };

    let status = command.status().await?;
    if status.success() || !is_process_running(pid).await? {
        Ok(())
    } else {
        Err(AppError::Process(format!(
            "Failed to force-stop trainer process {pid}"
        )))
    }
}

async fn is_process_running(pid: u32) -> AppResult<bool> {
    #[cfg(target_os = "windows")]
    {
        let output = hidden_command("tasklist")
            .arg("/FI")
            .arg(format!("PID eq {pid}"))
            .arg("/FO")
            .arg("CSV")
            .arg("/NH")
            .output()
            .await?;
        if !output.status.success() {
            return Err(AppError::Process(format!(
                "Failed to inspect trainer process {pid}"
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        return Ok(stdout.lines().any(|line| line.starts_with('"')));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let status = hidden_command("kill")
            .arg("-0")
            .arg(pid.to_string())
            .status()
            .await?;
        Ok(status.success())
    }
}

fn finalize_job(
    state: &AppState,
    project_id: &str,
    job_id: &str,
    status: JobStatus,
    pid: Option<u32>,
) -> JobStatus {
    let _ = state.with_db(|connection| {
        db::update_job_status(connection, job_id, status, pid, Some(now_ts()))?;
        db::update_project_status(connection, project_id, status.to_project_status())?;
        Ok(())
    });

    status
}

fn final_status_after_exit(
    state: &AppState,
    job_id: &str,
    control_file: &Path,
    success: bool,
) -> JobStatus {
    let current = current_status(state, job_id).unwrap_or(JobStatus::Interrupted);
    let control = read_control_state(control_file).unwrap_or_else(|_| "running".to_string());

    if current == JobStatus::Aborted || control == "aborted" {
        JobStatus::Aborted
    } else if success {
        JobStatus::Completed
    } else {
        JobStatus::Failed
    }
}

fn emit_state_change(app: &AppHandle, project_id: &str, job_id: &str, status: JobStatus) {
    let _ = app.emit(
        TRAINING_STATE_EVENT,
        TrainingStateChangedEvent {
            project_id: project_id.to_string(),
            job_id: job_id.to_string(),
            status,
        },
    );
}

fn current_status(state: &AppState, job_id: &str) -> AppResult<JobStatus> {
    let current = state.with_db(|connection| {
        connection
            .query_row(
                "SELECT status FROM jobs WHERE id = ?1",
                rusqlite::params![job_id],
                |row| row.get::<_, String>(0),
            )
            .map(|value| JobStatus::from_db(&value))
            .map_err(Into::into)
    })?;

    Ok(current)
}

fn build_snapshot_from_progress(
    state: &AppState,
    project_id: &str,
    job_id: &str,
    progress: ParsedProgress,
) -> AppResult<TrainingSnapshot> {
    let current_job = state
        .with_db(|connection| db::get_active_job(connection, Some(project_id)))?
        .filter(|job| job.job_id == job_id);
    let runtime_seconds = progress
        .runtime_seconds
        .unwrap_or(current_runtime_seconds(state, job_id).unwrap_or(0));

    Ok(TrainingSnapshot {
        epoch: progress
            .epoch
            .or_else(|| current_job.as_ref().map(|job| job.epoch))
            .unwrap_or(0),
        epoch_total: progress
            .epoch_total
            .or_else(|| current_job.as_ref().map(|job| job.epoch_total))
            .unwrap_or(0),
        step: progress
            .step
            .or_else(|| current_job.as_ref().map(|job| job.step))
            .unwrap_or(0),
        step_total: progress
            .step_total
            .or_else(|| current_job.as_ref().map(|job| job.step_total))
            .unwrap_or(0),
        loss: progress
            .loss
            .or_else(|| current_job.as_ref().map(|job| job.loss))
            .unwrap_or(0.0),
        lr: progress
            .lr
            .or_else(|| current_job.as_ref().map(|job| job.lr))
            .unwrap_or(0.0),
        runtime_seconds,
        pid: state
            .runtime_job(project_id)?
            .and_then(|job| job.pid),
        status: current_status(state, job_id)?,
    })
}

fn current_runtime_seconds(state: &AppState, job_id: &str) -> AppResult<u64> {
    let runtime = state.with_db(|connection| {
        connection
            .query_row(
                "SELECT MAX(0, COALESCE(ended_at, ?2) - started_at) FROM jobs WHERE id = ?1",
                rusqlite::params![job_id, now_ts()],
                |row| row.get::<_, i64>(0),
            )
            .map_err(Into::into)
    })?;
    Ok(runtime as u64)
}

fn job_has_structured_logs(state: &AppState, job_id: &str) -> AppResult<bool> {
    state.with_db(|connection| {
        connection
            .query_row(
                "SELECT 1 FROM job_logs WHERE job_id = ?1 AND raw_line IS NOT NULL LIMIT 1",
                rusqlite::params![job_id],
                |_| Ok(1_i64),
            )
            .optional()
            .map(|value| value.is_some())
            .map_err(Into::into)
    })
}

fn parse_structured_log_line(line: &str) -> Option<StructuredLogRecord> {
    let payload = line.strip_prefix(STRUCTURED_LOG_PREFIX)?;
    let record = serde_json::from_str::<StructuredLogRecord>(payload).ok()?;
    if record.schema.as_deref() != Some(STRUCTURED_LOG_SCHEMA) {
        return None;
    }
    Some(record)
}

fn progress_from_structured_log(record: &StructuredLogRecord) -> Option<ParsedProgress> {
    if record.kind != "progress" {
        return None;
    }

    let parsed = ParsedProgress {
        epoch: metric_as_u32(&record.metrics, "epoch"),
        epoch_total: metric_as_u32(&record.metrics, "epochTotal"),
        step: metric_as_u32(&record.metrics, "step"),
        step_total: metric_as_u32(&record.metrics, "stepTotal"),
        loss: metric_as_f64(&record.metrics, "loss"),
        lr: metric_as_f64(&record.metrics, "lr"),
        runtime_seconds: metric_as_u64(&record.metrics, "runtimeSeconds"),
    };

    if parsed.epoch.is_none()
        && parsed.epoch_total.is_none()
        && parsed.step.is_none()
        && parsed.step_total.is_none()
        && parsed.loss.is_none()
        && parsed.lr.is_none()
        && parsed.runtime_seconds.is_none()
    {
        return None;
    }

    Some(parsed)
}

fn metric_as_u32(metrics: &Map<String, Value>, key: &str) -> Option<u32> {
    metric_as_u64(metrics, key).map(|value| value as u32)
}

fn metric_as_u64(metrics: &Map<String, Value>, key: &str) -> Option<u64> {
    match metrics.get(key)? {
        Value::Number(number) => number.as_u64(),
        Value::String(value) => value.parse().ok(),
        _ => None,
    }
}

fn metric_as_f64(metrics: &Map<String, Value>, key: &str) -> Option<f64> {
    match metrics.get(key)? {
        Value::Number(number) => number.as_f64(),
        Value::String(value) => value.parse().ok(),
        _ => None,
    }
}

fn serialize_metrics(metrics: &Map<String, Value>) -> Option<String> {
    if metrics.is_empty() {
        None
    } else {
        serde_json::to_string(metrics).ok()
    }
}

fn parse_progress_line(line: &str) -> Option<ParsedProgress> {
    if line.starts_with("TRAIN ") {
        let mut parsed = ParsedProgress::default();
        for token in line.split_whitespace().skip(1) {
            if let Some((key, value)) = token.split_once('=') {
                match key {
                    "epoch" => {
                        let (current, total) = parse_pair(value)?;
                        parsed.epoch = Some(current);
                        parsed.epoch_total = Some(total);
                    }
                    "step" => {
                        let (current, total) = parse_pair(value)?;
                        parsed.step = Some(current);
                        parsed.step_total = Some(total);
                    }
                    "loss" => parsed.loss = value.parse().ok(),
                    "lr" => parsed.lr = value.parse().ok(),
                    "runtime" => parsed.runtime_seconds = value.parse().ok(),
                    _ => {}
                }
            }
        }
        return Some(parsed);
    }

    if let Some(epoch_token) = line.strip_prefix("epoch ") {
        let (current, total) = parse_pair(epoch_token.trim())?;
        return Some(ParsedProgress {
            epoch: Some(current),
            epoch_total: Some(total),
            ..ParsedProgress::default()
        });
    }

    if line.contains("steps:") {
        let (step, step_total) = find_numeric_pair(line)?;
        return Some(ParsedProgress {
            step: Some(step),
            step_total: Some(step_total),
            loss: extract_float_after(line, "avr_loss=")
                .or_else(|| extract_float_after(line, "loss=")),
            ..ParsedProgress::default()
        });
    }

    None
}

fn parse_pair(value: &str) -> Option<(u32, u32)> {
    let (left, right) = value.split_once('/')?;
    Some((left.parse().ok()?, right.parse().ok()?))
}

fn find_numeric_pair(value: &str) -> Option<(u32, u32)> {
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if !bytes[index].is_ascii_digit() {
            index += 1;
            continue;
        }

        let start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        if index >= bytes.len() || bytes[index] != b'/' {
            continue;
        }

        let left = value[start..index].parse().ok()?;
        index += 1;
        let right_start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        if right_start == index {
            continue;
        }
        let right = value[right_start..index].parse().ok()?;
        return Some((left, right));
    }
    None
}

fn extract_float_after(value: &str, marker: &str) -> Option<f64> {
    let start = value.find(marker)? + marker.len();
    let tail = &value[start..];
    let end = tail
        .find(|character: char| {
            !(character.is_ascii_digit() || matches!(character, '.' | '-' | '+' | 'e' | 'E'))
        })
        .unwrap_or(tail.len());
    tail[..end].parse().ok()
}

fn normalize_log_level(level: &str) -> String {
    match level.trim().to_ascii_lowercase().as_str() {
        "warning" => "warn".to_string(),
        "completed" => "success".to_string(),
        "critical" | "failed" => "error".to_string(),
        other => other.to_string(),
    }
}

fn infer_log_level(line: &str) -> String {
    let lowered = line.to_ascii_lowercase();
    if lowered.contains("error") || lowered.contains("exception") || lowered.contains("traceback") {
        "error".to_string()
    } else if lowered.contains("warn") || lowered.contains("disk space") {
        "warn".to_string()
    } else if lowered.contains("checkpoint")
        || lowered.contains("complete")
        || lowered.contains("saved.")
    {
        "success".to_string()
    } else {
        "info".to_string()
    }
}

fn parse_lr(value: &str) -> f64 {
    value.parse::<f64>().unwrap_or(0.00015)
}

fn estimate_vram_usage(
    vram_total_gb: f32,
    used_memory_gb: f32,
    total_memory_gb: f32,
    hardware: &HardwareInfo,
) -> f32 {
    if total_memory_gb <= 0.0 {
        return (vram_total_gb * 0.45).clamp(0.5, vram_total_gb);
    }

    let memory_ratio = (used_memory_gb / total_memory_gb).clamp(0.05, 0.95);
    let baseline = if hardware.source == "nvidia-smi" {
        0.18
    } else {
        0.12
    };
    (vram_total_gb * (baseline + memory_ratio * 0.42)).clamp(0.5, vram_total_gb)
}

fn bytes_to_gb(bytes: u64) -> f32 {
    (bytes as f32) / 1024.0 / 1024.0 / 1024.0
}

fn read_control_state(path: &Path) -> AppResult<String> {
    Ok(fs::read_to_string(path)?.trim().to_string())
}

fn run_mock_trainer(args: &[String]) -> AppResult<()> {
    let project_name = required_arg(args, "--project-name")?;
    let output_dir = PathBuf::from(required_arg(args, "--output-dir")?);
    let control_file = PathBuf::from(required_arg(args, "--control-file")?);
    let epochs = required_arg(args, "--epochs")?
        .parse::<u32>()
        .map_err(|_| AppError::Process("Invalid epochs value".to_string()))?;
    let steps_per_epoch = required_arg(args, "--steps-per-epoch")?
        .parse::<u32>()
        .map_err(|_| AppError::Process("Invalid steps-per-epoch value".to_string()))?;
    let save_every = required_arg(args, "--save-every")?
        .parse::<u32>()
        .map_err(|_| AppError::Process("Invalid save-every value".to_string()))?;
    let learning_rate = required_arg(args, "--lr")?
        .parse::<f64>()
        .unwrap_or(0.00015);

    fs::create_dir_all(&output_dir)?;

    println!("INFO project={} trainer=boot", project_name);

    let total_steps = epochs.saturating_mul(steps_per_epoch).max(1);
    let mut step = 0_u32;
    let mut runtime_seconds = 0_u64;

    for epoch in 1..=epochs {
        for epoch_step in 1..=steps_per_epoch {
            loop {
                let control =
                    read_control_state(&control_file).unwrap_or_else(|_| "running".to_string());
                match control.as_str() {
                    "paused" => {
                        println!(
                            "INFO project={} status=paused epoch={}/{} step={}/{}",
                            project_name, epoch, epochs, step, total_steps
                        );
                        std::thread::sleep(Duration::from_millis(400));
                        runtime_seconds = runtime_seconds.saturating_add(1);
                        continue;
                    }
                    "aborted" => {
                        println!("WARN project={} trainer=aborted", project_name);
                        return Ok(());
                    }
                    _ => {}
                }
                break;
            }

            step = step.saturating_add(1);
            runtime_seconds = runtime_seconds.saturating_add(1);

            let progress = step as f64 / total_steps as f64;
            let loss = (0.19 - progress * 0.13).max(0.028);
            println!(
                "TRAIN epoch={}/{} step={}/{} loss={:.4} lr={} runtime={}",
                epoch, epochs, step, total_steps, loss, learning_rate, runtime_seconds
            );

            if epoch_step % 30 == 0 {
                eprintln!(
                    "WARN project={} note=Disk cache warming epoch_step={}",
                    project_name, epoch_step
                );
            }

            std::thread::sleep(Duration::from_millis(150));
        }

        if epoch % save_every.max(1) == 0 {
            let checkpoint_path = output_dir.join(format!("epoch_{epoch:02}.safetensors"));
            let mut checkpoint = fs::File::create(&checkpoint_path)?;
            writeln!(
                checkpoint,
                "mock checkpoint for {} at epoch {}",
                project_name, epoch
            )?;
            println!(
                "CHECKPOINT epoch={} file={}",
                epoch,
                checkpoint_path.display()
            );
        }
    }

    println!("COMPLETE project={} status=completed", project_name);
    Ok(())
}

fn required_arg(args: &[String], flag: &str) -> AppResult<String> {
    let index = args
        .iter()
        .position(|value| value == flag)
        .ok_or_else(|| AppError::Process(format!("Missing required flag '{flag}'")))?;

    args.get(index + 1)
        .cloned()
        .ok_or_else(|| AppError::Process(format!("Missing value for flag '{flag}'")))
}
