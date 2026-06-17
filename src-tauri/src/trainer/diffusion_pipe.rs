/**
 * @file trainer/diffusion_pipe.rs
 * @description diffusion-pipe WSL 训练器：WSL 路径转换、TOML 配置文件生成、命令构建、`start_diffusion_pipe_training`。
 */

use std::{
    fs,
    path::PathBuf,
    process::Stdio,
};

use tauri::AppHandle;

use crate::{
    db,
    error::{AppError, AppResult},
    models::{
        ActiveJobSummary, DiffusionPipeConfig, JobStatus, ProjectRecord,
        ProjectStatus, TrainingEnvSettings, TrainingSnapshot,
    },
    state::{AppState, RuntimeJob, RuntimeJobControlMode},
    utils::now_ts,
};

use super::{
    bash_shell_quote, emit_state_change, finalize_job, final_status_after_exit,
    format_training_invocation, open_project_log_file, stream_logs, wait_for_child,
};
use super::sd_scripts::{collect_dataset_image_dirs, toml_string};
// diffusion-pipe WSL training support
// ─────────────────────────────────────────────────────────────────────────────

/// Convert a Windows path like `D:\foo\bar` to a WSL path `/mnt/d/foo/bar`.
/// If the path is already a Unix-style path (starts with `/`), return as-is.
pub fn windows_path_to_wsl(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.starts_with('/') {
        return trimmed.to_string();
    }
    // Handle UNC prefix stripped paths like `\\?\D:\foo` → skip prefix
    let normalized = if trimmed.starts_with("\\\\?\\") {
        &trimmed[4..]
    } else {
        trimmed
    };
    // Match `X:\rest` or `X:/rest`
    let chars: Vec<char> = normalized.chars().collect();
    if chars.len() >= 2 && chars[1] == ':' {
        let drive = chars[0].to_ascii_lowercase();
        let rest = &normalized[2..];
        let unix_rest = rest.replace('\\', "/");
        let unix_rest = unix_rest.trim_start_matches('/');
        if unix_rest.is_empty() {
            return format!("/mnt/{drive}");
        }
        return format!("/mnt/{drive}/{unix_rest}");
    }
    // Fallback: just replace backslashes
    normalized.replace('\\', "/")
}

