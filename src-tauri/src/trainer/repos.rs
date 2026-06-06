/**
 * @file trainer/repos.rs
 * @description 训练仓库管理服务：精选目录、git 状态探测、clone/pull 流式任务（emit repo-task-*）、删除、取消。
 *   Windows 目标用原生 git；WSL 目标用 `wsl -d <distro> -- bash -lc "git …"`。
 */

use std::{process::Stdio, sync::Arc};

use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, BufReader};

use crate::{
    db,
    error::{AppError, AppResult},
    models::{CustomRepoInput, CustomRepoRecord, RepoTaskLogEvent, RepoTaskStateEvent, TrainingEnvSettings, TrainingRepoStatus},
    state::{AppState, RepoTask},
    utils::{hidden_std_command, new_entity_id, now_ts},
};

use super::events::{REPO_TASK_LOG_EVENT, REPO_TASK_STATE_EVENT};

// ─────────────────────────────────────────────────────────────────────────────
// Curated catalog
// ─────────────────────────────────────────────────────────────────────────────

pub struct CuratedRepo {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    /// `"windows"` | `"wsl"`.
    pub target: &'static str,
    pub git_url: &'static str,
}

pub const CURATED_REPOS: &[CuratedRepo] = &[
    CuratedRepo {
        id: "diffusion-pipe",
        name: "diffusion-pipe",
        description: "DeepSpeed 视频/图像扩散模型训练管线（WSL）",
        target: "wsl",
        git_url: "https://github.com/tdrussell/diffusion-pipe",
    },
    CuratedRepo {
        id: "sd-scripts",
        name: "sd-scripts (kohya)",
        description: "kohya-ss 的 SD / SDXL LoRA 训练脚本（Windows）",
        target: "windows",
        git_url: "https://github.com/kohya-ss/sd-scripts",
    },
    CuratedRepo {
        id: "musubi-tuner",
        name: "musubi-tuner",
        description: "HunyuanVideo / Wan 等视频模型 LoRA 训练（WSL）",
        target: "wsl",
        git_url: "https://github.com/kohya-ss/musubi-tuner",
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// Path helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Default install path for a curated repo, honoring existing env settings.
fn curated_install_path(id: &str, env: &TrainingEnvSettings) -> String {
    match id {
        "sd-scripts" => {
            let p = env.sd_scripts_path.trim();
            if p.is_empty() {
                "sd-scripts".to_string()
            } else {
                p.to_string()
            }
        }
        "diffusion-pipe" => {
            let p = env.diffusion_pipe_wsl_path.trim();
            if p.is_empty() {
                "~/diffusion-pipe".to_string()
            } else {
                p.to_string()
            }
        }
        "musubi-tuner" => "~/musubi-tuner".to_string(),
        _ => String::new(),
    }
}

/// Produce a double-quoted bash expression that expands a leading `~/` via `$HOME`.
fn bash_path_expr(path: &str) -> String {
    let p = path.trim();
    if let Some(rest) = p.strip_prefix("~/") {
        format!("\"$HOME/{}\"", rest.replace('"', "\\\""))
    } else if p == "~" {
        "\"$HOME\"".to_string()
    } else {
        format!("\"{}\"", p.replace('"', "\\\""))
    }
}

fn single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn wsl_distro_args(distro: &str) -> Option<String> {
    let trimmed = distro.trim();
    if trimmed.is_empty() || trimmed == "default" {
        None
    } else {
        Some(trimmed.to_string())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// git status detection (synchronous, fast)
// ─────────────────────────────────────────────────────────────────────────────

fn detect_git_status(
    target: &str,
    install_path: &str,
    distro: &str,
) -> (bool, Option<String>, Option<String>) {
    if install_path.trim().is_empty() {
        return (false, None, None);
    }
    match target {
        "wsl" => detect_git_status_wsl(install_path, distro),
        _ => detect_git_status_windows(install_path),
    }
}

fn run_git_windows(path: &str, args: &[&str]) -> Option<String> {
    let mut command = hidden_std_command("git");
    command.arg("-C").arg(path);
    for arg in args {
        command.arg(arg);
    }
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn detect_git_status_windows(path: &str) -> (bool, Option<String>, Option<String>) {
    let git_dir = std::path::Path::new(path).join(".git");
    if !git_dir.exists() {
        return (false, None, None);
    }
    let branch = run_git_windows(path, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let commit = run_git_windows(path, &["rev-parse", "--short", "HEAD"]);
    (true, branch, commit)
}

fn detect_git_status_wsl(path: &str, distro: &str) -> (bool, Option<String>, Option<String>) {
    let script = format!(
        "P={p}; if [ -d \"$P/.git\" ]; then echo INSTALLED; git -C \"$P\" rev-parse --abbrev-ref HEAD 2>/dev/null; git -C \"$P\" rev-parse --short HEAD 2>/dev/null; fi",
        p = bash_path_expr(path)
    );
    let mut command = hidden_std_command("wsl");
    if let Some(name) = wsl_distro_args(distro) {
        command.arg("-d").arg(name);
    }
    command.arg("--").arg("bash").arg("-lc").arg(&script);
    let output = match command.output() {
        Ok(output) => output,
        Err(_) => return (false, None, None),
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut lines = stdout.lines().map(str::trim).filter(|line| !line.is_empty());
    match lines.next() {
        Some("INSTALLED") => {
            let branch = lines.next().map(|value| value.to_string());
            let commit = lines.next().map(|value| value.to_string());
            (true, branch, commit)
        }
        _ => (false, None, None),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Listing / resolution / custom CRUD
// ─────────────────────────────────────────────────────────────────────────────

pub fn list_repos(state: &AppState) -> AppResult<Vec<TrainingRepoStatus>> {
    let env = state.with_db(db::load_training_env)?;
    let distro = env.wsl_distro.clone();
    let mut repos = Vec::new();

    for curated in CURATED_REPOS {
        let install_path = curated_install_path(curated.id, &env);
        let (installed, branch, commit) = detect_git_status(curated.target, &install_path, &distro);
        repos.push(TrainingRepoStatus {
            id: curated.id.to_string(),
            name: curated.name.to_string(),
            description: curated.description.to_string(),
            target: curated.target.to_string(),
            git_url: curated.git_url.to_string(),
            install_path,
            installed,
            current_branch: branch,
            current_commit: commit,
            is_custom: false,
        });
    }

    let customs = state.with_db(db::list_custom_repos)?;
    for record in customs {
        let (installed, branch, commit) =
            detect_git_status(&record.target, &record.install_path, &distro);
        repos.push(TrainingRepoStatus {
            id: record.id,
            name: record.name,
            description: String::new(),
            target: record.target,
            git_url: record.git_url,
            install_path: record.install_path,
            installed,
            current_branch: branch,
            current_commit: commit,
            is_custom: true,
        });
    }

    Ok(repos)
}

pub fn resolve_repo(state: &AppState, repo_id: &str) -> AppResult<TrainingRepoStatus> {
    list_repos(state)?
        .into_iter()
        .find(|repo| repo.id == repo_id)
        .ok_or_else(|| AppError::NotFound(format!("Unknown training repo '{repo_id}'")))
}

pub fn add_custom_repo(state: &AppState, input: CustomRepoInput) -> AppResult<Vec<TrainingRepoStatus>> {
    let name = input.name.trim();
    let url = input.git_url.trim();
    let target = input.target.trim();
    let path = input.install_path.trim();

    if name.is_empty() {
        return Err(AppError::Validation("Repository name is required".to_string()));
    }
    if url.is_empty() {
        return Err(AppError::Validation("Git URL is required".to_string()));
    }
    if target != "windows" && target != "wsl" {
        return Err(AppError::Validation(
            "Target must be 'windows' or 'wsl'".to_string(),
        ));
    }
    if path.is_empty() {
        return Err(AppError::Validation("Install path is required".to_string()));
    }

    let record = CustomRepoRecord {
        id: new_entity_id("repo"),
        name: name.to_string(),
        git_url: url.to_string(),
        target: target.to_string(),
        install_path: path.to_string(),
        created_at: now_ts(),
    };
    state.with_db(|connection| db::insert_custom_repo(connection, &record))?;
    list_repos(state)
}

pub fn remove_custom_repo(state: &AppState, repo_id: &str) -> AppResult<Vec<TrainingRepoStatus>> {
    state.with_db(|connection| db::delete_custom_repo(connection, repo_id))?;
    list_repos(state)
}

// ─────────────────────────────────────────────────────────────────────────────
// Command building
// ─────────────────────────────────────────────────────────────────────────────

fn no_window(command: &mut tokio::process::Command) {
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let _ = command;
}

fn build_wsl_task_command(distro: &str, script: &str) -> tokio::process::Command {
    let mut command = tokio::process::Command::new("wsl");
    if let Some(name) = wsl_distro_args(distro) {
        command.arg("-d").arg(name);
    }
    command.arg("--").arg("bash").arg("-lc").arg(script);
    no_window(&mut command);
    command
}

/// Build the clone/pull command for a repo. `kind` is `"download"` or `"update"`.
fn build_task_command(
    repo: &TrainingRepoStatus,
    kind: &str,
    env: &TrainingEnvSettings,
) -> AppResult<tokio::process::Command> {
    match repo.target.as_str() {
        "wsl" => {
            let path_expr = bash_path_expr(&repo.install_path);
            let script = match kind {
                "download" => format!(
                    "P={p}; mkdir -p \"$(dirname \"$P\")\" && git clone --progress {url} \"$P\"",
                    p = path_expr,
                    url = single_quote(&repo.git_url)
                ),
                "update" => format!(
                    "P={p}; cd \"$P\" && git pull --progress",
                    p = path_expr
                ),
                other => {
                    return Err(AppError::Validation(format!("Unknown repo task kind '{other}'")))
                }
            };
            Ok(build_wsl_task_command(&env.wsl_distro, &script))
        }
        _ => {
            let mut command = tokio::process::Command::new("git");
            match kind {
                "download" => {
                    command
                        .arg("clone")
                        .arg("--progress")
                        .arg(&repo.git_url)
                        .arg(&repo.install_path);
                }
                "update" => {
                    command
                        .arg("-C")
                        .arg(&repo.install_path)
                        .arg("pull")
                        .arg("--progress");
                }
                other => {
                    return Err(AppError::Validation(format!("Unknown repo task kind '{other}'")))
                }
            }
            no_window(&mut command);
            Ok(command)
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming task runner
// ─────────────────────────────────────────────────────────────────────────────

fn emit_state(app: &AppHandle, repo_id: &str, task_id: &str, kind: &str, status: &str, message: Option<String>) {
    let _ = app.emit(
        REPO_TASK_STATE_EVENT,
        RepoTaskStateEvent {
            repo_id: repo_id.to_string(),
            task_id: task_id.to_string(),
            kind: kind.to_string(),
            status: status.to_string(),
            message,
        },
    );
}

fn emit_log(app: &AppHandle, repo_id: &str, task_id: &str, line: &str) {
    let _ = app.emit(
        REPO_TASK_LOG_EVENT,
        RepoTaskLogEvent {
            repo_id: repo_id.to_string(),
            task_id: task_id.to_string(),
            line: line.to_string(),
            level: "info".to_string(),
        },
    );
}

async fn pump_stream<R>(app: AppHandle, reader: R, repo_id: String, task_id: String)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut reader = BufReader::new(reader);
    let mut chunk = [0_u8; 4096];
    let mut pending: Vec<u8> = Vec::with_capacity(512);

    loop {
        let read = match reader.read(&mut chunk).await {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => break,
        };
        for &byte in &chunk[..read] {
            if byte == b'\n' || byte == b'\r' {
                flush_pending(&app, &repo_id, &task_id, &mut pending);
            } else {
                pending.push(byte);
            }
        }
    }
    flush_pending(&app, &repo_id, &task_id, &mut pending);
}

fn flush_pending(app: &AppHandle, repo_id: &str, task_id: &str, pending: &mut Vec<u8>) {
    if pending.is_empty() {
        return;
    }
    let text = String::from_utf8_lossy(pending).into_owned();
    pending.clear();
    let trimmed = text.trim();
    if !trimmed.is_empty() {
        emit_log(app, repo_id, task_id, trimmed);
    }
}

/// Spawn a clone/pull task. Streams output via `repo-task-log`/`repo-task-state` events
/// and returns the generated `task_id` immediately.
pub async fn start_repo_task(
    app: AppHandle,
    state: AppState,
    repo: TrainingRepoStatus,
    kind: &str,
) -> AppResult<String> {
    let env = state.with_db(db::load_training_env)?;
    let task_id = new_entity_id("repotask");

    let mut command = build_task_command(&repo, kind, &env)?;
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    let mut child = command
        .spawn()
        .map_err(|error| AppError::Process(format!("Failed to start git task: {error}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Process("git stdout pipe unavailable".to_string()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Process("git stderr pipe unavailable".to_string()))?;

    let repo_task = RepoTask {
        task_id: task_id.clone(),
        child: Arc::new(tokio::sync::Mutex::new(child)),
    };
    state.insert_repo_task(repo_task.clone())?;

    emit_state(&app, &repo.id, &task_id, kind, "running", None);

    tauri::async_runtime::spawn(pump_stream(
        app.clone(),
        stdout,
        repo.id.clone(),
        task_id.clone(),
    ));
    tauri::async_runtime::spawn(pump_stream(
        app.clone(),
        stderr,
        repo.id.clone(),
        task_id.clone(),
    ));

    let wait_app = app.clone();
    let wait_state = state.clone();
    let wait_kind = kind.to_string();
    let wait_repo = repo.clone();
    let wait_task_id = task_id.clone();
    tauri::async_runtime::spawn(async move {
        let success = {
            let mut child = repo_task.child.lock().await;
            match child.wait().await {
                Ok(status) => status.success(),
                Err(_) => false,
            }
        };

        let _ = wait_state.remove_repo_task(&wait_task_id);

        if success {
            // Persist the resolved install path for the two main curated repos so the
            // trainer picks them up automatically.
            if wait_kind == "download" {
                let _ = persist_install_path(&wait_state, &wait_repo);
            }
            emit_state(&wait_app, &wait_repo.id, &wait_task_id, &wait_kind, "completed", None);
        } else {
            emit_state(
                &wait_app,
                &wait_repo.id,
                &wait_task_id,
                &wait_kind,
                "failed",
                Some("git 进程以非零状态退出".to_string()),
            );
        }
    });

    Ok(task_id)
}

fn persist_install_path(state: &AppState, repo: &TrainingRepoStatus) -> AppResult<()> {
    if repo.is_custom {
        return Ok(());
    }
    match repo.id.as_str() {
        "diffusion-pipe" | "sd-scripts" => {
            let mut env = state.with_db(db::load_training_env)?;
            match repo.id.as_str() {
                "diffusion-pipe" => env.diffusion_pipe_wsl_path = repo.install_path.clone(),
                "sd-scripts" => env.sd_scripts_path = repo.install_path.clone(),
                _ => {}
            }
            state.with_db(|connection| db::save_training_env(connection, &env))?;
            Ok(())
        }
        _ => Ok(()),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete / cancel
// ─────────────────────────────────────────────────────────────────────────────

pub async fn delete_repo(state: AppState, repo: TrainingRepoStatus) -> AppResult<()> {
    if repo.install_path.trim().is_empty() {
        return Err(AppError::Validation("Install path is empty".to_string()));
    }
    match repo.target.as_str() {
        "wsl" => {
            let env = state.with_db(db::load_training_env)?;
            let script = format!("P={p}; rm -rf \"$P\"", p = bash_path_expr(&repo.install_path));
            let mut command = build_wsl_task_command(&env.wsl_distro, &script);
            let status = command
                .status()
                .await
                .map_err(|error| AppError::Process(format!("Failed to delete repo: {error}")))?;
            if !status.success() {
                return Err(AppError::Process(
                    "Failed to remove WSL repository directory".to_string(),
                ));
            }
            Ok(())
        }
        _ => {
            let path = repo.install_path.clone();
            tokio::task::spawn_blocking(move || std::fs::remove_dir_all(&path))
                .await
                .map_err(|error| AppError::Process(format!("Delete task panicked: {error}")))?
                .map_err(AppError::from)?;
            Ok(())
        }
    }
}

pub async fn cancel_repo_task(state: &AppState, task_id: &str) -> AppResult<()> {
    if let Some(task) = state.repo_task(task_id)? {
        let mut child = task.child.lock().await;
        let _ = child.start_kill();
    }
    Ok(())
}
