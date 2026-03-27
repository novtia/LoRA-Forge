use std::{fs, path::PathBuf};

use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::{
    commands::respond,
    db,
    error::{AppError, AppResult},
    models::ActiveJobSummary,
    state::AppState,
    trainer,
    utils::newest_file_with_extension,
};

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

async fn start_training_inner(
    app: AppHandle,
    state: AppState,
    project_id: &str,
) -> AppResult<ActiveJobSummary> {
    let (project, config) = state.with_db(|connection| {
        Ok((
            db::get_project(connection, project_id)?,
            db::load_training_config(connection, project_id)?,
        ))
    })?;

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
