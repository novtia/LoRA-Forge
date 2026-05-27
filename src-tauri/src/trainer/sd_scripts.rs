/**
 * @file trainer/sd_scripts.rs
 * @description sd-scripts LoRA 训练器：命令构建、数据集 TOML 配置生成、启动/暂停/恢复/终止。
 *   diffusion-pipe 共用的文件系统工具（`collect_dataset_image_dirs`、`toml_string`）也在此处。
 */

use std::{
    fs,
    path::{Path, PathBuf},
    process::Stdio,
};

use tauri::AppHandle;

use crate::{
    db,
    error::{AppError, AppResult},
    models::{
        ActiveJobSummary, JobStatus, ProjectRecord, ProjectStatus, TrainingConfig,
        TrainingEnvSettings, TrainingSnapshot,
    },
    state::{AppState, RuntimeJob, RuntimeJobControlMode},
    utils::now_ts,
};

use serde_json::Value;

use super::{
    emit_state_change, finalize_job, final_status_after_exit, force_kill_process,
    format_training_invocation, hidden_command, open_project_log_file, stream_logs,
    training_subprocess_command, wait_for_child, wait_for_runtime_job_exit, ABORT_GRACE_PERIOD,
};
use super::log_parser::parse_lr;
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
    let command_line = format_training_invocation(&command);
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
        let by_steps = config.training_length_mode.eq_ignore_ascii_case("steps");
        let (step_total_init, epoch_total_init) = if by_steps {
            (config.max_train_steps, 1)
        } else {
            (0, config.epochs.max(1))
        };
        let initial_snapshot = TrainingSnapshot {
            epoch: 1,
            epoch_total: epoch_total_init,
            step: 0,
            step_total: step_total_init,
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
        let cmd_log = format!("Training command: {command_line}");
        db::append_log(
            connection,
            &job_id,
            "stdout",
            "info",
            &cmd_log,
            now_ts(),
            Some("lifecycle"),
            Some("bootstrap"),
            Some("TRAINER_COMMAND"),
            Some(&cmd_log),
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

    let log_file = open_project_log_file(&project.root_path, &job_id);

    let stdout_state = state.clone();
    let stdout_app = app.clone();
    let stdout_job_id = job_id.clone();
    let stdout_project_id = project.id.clone();
    let stdout_log = log_file.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = stream_logs(
            stdout_app,
            stdout_state,
            stdout_project_id,
            stdout_job_id,
            "stdout",
            stdout,
            stdout_log,
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
    let stderr_log = log_file.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = stream_logs(
            stderr_app,
            stderr_state,
            stderr_project_id,
            stderr_job_id,
            "stderr",
            stderr,
            stderr_log,
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
    let group_types =
        state.with_db(|connection| db::load_dataset_group_types(connection, &project.id))?;
    write_dataset_config(project, config, &dataset_config_path, &group_types)?;
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

    // `training_length_mode`: steps → `--max_train_steps`, epochs → `--max_train_epochs` (mutually exclusive).
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
        .arg(config.batch_size.to_string());
    if config.training_length_mode.eq_ignore_ascii_case("steps") {
        command
            .arg("--max_train_steps")
            .arg(config.max_train_steps.to_string());
    } else {
        command
            .arg("--max_train_epochs")
            .arg(config.epochs.to_string());
    }
    command
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
    group_types: &std::collections::HashMap<String, String>,
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
    for image_dir in &image_dirs {
        let rel = image_dir
            .strip_prefix(&dataset_root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        let is_reg = group_types.get(&rel).map(|t| t == "reg").unwrap_or(false);

        config_toml.push_str("\n  [[datasets.subsets]]\n");
        config_toml.push_str(&format!(
            "  image_dir = {}\n",
            toml_string(&image_dir.to_string_lossy())
        ));
        config_toml.push_str(&format!("  num_repeats = {}\n", config.dataset_repeats));
        config_toml.push_str("  caption_extension = \".txt\"\n");
        if is_reg {
            config_toml.push_str("  is_reg = true\n");
        }
    }

    fs::write(destination, config_toml)?;
    Ok(())
}

pub fn collect_dataset_image_dirs(root: &Path) -> AppResult<Vec<PathBuf>> {
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

pub fn toml_string(value: &str) -> String {
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

