use std::fs;

use serde::Deserialize;
use tauri::State;

use crate::{
    commands::respond,
    db,
    error::{AppError, AppResult},
    models::{ProjectRecord, ProjectStatus, TrainingConfig},
    state::AppState,
    utils::{directory_size, ensure_existing_dir, normalize_display_path, slugify},
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    pub name: String,
    pub root_path: String,
}

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> Result<Vec<ProjectRecord>, String> {
    respond(list_projects_inner(state.inner().clone()))
}

#[tauri::command]
pub fn get_project(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<ProjectRecord, String> {
    respond(get_project_inner(state.inner().clone(), &project_id))
}

#[tauri::command]
pub fn create_project(
    input: CreateProjectInput,
    state: State<'_, AppState>,
) -> Result<ProjectRecord, String> {
    respond(create_project_inner(state.inner().clone(), input))
}

fn list_projects_inner(state: AppState) -> AppResult<Vec<ProjectRecord>> {
    let mut projects = state.with_db(db::list_projects)?;
    for project in &mut projects {
        project.size_bytes = directory_size(std::path::Path::new(&project.root_path));
    }
    Ok(projects)
}

fn get_project_inner(state: AppState, project_id: &str) -> AppResult<ProjectRecord> {
    let mut project = state.with_db(|connection| db::get_project(connection, project_id))?;
    project.size_bytes = directory_size(std::path::Path::new(&project.root_path));
    Ok(project)
}

fn create_project_inner(state: AppState, input: CreateProjectInput) -> AppResult<ProjectRecord> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("Project name is required".to_string()));
    }

    let selected_root = ensure_existing_dir(std::path::Path::new(&input.root_path))?;
    let mut project_id = slugify(name);
    let mut project_root = selected_root.join(&project_id);
    if project_root.exists() {
        project_id = format!("{}-{}", project_id, crate::utils::now_ts());
        project_root = selected_root.join(&project_id);
    }

    let dataset_path = project_root.join("dataset");
    let output_path = project_root.join("output");

    fs::create_dir_all(&dataset_path)?;
    fs::create_dir_all(&output_path)?;

    let default_config = TrainingConfig::default();
    let project = ProjectRecord {
        id: project_id,
        name: name.to_string(),
        root_path: normalize_display_path(&project_root),
        dataset_path: normalize_display_path(&dataset_path),
        output_path: normalize_display_path(&output_path),
        status: ProjectStatus::Ready,
        tags: default_config.summary_tags(),
        size_bytes: 0,
        updated_at: crate::utils::now_ts(),
    };

    state.with_db(|connection| {
        db::insert_project(connection, &project)?;
        db::save_training_config(connection, &project.id, &default_config)?;
        Ok(())
    })?;

    get_project_inner(state, &project.id)
}
