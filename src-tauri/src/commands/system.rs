use tauri::State;

use crate::{
    commands::respond,
    db,
    models::{ActiveJobSummary, SystemStats},
    state::AppState,
    trainer,
};

#[tauri::command]
pub fn get_system_stats(state: State<'_, AppState>) -> Result<SystemStats, String> {
    Ok(trainer::collect_system_stats(state.inner()))
}

#[tauri::command]
pub fn get_active_job(
    project_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<ActiveJobSummary>, String> {
    respond(state.with_db(|connection| db::get_active_job(connection, project_id.as_deref())))
}
