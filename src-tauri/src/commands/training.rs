use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::{
    commands::respond,
    db,
    error::{AppError, AppResult},
    models::{ActiveJobSummary, TrainingConfig},
    state::AppState,
    trainer,
    utils::{newest_file_with_extension, normalize_display_path},
};

/// Plain 「开始训练」 must not silently load checkpoints that live under another
/// project tree. If `network_weights` / `--resume` points outside this project's
/// `root_path`, drop it and persist (external init LoRA: copy or symlink under the project root).
fn clear_foreign_checkpoint_paths(project_root: &str, config: &mut TrainingConfig) -> bool {
    let mut changed = false;
    if trim_path_if_outside_project(project_root, &mut config.network_weights) {
        changed = true;
    }
    if trim_path_if_outside_project(project_root, &mut config.resume) {
        changed = true;
    }
    changed
}

/// Returns true if the value was cleared (was non-empty and resolved outside project root).
fn trim_path_if_outside_project(project_root: &str, path_field: &mut String) -> bool {
    let trimmed = path_field.trim();
    if trimmed.is_empty() {
        return false;
    }
    let Ok(root_canon) = fs::canonicalize(Path::new(project_root)) else {
        return false;
    };
    let candidate = Path::new(trimmed);
    let Ok(target_canon) = fs::canonicalize(candidate) else {
        return false;
    };
    if target_canon.starts_with(&root_canon) {
        return false;
    }
    path_field.clear();
    true
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCheckpointInput {
    pub project_id: String,
    pub destination_path: Option<String>,
}

#[tauri::command]
pub async fn start_training(
    project_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ActiveJobSummary, String> {
    respond(start_training_inner(app, state.inner().clone(), &project_id).await)
}

#[tauri::command]
pub async fn pause_training(
    project_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ActiveJobSummary, String> {
    respond(trainer::pause_training(app, state.inner().clone(), &project_id).await)
}

#[tauri::command]
pub async fn resume_training(
    project_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ActiveJobSummary, String> {
    respond(trainer::resume_training(app, state.inner().clone(), &project_id).await)
}

#[tauri::command]
pub async fn abort_training(
    project_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ActiveJobSummary, String> {
    respond(trainer::abort_training(app, state.inner().clone(), &project_id).await)
}

/// Latest `.safetensors` file in the project output folder (non-recursive), by filesystem mtime.
#[tauri::command]
pub fn get_latest_output_checkpoint(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    respond(get_latest_output_checkpoint_inner(state.inner().clone(), &project_id))
}

/// Points `network_weights` at the newest output checkpoint, clears `resume`, saves config, then starts training.
#[tauri::command]
pub async fn start_training_from_latest_weights(
    project_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ActiveJobSummary, String> {
    respond(
        start_training_from_latest_weights_inner(app, state.inner().clone(), &project_id).await,
    )
}

#[tauri::command]
pub fn export_checkpoint(
    input: ExportCheckpointInput,
    state: State<'_, AppState>,
) -> Result<String, String> {
    respond(export_checkpoint_inner(
        state.inner().clone(),
        &input.project_id,
        input.destination_path.as_deref(),
    ))
}

fn get_latest_output_checkpoint_inner(state: AppState, project_id: &str) -> AppResult<Option<String>> {
    let project = state.with_db(|connection| db::get_project(connection, project_id))?;
    let output_dir = PathBuf::from(&project.output_path);
    let latest = newest_file_with_extension(&output_dir, "safetensors")?;
    Ok(latest.map(|path| normalize_display_path(&path)))
}

async fn start_training_from_latest_weights_inner(
    app: AppHandle,
    state: AppState,
    project_id: &str,
) -> AppResult<ActiveJobSummary> {
    let (project, mut config) = state.with_db(|connection| {
        Ok((
            db::get_project(connection, project_id)?,
            db::load_training_config(connection, project_id)?,
        ))
    })?;

    let output_dir = PathBuf::from(&project.output_path);
    let latest = newest_file_with_extension(&output_dir, "safetensors")?.ok_or_else(|| {
        AppError::NotFound(format!(
            "No .safetensors weights found in output folder for '{}'",
            project.name
        ))
    })?;

    let path_str = normalize_display_path(&latest);
    config.network_weights = path_str;
    config.resume.clear();

    config.validate().map_err(AppError::Validation)?;

    state.with_db(|connection| db::save_training_config(connection, project_id, &config))?;

    trainer::start_training(app, state, project, config).await
}

async fn start_training_inner(
    app: AppHandle,
    state: AppState,
    project_id: &str,
) -> AppResult<ActiveJobSummary> {
    let (project, mut config) = state.with_db(|connection| {
        Ok((
            db::get_project(connection, project_id)?,
            db::load_training_config(connection, project_id)?,
        ))
    })?;

    if clear_foreign_checkpoint_paths(&project.root_path, &mut config) {
        state.with_db(|connection| db::save_training_config(connection, project_id, &config))?;
    }

    config.validate().map_err(AppError::Validation)?;

    trainer::start_training(app, state, project, config).await
}

fn export_checkpoint_inner(
    state: AppState,
    project_id: &str,
    destination_path: Option<&str>,
) -> AppResult<String> {
    let project = state.with_db(|connection| db::get_project(connection, project_id))?;
    let output_dir = PathBuf::from(&project.output_path);
    let source = newest_file_with_extension(&output_dir, "safetensors")?.ok_or_else(|| {
        AppError::NotFound(format!("No checkpoints found for '{}'", project.name))
    })?;

    let exports_dir = output_dir.join("exports");
    fs::create_dir_all(&exports_dir)?;

    let destination = match destination_path {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => exports_dir.join(
            source
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("export.safetensors"),
        ),
    };

    fs::copy(&source, &destination)?;
    Ok(destination.to_string_lossy().to_string())
}
