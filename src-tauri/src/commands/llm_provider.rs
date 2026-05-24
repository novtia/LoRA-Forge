use serde::Deserialize;
use tauri::State;

use crate::{
    commands::respond,
    error::AppResult,
    llm::models_list,
    llm_provider_db,
    models::{LlmGlobalSettings, LlmProvider, LlmProviderSummary},
    state::AppState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLlmProviderInput {
    pub name: String,
    pub endpoint_url: String,
    pub api_key: String,
    pub endpoint_kind: crate::models::EndpointKind,
    pub initial_model_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLlmProviderInput {
    pub provider_id: String,
    pub name: String,
    pub endpoint_url: String,
    pub api_key: String,
    pub endpoint_kind: crate::models::EndpointKind,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderIdInput {
    pub provider_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddLlmProviderModelInput {
    pub provider_id: String,
    pub model_id: String,
    pub label: Option<String>,
    pub source: Option<crate::models::LlmModelSource>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchLlmProviderModelsInput {
    pub provider_id: String,
    pub endpoint_url: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLlmProviderModelInput {
    pub provider_id: String,
    pub entry_id: String,
    pub model_id: Option<String>,
    pub label: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteLlmProviderModelInput {
    pub provider_id: String,
    pub entry_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetActiveLlmSelectionInput {
    pub provider_id: String,
    pub model_id: String,
}

#[tauri::command]
pub fn list_llm_providers(state: State<'_, AppState>) -> Result<Vec<LlmProviderSummary>, String> {
    respond(state.with_db(llm_provider_db::list_llm_providers))
}

#[tauri::command]
pub fn get_llm_provider(
    provider_id: String,
    state: State<'_, AppState>,
) -> Result<LlmProvider, String> {
    respond(
        state.with_db(|connection| llm_provider_db::get_llm_provider(connection, &provider_id)),
    )
}

#[tauri::command]
pub fn create_llm_provider(
    input: CreateLlmProviderInput,
    state: State<'_, AppState>,
) -> Result<LlmProvider, String> {
    respond(state.with_db(|connection| {
        llm_provider_db::create_llm_provider(
            connection,
            &input.name,
            &input.endpoint_url,
            &input.api_key,
            input.endpoint_kind,
            input.initial_model_id.as_deref(),
        )
    }))
}

#[tauri::command]
pub fn update_llm_provider(
    input: UpdateLlmProviderInput,
    state: State<'_, AppState>,
) -> Result<LlmProvider, String> {
    respond(state.with_db(|connection| {
        llm_provider_db::update_llm_provider(
            connection,
            &input.provider_id,
            &input.name,
            &input.endpoint_url,
            &input.api_key,
            input.endpoint_kind,
        )
    }))
}

#[tauri::command]
pub fn delete_llm_provider(
    input: ProviderIdInput,
    state: State<'_, AppState>,
) -> Result<(), String> {
    respond(state.with_db(|connection| {
        llm_provider_db::delete_llm_provider(connection, &input.provider_id)
    }))
}

#[tauri::command]
pub fn add_llm_provider_model(
    input: AddLlmProviderModelInput,
    state: State<'_, AppState>,
) -> Result<LlmProvider, String> {
    respond(state.with_db(|connection| {
        llm_provider_db::add_llm_provider_model(
            connection,
            &input.provider_id,
            &input.model_id,
            input.label.as_deref(),
            input.source.unwrap_or(crate::models::LlmModelSource::Manual),
        )
    }))
}

#[tauri::command]
pub fn update_llm_provider_model(
    input: UpdateLlmProviderModelInput,
    state: State<'_, AppState>,
) -> Result<LlmProvider, String> {
    respond(state.with_db(|connection| {
        llm_provider_db::update_llm_provider_model(
            connection,
            &input.provider_id,
            &input.entry_id,
            input.model_id.as_deref(),
            input.label.as_deref(),
        )
    }))
}

#[tauri::command]
pub fn delete_llm_provider_model(
    input: DeleteLlmProviderModelInput,
    state: State<'_, AppState>,
) -> Result<LlmProvider, String> {
    respond(state.with_db(|connection| {
        llm_provider_db::delete_llm_provider_model(
            connection,
            &input.provider_id,
            &input.entry_id,
        )
    }))
}

#[tauri::command]
pub async fn fetch_llm_provider_models(
    input: FetchLlmProviderModelsInput,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    respond(
        fetch_llm_provider_models_inner(
            state.inner().clone(),
            &input.provider_id,
            input.endpoint_url.as_deref(),
            input.api_key.as_deref(),
        )
        .await,
    )
}

async fn fetch_llm_provider_models_inner(
    state: AppState,
    provider_id: &str,
    endpoint_url: Option<&str>,
    api_key: Option<&str>,
) -> AppResult<Vec<String>> {
    let provider = state.with_db(|connection| {
        llm_provider_db::get_llm_provider(connection, provider_id)
    })?;
    let url = endpoint_url
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(provider.endpoint_url.as_str());
    let key = api_key.unwrap_or(provider.api_key.as_str());
    models_list::fetch_remote_model_ids(url, key).await
}

#[tauri::command]
pub fn set_active_llm_selection(
    input: SetActiveLlmSelectionInput,
    state: State<'_, AppState>,
) -> Result<LlmGlobalSettings, String> {
    respond(state.with_db(|connection| {
        llm_provider_db::set_active_llm_selection(
            connection,
            &input.provider_id,
            &input.model_id,
        )
    }))
}