fn write_diffusion_pipe_dataset_toml(
    project: &ProjectRecord,
    config: &DiffusionPipeConfig,
    destination: &std::path::Path,
    group_types: &std::collections::HashMap<String, String>,
    control_dirs: &std::collections::HashMap<String, String>,
) -> AppResult<()> {
    let dataset_wsl = windows_path_to_wsl(&project.dataset_path);
    let resolutions = config.dataset_resolutions.trim();
    let frame_buckets = config.frame_buckets.trim();

    let mut toml = String::new();

    // resolutions
    let res_parts: Vec<&str> = resolutions.split(',').map(str::trim).filter(|s| !s.is_empty()).collect();
    if res_parts.len() == 1 {
        toml.push_str(&format!("resolutions = [{}]\n", res_parts[0]));
    } else if res_parts.len() > 1 {
        let joined = res_parts.join(", ");
        toml.push_str(&format!("resolutions = [{joined}]\n"));
    } else {
        toml.push_str("resolutions = [512]\n");
    }

    if config.enable_ar_bucket {
        toml.push_str("enable_ar_bucket = true\n");
        toml.push_str("min_ar = 0.5\n");
        toml.push_str("max_ar = 2.0\n");
        toml.push_str(&format!("num_ar_buckets = {}\n", config.num_ar_buckets));
    }

    // frame buckets
    let fb_parts: Vec<&str> = frame_buckets.split(',').map(str::trim).filter(|s| !s.is_empty()).collect();
    if !fb_parts.is_empty() {
        let joined = fb_parts.join(", ");
        toml.push_str(&format!("frame_buckets = [{joined}]\n"));
    }

    // Collect all leaf directories that actually contain images.
    // This mirrors how sd-scripts recurses into @N_triggerword subdirectories.
    let dataset_win = std::path::Path::new(&project.dataset_path);
    let image_dirs = collect_dataset_image_dirs(dataset_win).unwrap_or_else(|_| {
        // Fallback: use the root dataset path as-is.
        vec![dataset_win.to_path_buf()]
    });

    // Helper: dataset-root-relative, forward-slash path for a directory.
    let rel_of = |dir: &std::path::Path| -> String {
        dir.strip_prefix(dataset_win)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default()
            .trim_matches('/')
            .to_string()
    };

    // Directories registered as control (reference) targets are emitted via the
    // matching target's `control_path`, so they must not appear as standalone
    // `[[directory]]` blocks of their own.
    let control_rel_set: std::collections::HashSet<String> =
        control_dirs.values().map(|v| v.trim_matches('/').to_string()).collect();

    // Filter out regularization directories (diffusion-pipe has no is_reg concept)
    // and any directory that is itself a control/reference directory.
    let training_dirs: Vec<&PathBuf> = image_dirs
        .iter()
        .filter(|dir| {
            let rel = rel_of(dir);
            if group_types.get(&rel).map(|t| t == "reg").unwrap_or(false) {
                return false;
            }
            !control_rel_set.contains(&rel)
        })
        .collect();

    if training_dirs.is_empty() {
        // Nothing found (or all dirs are reg) — point at root so dp gives a readable error.
        toml.push('\n');
        toml.push_str("[[directory]]\n");
        toml.push_str(&format!("path = {}\n", toml_string(&dataset_wsl)));
        toml.push_str(&format!("num_repeats = {}\n", config.num_repeats));
    } else {
        for dir in &training_dirs {
            let dir_wsl = windows_path_to_wsl(&dir.to_string_lossy());
            let rel = rel_of(dir);
            toml.push('\n');
            toml.push_str("[[directory]]\n");
            toml.push_str(&format!("path = {}\n", toml_string(&dir_wsl)));
            toml.push_str(&format!("num_repeats = {}\n", config.num_repeats));
            // Edit training: if this target dir has a registered control directory,
            // emit `control_path` so diffusion-pipe pairs same-stem reference images.
            if let Some(control_rel) = control_dirs.get(&rel) {
                let control_win = dataset_win.join(control_rel.replace('/', std::path::MAIN_SEPARATOR_STR));
                let control_wsl = windows_path_to_wsl(&control_win.to_string_lossy());
                toml.push_str(&format!("control_path = {}\n", toml_string(&control_wsl)));
            }
        }
    }

    fs::write(destination, toml)?;
    Ok(())
}

