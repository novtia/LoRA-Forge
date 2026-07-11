use rusqlite::params;
use serde::{Deserialize, Deserializer, Serialize};

use crate::agent_error::{AppError, AppResult};
use crate::data::db::DbConn;

pub const KEY_DEFAULT_RATIO: &str = "default_aspect_ratio";
pub const KEY_DEFAULT_SIZE: &str = "default_image_size";
pub const KEY_SYSTEM_PROMPT: &str = "system_prompt";
pub const KEY_TEMPERATURE: &str = "temperature";
pub const KEY_TOP_P: &str = "top_p";
pub const KEY_MAX_TOKENS: &str = "max_tokens";
pub const KEY_FREQ_PENALTY: &str = "frequency_penalty";
pub const KEY_PRES_PENALTY: &str = "presence_penalty";
pub const KEY_HISTORY_TURNS: &str = "history_turns";

pub const DEFAULT_HISTORY_TURNS: i64 = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelParamSettings {
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub max_tokens: Option<i64>,
    pub frequency_penalty: Option<f64>,
    pub presence_penalty: Option<f64>,
    /// When `Some(true)`, request extended reasoning where the provider
    /// supports it (OpenAI: `reasoning_effort`; Claude: `output_config.effort`).
    #[serde(default)]
    pub thinking_enabled: Option<bool>,
    /// Provider-specific effort level, e.g. `low` / `medium` / `high` / `max`.
    /// When enabled and unset, backends default to `high`.
    #[serde(default)]
    pub thinking_effort: Option<String>,
}

impl ModelParamSettings {
    /// Effort string to send upstream when thinking is enabled.
    pub fn resolved_thinking_effort(&self) -> Option<String> {
        if !self.thinking_enabled.unwrap_or(false) {
            return None;
        }
        let effort = self
            .thinking_effort
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        Some(effort.unwrap_or_else(|| "high".into()))
    }
}

