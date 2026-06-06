/**
 * @file commands/environment.rs
 * @description 训练环境管理命令：仓库列表/自定义增删、下载/更新/删除/取消（流式），以及本机环境只读巡检。
 */

use tauri::{AppHandle, State};

use crate::{
    commands::respond,
    db,
    infra::environment,
    models::{CustomRepoInput, EnvironmentReport, TrainingRepoStatus},
    state::AppState,
    trainer::repos,
};

// ── Repositories ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_training_repos(state: State<'_, AppState>) -> Result<Vec<TrainingRepoStatus>, String> {
    respond(repos::list_repos(state.inner()))
}

#[tauri::command]
pub fn add_custom_repo(
    input: CustomRepoInput,
    state: State<'_, AppState>,
) -> Result<Vec<TrainingRepoStatus>, String> {
    respond(repos::add_custom_repo(state.inner(), input))
}

#[tauri::command]
pub fn remove_custom_repo(
    repo_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<TrainingRepoStatus>, String> {
    respond(repos::remove_custom_repo(state.inner(), &repo_id))
}

#[tauri::command]
pub async fn download_repo(
    repo_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let app_state = state.inner().clone();
    let repo = match repos::resolve_repo(&app_state, &repo_id) {
        Ok(repo) => repo,
        Err(error) => return Err(error.to_string()),
    };
    respond(repos::start_repo_task(app, app_state, repo, "download").await)
}

#[tauri::command]
pub async fn update_repo(
    repo_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let app_state = state.inner().clone();
    let repo = match repos::resolve_repo(&app_state, &repo_id) {
        Ok(repo) => repo,
        Err(error) => return Err(error.to_string()),
    };
    respond(repos::start_repo_task(app, app_state, repo, "update").await)
}

#[tauri::command]
pub async fn delete_repo(repo_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let app_state = state.inner().clone();
    let repo = match repos::resolve_repo(&app_state, &repo_id) {
        Ok(repo) => repo,
        Err(error) => return Err(error.to_string()),
    };
    respond(repos::delete_repo(app_state, repo).await)
}

#[tauri::command]
pub async fn cancel_repo_task(task_id: String, state: State<'_, AppState>) -> Result<(), String> {
    respond(repos::cancel_repo_task(state.inner(), &task_id).await)
}

// ── Environment inspection ────────────────────────────────────────────────────

#[tauri::command]
pub fn inspect_environment(state: State<'_, AppState>) -> Result<EnvironmentReport, String> {
    let distro = state
        .with_db(db::load_training_env)
        .map(|env| env.wsl_distro)
        .unwrap_or_else(|_| "Ubuntu".to_string());
    Ok(environment::inspect(&distro))
}
