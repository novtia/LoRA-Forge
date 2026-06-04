/**
 * @file commands/projects.rs
 * @description 项目命令边界：参数解构 → 调 services::project_service → respond()。
 */

use serde::Deserialize;
use tauri::State;

use crate::{commands::respond, services::project_service, state::AppState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    pub name: String,
    pub root_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectInput {
    pub project_id: String,
    pub name: String,
    pub root_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectInput {
    pub project_id: String,
}

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> Result<Vec<crate::models::ProjectRecord>, String> {
    respond(project_service::list_projects(state.inner().clone()))
}

#[tauri::command]
pub fn get_project(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<crate::models::ProjectRecord, String> {
    respond(project_service::get_project(state.inner().clone(), &project_id))
}

#[tauri::command]
pub fn create_project(
    input: CreateProjectInput,
    state: State<'_, AppState>,
) -> Result<crate::models::ProjectRecord, String> {
    respond(project_service::create_project(state.inner().clone(), &input.name, &input.root_path))
}

#[tauri::command]
pub fn update_lora_project(
    input: UpdateProjectInput,
    state: State<'_, AppState>,
) -> Result<crate::models::ProjectRecord, String> {
    respond(project_service::update_project(
        state.inner().clone(),
        &input.project_id,
        &input.name,
        &input.root_path,
    ))
}

#[tauri::command]
pub fn delete_lora_project(
    input: DeleteProjectInput,
    state: State<'_, AppState>,
) -> Result<(), String> {
    respond(project_service::delete_project(
        state.inner().clone(),
        &input.project_id,
    ))
}