fn write_diffusion_pipe_main_toml(
    project: &ProjectRecord,
    config: &DiffusionPipeConfig,
    dataset_toml_wsl_path: &str,
    destination: &std::path::Path,
) -> AppResult<()> {
    let output_wsl = windows_path_to_wsl(&project.output_path);
    let mut toml = String::new();

    toml.push_str(&format!("output_dir = {}\n", toml_string(&output_wsl)));
    toml.push_str(&format!("dataset = {}\n\n", toml_string(dataset_toml_wsl_path)));

    toml.push_str(&format!("epochs = {}\n", config.epochs));
    if config.max_steps > 0 {
        toml.push_str(&format!("max_steps = {}\n", config.max_steps));
    }
    toml.push_str(&format!("micro_batch_size_per_gpu = {}\n", config.micro_batch_size_per_gpu));
    toml.push_str(&format!("pipeline_stages = 1\n"));
    toml.push_str(&format!("gradient_accumulation_steps = {}\n", config.gradient_accumulation_steps));

    let gc = config.gradient_clipping.trim();
    if !gc.is_empty() {
        toml.push_str(&format!("gradient_clipping = {gc}\n"));
    }
    if config.warmup_steps > 0 {
        toml.push_str(&format!("warmup_steps = {}\n", config.warmup_steps));
    }

    toml.push_str("\neval_every_n_epochs = 1\n");
    toml.push_str("eval_before_first_step = true\n");
    toml.push_str("eval_micro_batch_size_per_gpu = 1\n");
    toml.push_str("eval_gradient_accumulation_steps = 1\n\n");

    if config.save_every_n_epochs > 0 {
        toml.push_str(&format!("save_every_n_epochs = {}\n", config.save_every_n_epochs));
    }
    if config.save_every_n_steps > 0 {
        toml.push_str(&format!("save_every_n_steps = {}\n", config.save_every_n_steps));
    }
    if config.checkpoint_every_n_minutes > 0 {
        toml.push_str(&format!("checkpoint_every_n_minutes = {}\n", config.checkpoint_every_n_minutes));
    }

    let ac = config.activation_checkpointing.trim();
    match ac {
        "false" | "0" | "" => {}
        "unsloth" => toml.push_str("activation_checkpointing = 'unsloth'\n"),
        _ => toml.push_str("activation_checkpointing = true\n"),
    }

    if config.blocks_to_swap > 0 {
        toml.push_str(&format!("blocks_to_swap = {}\n", config.blocks_to_swap));
    }

    toml.push_str("partition_method = 'parameters'\n");

    let save_dtype = config.save_dtype.trim();
    if !save_dtype.is_empty() {
        toml.push_str(&format!("save_dtype = {}\n", toml_single_quoted(save_dtype)));
    }
    toml.push_str("caching_batch_size = 1\n");
    toml.push_str(&format!("steps_per_print = {}\n", config.steps_per_print.max(1)));

    // [model]
    toml.push_str("\n[model]\n");
    let model_type = config.model_type.trim();
    toml.push_str(&format!("type = {}\n", toml_single_quoted(model_type)));

    // Determine how model_path maps to a TOML key.
    // - diffusers_path  : qwen_image / ernie_image / z_image
    // - ckpt_path       : hunyuan-video / hunyuan_video_15 (directory with all weights)
    // - transformer_path: everything else (anima/cosmos_predict2, flux, sd3, sdxl, …)
    let uses_diffusers_path = matches!(model_type, "qwen_image" | "ernie_image" | "z_image");
    let uses_ckpt_path      = matches!(model_type, "hunyuan-video" | "hunyuan_video_15");

    let model_path = config.model_path.trim();
    let extra_transformer_path = config.transformer_path.trim();

    if !model_path.is_empty() {
        let wsl_path = windows_path_to_wsl(model_path);
        if uses_diffusers_path {
            toml.push_str(&format!("diffusers_path = {}\n", toml_string(&wsl_path)));
        } else if uses_ckpt_path {
            toml.push_str(&format!("ckpt_path = {}\n", toml_string(&wsl_path)));
        } else {
            // For anima, flux, chroma, etc.: model_path is the transformer.
            // Only emit here when the user hasn't also filled in the explicit transformer_path field.
            if extra_transformer_path.is_empty() {
                toml.push_str(&format!("transformer_path = {}\n", toml_string(&wsl_path)));
            }
        }
    }

    // Explicit transformer_path field (always respected, overrides model_path for split-weight models)
    if !extra_transformer_path.is_empty() {
        let wsl_path = windows_path_to_wsl(extra_transformer_path);
        toml.push_str(&format!("transformer_path = {}\n", toml_string(&wsl_path)));
    }
    let vae_path = config.vae_path.trim();
    if !vae_path.is_empty() {
        let wsl_path = windows_path_to_wsl(vae_path);
        toml.push_str(&format!("vae_path = {}\n", toml_string(&wsl_path)));
    }
    let llm_path = config.llm_path.trim();
    if !llm_path.is_empty() {
        let wsl_path = windows_path_to_wsl(llm_path);
        toml.push_str(&format!("llm_path = {}\n", toml_string(&wsl_path)));
    }
    let clip_path = config.clip_path.trim();
    if !clip_path.is_empty() {
        let wsl_path = windows_path_to_wsl(clip_path);
        toml.push_str(&format!("clip_path = {}\n", toml_string(&wsl_path)));
    }

    let dtype = config.model_dtype.trim();
    if !dtype.is_empty() {
        toml.push_str(&format!("dtype = {}\n", toml_single_quoted(dtype)));
    }
    let transformer_dtype = config.transformer_dtype.trim();
    if !transformer_dtype.is_empty() {
        toml.push_str(&format!("transformer_dtype = {}\n", toml_single_quoted(transformer_dtype)));
    }
    let tsm = config.timestep_sample_method.trim();
    if !tsm.is_empty() {
        toml.push_str(&format!("timestep_sample_method = {}\n", toml_single_quoted(tsm)));
    }

    // [adapter] — omit entirely for full fine-tuning
    let adapter_type = config.adapter_type.trim();
    if !adapter_type.is_empty() {
        toml.push_str("\n[adapter]\n");
        toml.push_str(&format!("type = {}\n", toml_single_quoted(adapter_type)));
        if adapter_type == "lora" {
            toml.push_str(&format!("rank = {}\n", config.lora_rank));
            let lora_dtype = config.lora_dtype.trim();
            if !lora_dtype.is_empty() {
                toml.push_str(&format!("dtype = {}\n", toml_single_quoted(lora_dtype)));
            }
        }
    }

    // [optimizer]
    toml.push_str("\n[optimizer]\n");
    let opt_type = config.optimizer_type.trim();
    if !opt_type.is_empty() {
        toml.push_str(&format!("type = {}\n", toml_single_quoted(opt_type)));
    }
    let lr = config.lr.trim();
    if !lr.is_empty() {
        toml.push_str(&format!("lr = {lr}\n"));
    }
    let wd = config.weight_decay.trim();
    if !wd.is_empty() {
        toml.push_str(&format!("weight_decay = {wd}\n"));
    }
    // Standard AdamW-like defaults
    if matches!(opt_type, "adamw_optimi" | "AdamW8bitKahan" | "AdamW") {
        toml.push_str("betas = [0.9, 0.99]\n");
        toml.push_str("eps = 1e-8\n");
    }

    // [monitoring]
    toml.push_str("\n[monitoring]\nenable_wandb = false\n");

    fs::write(destination, toml)?;
    Ok(())
}

