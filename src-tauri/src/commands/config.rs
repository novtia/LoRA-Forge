use serde::Deserialize;
use tauri::State;

use crate::{
    commands::respond,
    db,
    error::{AppError, AppResult},
    models::{LlmSettings, TrainingConfig, TrainingEnvSettings},
    state::AppState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTrainingConfigInput {
    pub project_id: String,
    pub config: TrainingConfig,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTrainingEnvInput {
    pub settings: TrainingEnvSettings,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLlmSettingsInput {
    pub settings: LlmSettings,
}

#[tauri::command]
pub fn load_training_config(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<TrainingConfig, String> {
    respond(load_training_config_inner(
        state.inner().clone(),
        &project_id,
    ))
}

#[tauri::command]
pub fn save_training_config(
    input: SaveTrainingConfigInput,
    state: State<'_, AppState>,
) -> Result<TrainingConfig, String> {
    respond(save_training_config_inner(
        state.inner().clone(),
        &input.project_id,
        input.config,
    ))
}

#[tauri::command]
pub fn load_training_env(state: State<'_, AppState>) -> Result<TrainingEnvSettings, String> {
    respond(state.with_db(db::load_training_env))
}

#[tauri::command]
pub fn save_training_env(
    input: SaveTrainingEnvInput,
    state: State<'_, AppState>,
) -> Result<TrainingEnvSettings, String> {
    let settings = input.settings;
    respond(
        state
            .with_db(|connection| db::save_training_env(connection, &settings))
            .map(|()| settings),
    )
}

#[tauri::command]
pub fn load_llm_settings(state: State<'_, AppState>) -> Result<LlmSettings, String> {
    respond(load_llm_settings_inner(state.inner().clone()))
}

#[tauri::command]
pub fn save_llm_settings(
    input: SaveLlmSettingsInput,
    state: State<'_, AppState>,
) -> Result<LlmSettings, String> {
    respond(save_llm_settings_inner(
        state.inner().clone(),
        input.settings,
    ))
}

fn load_training_config_inner(state: AppState, project_id: &str) -> AppResult<TrainingConfig> {
    state.with_db(|connection| {
        db::get_project(connection, project_id)?;
        db::load_training_config(connection, project_id)
    })
}

fn save_training_config_inner(
    state: AppState,
    project_id: &str,
    config: TrainingConfig,
) -> AppResult<TrainingConfig> {
    config.validate().map_err(AppError::Validation)?;

    state.with_db(|connection| {
        db::get_project(connection, project_id)?;
        db::save_training_config(connection, project_id, &config)?;
        db::update_project_tags(connection, project_id, &config.summary_tags())?;
        Ok(())
    })?;

    Ok(config)
}

fn load_llm_settings_inner(state: AppState) -> AppResult<LlmSettings> {
    state.with_db(db::load_llm_settings)
}

fn save_llm_settings_inner(state: AppState, settings: LlmSettings) -> AppResult<LlmSettings> {
    settings.validate().map_err(AppError::Validation)?;

    state.with_db(|connection| db::save_llm_settings(connection, &settings))?;

    Ok(settings)
}
