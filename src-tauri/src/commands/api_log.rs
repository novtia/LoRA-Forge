use tauri::State;

use crate::{models::ApiLogEntry, state::AppState};

#[tauri::command]
pub fn get_recent_api_logs(limit: Option<u32>, state: State<'_, AppState>) -> Vec<ApiLogEntry> {
    let n = limit.unwrap_or(200).clamp(1, 400) as usize;
    state.recent_api_logs(n)
}

#[tauri::command]
pub fn clear_api_logs(state: State<'_, AppState>) -> Result<(), String> {
    state.clear_api_logs();
    Ok(())
}