fn toml_single_quoted(value: &str) -> String {
    format!("'{}'", value.replace('\'', "\\'"))
}

pub fn build_diffusion_pipe_command(
    state: &AppState,
    project: &ProjectRecord,
    config: &DiffusionPipeConfig,
    env_settings: &TrainingEnvSettings,
    job_id: &str,
) -> AppResult<(tokio::process::Command, RuntimeJobControlMode)> {
    let distro = env_settings.wsl_distro.trim();
    if distro.is_empty() {
        return Err(AppError::Validation(
            "WSL distribution name is not configured. Set it in Design → Training Env.".to_string(),
        ));
    }

    let dp_wsl_path = env_settings.diffusion_pipe_wsl_path.trim();
    if dp_wsl_path.is_empty() {
        return Err(AppError::Validation(
            "diffusion-pipe WSL path is not configured. Set it in Design → Training Env.".to_string(),
        ));
    }

    let venv_path = env_settings.diffusion_pipe_venv_path.trim();
    let num_gpus = env_settings.num_gpus.max(1);

    // Write dataset TOML
    let dataset_toml_path = state
        .paths()
        .jobs_dir
        .join(format!("{job_id}.dp.dataset.toml"));
    let group_types =
        state.with_db(|connection| db::load_dataset_group_types(connection, &project.id))?;
    let control_dirs =
        state.with_db(|connection| db::load_dataset_control_dirs(connection, &project.id))?;
    write_diffusion_pipe_dataset_toml(
        project,
        config,
        &dataset_toml_path,
        &group_types,
        &control_dirs,
    )?;
    let dataset_toml_wsl = windows_path_to_wsl(&dataset_toml_path.to_string_lossy());

    // Write main TOML
    let main_toml_path = state.paths().jobs_dir.join(format!("{job_id}.dp.toml"));
    write_diffusion_pipe_main_toml(project, config, &dataset_toml_wsl, &main_toml_path)?;
    let main_toml_wsl = windows_path_to_wsl(&main_toml_path.to_string_lossy());

    // Build bash command string
    let mut bash_parts: Vec<String> = Vec::new();

    if !venv_path.is_empty() {
        bash_parts.push(format!(
            "source {}/bin/activate",
            bash_shell_quote(venv_path)
        ));
    }

    if config.nccl_disable {
        bash_parts.push("export NCCL_P2P_DISABLE=1 NCCL_IB_DISABLE=1".to_string());
    }

    bash_parts.push(format!("cd {}", bash_shell_quote(dp_wsl_path)));

    let mut ds_cmd = format!(
        "deepspeed --num_gpus={num_gpus} train.py --deepspeed --config {}",
        bash_shell_quote(&main_toml_wsl)
    );

    let resume = config.resume_from_checkpoint.trim();
    if !resume.is_empty() {
        if resume == "latest" {
            ds_cmd.push_str(" --resume_from_checkpoint");
        } else {
            let resume_wsl = windows_path_to_wsl(resume);
            ds_cmd.push_str(&format!(
                " --resume_from_checkpoint {}",
                bash_shell_quote(&resume_wsl)
            ));
        }
    }

    bash_parts.push(ds_cmd);

    let bash_script = bash_parts.join(" && ");

    let mut command = if distro.is_empty() || distro == "default" {
        let mut cmd = tokio::process::Command::new("wsl");
        cmd.arg("--").arg("bash").arg("-c").arg(&bash_script);
        cmd
    } else {
        let mut cmd = tokio::process::Command::new("wsl");
        cmd.arg("-d").arg(distro).arg("--").arg("bash").arg("-c").arg(&bash_script);
        cmd
    };

    command.env("PYTHONUNBUFFERED", "1");
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW

    Ok((command, RuntimeJobControlMode::ProcessSignals))
}