impl Default for ModelParamSettings {
    fn default() -> Self {
        Self {
            temperature: None,
            top_p: None,
            max_tokens: None,
            frequency_penalty: None,
            presence_penalty: None,
            thinking_enabled: None,
            thinking_effort: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelServiceModel {
    pub id: String,
    pub name: String,
    pub group: String,
    pub capabilities: Vec<String>,
    /// Max context window (tokens) when known; persisted for user-defined models in settings JSON.
    #[serde(default)]
    pub context_window: Option<i64>,
}

fn default_enabled() -> bool {
    true
}

fn default_provider_sdk() -> String {
    crate::ai::providers::OPENAI_SDK.into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelProvider {
    pub id: String,
    pub name: String,
    #[serde(default = "default_provider_sdk")]
    pub sdk: String,
    #[serde(default)]
    pub avatar: String,
    pub endpoint: String,
    pub api_key: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub models: Vec<ModelServiceModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub api_key: String,
    pub endpoint: String,
    pub model: String,
    pub active_provider_id: String,
    pub model_services: Vec<ModelProvider>,
    pub default_aspect_ratio: String,
    pub default_image_size: String,
    pub system_prompt: String,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub max_tokens: Option<i64>,
    pub frequency_penalty: Option<f64>,
    pub presence_penalty: Option<f64>,
    /// Number of prior messages (user + assistant, oldest dropped first)
    /// to include as multi-turn context. 0 disables history.
    pub history_turns: i64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            endpoint: String::new(),
            model: String::new(),
            active_provider_id: String::new(),
            model_services: Vec::new(),
            default_aspect_ratio: String::new(),
            default_image_size: String::new(),
            system_prompt: String::new(),
            temperature: None,
            top_p: None,
            max_tokens: None,
            frequency_penalty: None,
            presence_penalty: None,
            history_turns: DEFAULT_HISTORY_TURNS,
        }
    }
}

/// Marker type for patch fields:
/// - field absent → `Unset` (don't touch persistent value)
/// - field present with `null` → `Set(None)` (clear stored value)
/// - field present with a value → `Set(Some(v))`
#[derive(Debug, Clone, Default)]
pub enum Patchable<T> {
    #[default]
    Unset,
    Set(Option<T>),
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Patchable<T> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(Patchable::Set(Option::<T>::deserialize(d)?))
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SettingsPatch {
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub endpoint: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub active_provider_id: Option<String>,
    #[serde(default)]
    pub model_services: Option<Vec<ModelProvider>>,
    #[serde(default)]
    pub default_aspect_ratio: Option<String>,
    #[serde(default)]
    pub default_image_size: Option<String>,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub temperature: Patchable<f64>,
    #[serde(default)]
    pub top_p: Patchable<f64>,
    #[serde(default)]
    pub max_tokens: Patchable<i64>,
    #[serde(default)]
    pub frequency_penalty: Patchable<f64>,
    #[serde(default)]
    pub presence_penalty: Patchable<f64>,
    #[serde(default)]
    pub history_turns: Option<i64>,
}

pub fn write_kv(conn: &DbConn, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn active_provider(s: &Settings) -> Option<&ModelProvider> {
    if let Some(p) = s
        .model_services
        .iter()
        .find(|p| p.id == s.active_provider_id)
    {
        if p.enabled {
            return Some(p);
        }
    }
    s.model_services
        .iter()
        .find(|p| p.enabled)
        .or_else(|| s.model_services.first())
}

pub fn validate_model_param_settings(p: &ModelParamSettings) -> AppResult<()> {
    validate_optional_f64(p.temperature, "temperature")?;
    validate_optional_f64(p.top_p, "top_p")?;
    validate_optional_f64(p.frequency_penalty, "frequency_penalty")?;
    validate_optional_f64(p.presence_penalty, "presence_penalty")?;
    if let Some(n) = p.max_tokens {
        if n < 0 {
            return Err(AppError::Invalid("max_tokens must be non-negative".into()));
        }
    }
    if let Some(ref s) = p.thinking_effort {
        if s.trim().is_empty() {
            return Err(AppError::Invalid(
                "thinking_effort must not be empty when set".into(),
            ));
        }
    }
    Ok(())
}

fn validate_optional_f64(value: Option<f64>, label: &str) -> AppResult<()> {
    if value.map(|n| !n.is_finite()).unwrap_or(false) {
        return Err(AppError::Invalid(format!("{label} must be finite")));
    }
    Ok(())
}

pub fn apply_agent_local_patch(conn: &DbConn, patch: SettingsPatch) -> AppResult<()> {
    if patch.api_key.is_some()
        || patch.endpoint.is_some()
        || patch.model.is_some()
        || patch.active_provider_id.is_some()
        || patch.model_services.is_some()
    {
        return Err(AppError::Invalid(
            "LLM provider settings are managed by lora-forge; edit them in Design Settings".into(),
        ));
    }
    if let Some(v) = patch.default_aspect_ratio {
        write_kv(conn, KEY_DEFAULT_RATIO, &v)?;
    }
    if let Some(v) = patch.default_image_size {
        write_kv(conn, KEY_DEFAULT_SIZE, &v)?;
    }
    if let Some(v) = patch.system_prompt {
        write_kv(conn, KEY_SYSTEM_PROMPT, &v)?;
    }
    write_optional_f64(conn, KEY_TEMPERATURE, &patch.temperature, "temperature")?;
    write_optional_f64(conn, KEY_TOP_P, &patch.top_p, "top_p")?;
    write_optional_i64(conn, KEY_MAX_TOKENS, &patch.max_tokens, "max_tokens")?;
    write_optional_f64(
        conn,
        KEY_FREQ_PENALTY,
        &patch.frequency_penalty,
        "frequency_penalty",
    )?;
    write_optional_f64(
        conn,
        KEY_PRES_PENALTY,
        &patch.presence_penalty,
        "presence_penalty",
    )?;
    if let Some(n) = patch.history_turns {
        if n < 0 {
            return Err(AppError::Invalid("history_turns 必须是非负整数".into()));
        }
        write_kv(conn, KEY_HISTORY_TURNS, &n.to_string())?;
    }
    Ok(())
}

fn write_optional_f64(
    conn: &DbConn,
    key: &str,
    value: &Patchable<f64>,
    label: &str,
) -> AppResult<()> {
    match value {
        Patchable::Unset => Ok(()),
        Patchable::Set(None) => write_kv(conn, key, ""),
        Patchable::Set(Some(n)) => {
            if !n.is_finite() {
                return Err(AppError::Invalid(format!("{label} 必须是有限数值")));
            }
            write_kv(conn, key, &n.to_string())
        }
    }
}

fn write_optional_i64(
    conn: &DbConn,
    key: &str,
    value: &Patchable<i64>,
    label: &str,
) -> AppResult<()> {
    match value {
        Patchable::Unset => Ok(()),
        Patchable::Set(None) => write_kv(conn, key, ""),
        Patchable::Set(Some(n)) => {
            if *n < 0 {
                return Err(AppError::Invalid(format!("{label} 必须是非负整数")));
            }
            write_kv(conn, key, &n.to_string())
        }
    }
}
