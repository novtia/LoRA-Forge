/**
 * @file commands/settings.rs
 * @description 配置相关命令：训练配置/环境、LLM 设置、百度翻译设置（原 config.rs + baidu_translate.rs 合并）。
 */

use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Deserialize;
use serde_json::Value;
use tauri::State;

use crate::{
    commands::respond,
    db,
    error::{AppError, AppResult},
    models::{BaiduTranslateSettings, LlmSettings, TrainingConfig, TrainingEnvSettings},
    state::AppState,
};

// ── Input DTOs ────────────────────────────────────────────────────────────────

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBaiduTranslateInput {
    pub settings: BaiduTranslateSettings,
}

// ── Training config commands ──────────────────────────────────────────────────

#[tauri::command]
pub fn load_training_config(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<TrainingConfig, String> {
    respond(load_training_config_inner(state.inner().clone(), &project_id))
}

#[tauri::command]
pub fn save_training_config(
    input: SaveTrainingConfigInput,
    state: State<'_, AppState>,
) -> Result<TrainingConfig, String> {
    respond(save_training_config_inner(state.inner().clone(), &input.project_id, input.config))
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
    respond(state.with_db(|connection| db::save_training_env(connection, &settings)).map(|()| settings))
}

// ── LLM settings commands ─────────────────────────────────────────────────────

#[tauri::command]
pub fn load_llm_settings(state: State<'_, AppState>) -> Result<LlmSettings, String> {
    respond(state.with_db(db::load_llm_settings))
}

#[tauri::command]
pub fn save_llm_settings(
    input: SaveLlmSettingsInput,
    state: State<'_, AppState>,
) -> Result<LlmSettings, String> {
    respond(save_llm_settings_inner(state.inner().clone(), input.settings))
}

// ── File IO commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read '{}': {}", path, e))
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content.as_bytes()).map_err(|e| format!("Failed to write '{}': {}", path, e))
}

// ── Baidu translate commands ──────────────────────────────────────────────────

const BAIDU_TRANSLATE_URL: &str = "https://fanyi-api.baidu.com/api/trans/vip/translate";

#[tauri::command]
pub fn load_baidu_translate_settings(
    state: State<'_, AppState>,
) -> Result<BaiduTranslateSettings, String> {
    respond(state.with_db(db::load_baidu_translate_settings))
}

#[tauri::command]
pub fn save_baidu_translate_settings(
    input: SaveBaiduTranslateInput,
    state: State<'_, AppState>,
) -> Result<BaiduTranslateSettings, String> {
    let settings = input.settings;
    respond(
        state
            .with_db(|connection| db::save_baidu_translate_settings(connection, &settings))
            .map(|()| settings),
    )
}

#[tauri::command]
pub async fn baidu_translate(
    text: String,
    from: Option<String>,
    to: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    let settings = state.with_db(db::load_baidu_translate_settings).map_err(|e| e.to_string())?;
    if settings.app_id.trim().is_empty() || settings.secret_key.trim().is_empty() {
        return Err("未配置百度翻译：请在「设计」→「LLM」→「API 配置」中填写 App ID 与密钥。".to_string());
    }
    let app_state = state.inner().clone();
    let from_lang = from.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| "auto".to_string());
    let to_lang = to.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| "zh".to_string());
    translate_baidu_request(trimmed, &from_lang, &to_lang, &settings, Some(&app_state)).await
}

// ── inner helpers ─────────────────────────────────────────────────────────────

fn load_training_config_inner(state: AppState, project_id: &str) -> AppResult<TrainingConfig> {
    state.with_db(|connection| {
        db::get_project(connection, project_id)?;
        db::load_training_config(connection, project_id)
    })
}

fn save_training_config_inner(state: AppState, project_id: &str, config: TrainingConfig) -> AppResult<TrainingConfig> {
    config.validate().map_err(AppError::Validation)?;
    state.with_db(|connection| {
        db::get_project(connection, project_id)?;
        db::save_training_config(connection, project_id, &config)?;
        db::update_project_tags(connection, project_id, &config.summary_tags())?;
        Ok(())
    })?;
    Ok(config)
}

fn save_llm_settings_inner(state: AppState, settings: LlmSettings) -> AppResult<LlmSettings> {
    settings.validate().map_err(AppError::Validation)?;
    state.with_db(|connection| db::save_llm_settings(connection, &settings))?;
    state.with_db(db::load_llm_settings)
}

async fn translate_baidu_request(
    query: &str,
    from: &str,
    to: &str,
    settings: &BaiduTranslateSettings,
    log_sink: Option<&AppState>,
) -> Result<String, String> {
    if let Some(st) = log_sink {
        st.push_api_log("baidu_translate", "info", format!("POST translate · {}→{} · chars={}", from, to, query.chars().count()));
    }
    let appid = settings.app_id.trim();
    let secret = settings.secret_key.trim();
    let salt = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| (d.as_micros() as u64 % 900_000_000) + 100_000_000).unwrap_or(987_654_321);
    let salt_str = salt.to_string();
    let sign_source = format!("{}{}{}{}", appid, query, salt_str, secret);
    let digest = md5::compute(sign_source.as_bytes());
    let sign = format!("{:x}", digest);
    let client = reqwest::Client::new();
    let response = match client.post(BAIDU_TRANSLATE_URL).form(&[("q", query), ("from", from), ("to", to), ("appid", appid), ("salt", salt_str.as_str()), ("sign", sign.as_str())]).send().await {
        Ok(r) => r,
        Err(e) => {
            let msg = format!("Baidu translate request failed: {e}");
            if let Some(st) = log_sink { st.push_api_log("baidu_translate", "error", msg.clone()); }
            return Err(msg);
        }
    };
    let status = response.status();
    let body: Value = match response.json().await {
        Ok(v) => v,
        Err(e) => {
            let msg = format!("Baidu translate: invalid JSON ({status}): {e}");
            if let Some(st) = log_sink { st.push_api_log("baidu_translate", "error", msg.clone()); }
            return Err(msg);
        }
    };
    if let Some(code) = body.get("error_code") {
        let code_str = match code { Value::String(s) => s.clone(), _ => code.to_string() };
        let msg_str = body.get("error_msg").and_then(|v| v.as_str()).unwrap_or("unknown error");
        let err_line = format!("Baidu translate error {code_str}: {msg_str}");
        if let Some(st) = log_sink { st.push_api_log("baidu_translate", "error", err_line.clone()); }
        return Err(err_line);
    }
    let items = match body.get("trans_result").and_then(|v| v.as_array()) {
        Some(arr) => arr,
        None => {
            let msg = "Baidu translate: missing trans_result".to_string();
            if let Some(st) = log_sink { st.push_api_log("baidu_translate", "error", msg.clone()); }
            return Err(msg);
        }
    };
    let mut out = String::new();
    for item in items {
        if let Some(dst) = item.get("dst").and_then(|v| v.as_str()) {
            if !out.is_empty() { out.push('\n'); }
            out.push_str(dst);
        }
    }
    if out.is_empty() {
        let msg = "Baidu translate: empty translation".to_string();
        if let Some(st) = log_sink { st.push_api_log("baidu_translate", "error", msg.clone()); }
        return Err(msg);
    }
    if let Some(st) = log_sink {
        st.push_api_log("baidu_translate", "info", format!("响应 OK · segments={} · chars={}", items.len(), out.chars().count()));
    }
    Ok(out)
}