/// Parse a DeepSpeed training log line for progress information.
pub async fn start_diffusion_pipe_training(
    app: AppHandle,
    state: AppState,
    project: ProjectRecord,
    config: DiffusionPipeConfig,
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
        build_diffusion_pipe_command(&state, &project, &config, &env_settings, &job_id)?;
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
        let initial_snapshot = TrainingSnapshot {
            epoch: 1,
            epoch_total: config.epochs.max(1),
            step: 0,
            step_total: if config.max_steps > 0 { config.max_steps } else { 0 },
            loss: 0.185,
            lr: config.lr.trim().parse::<f64>().unwrap_or(2e-5),
            runtime_seconds: 0,
            pid,
            status: JobStatus::Running,
        };
        db::append_snapshot(connection, &job_id, &initial_snapshot)?;
        let bootstrap_msg = "Bootstrapping diffusion-pipe trainer...";
        db::append_log(
            connection,
            &job_id,
            "stdout",
            "info",
            bootstrap_msg,
            now_ts(),
            Some("lifecycle"),
            Some("bootstrap"),
            Some("TRAINER_BOOTSTRAP"),
            Some(bootstrap_msg),
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
                finalize_job(&wait_state, &wait_project_id, &wait_job_id, status, child_pid)
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

#[cfg(test)]
mod tests {
    use super::windows_path_to_wsl;

    #[test]
    fn windows_path_to_wsl_handles_spaces() {
        let win = r"D:\ComfyUI windows portable\train\gufeng\output\20260606_18-58-23";
        assert_eq!(
            windows_path_to_wsl(win),
            "/mnt/d/ComfyUI windows portable/train/gufeng/output/20260606_18-58-23"
        );
    }
}

