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
