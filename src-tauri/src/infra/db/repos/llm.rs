/**
 * @file infra/db/repos/llm.rs
 * @description llm_providers / llm_settings 表操作，合并原 llm_provider_db.rs。
 *   包含：供应商 CRUD、全局设置读写、旧版迁移、生效设置解析。
 */

use rusqlite::{params, Connection, OptionalExtension};

use crate::{
    error::{AppError, AppResult},
    models::{
        resolve_effective_llm_settings, EndpointKind, LlmGlobalSettings, LlmModelSource,
        LlmProvider, LlmProviderModelEntry, LlmProviderSummary, LlmSettings,
    },
    utils::{new_entity_id, now_ts},
};

// ---------------------------------------------------------------------------
// internal DTO
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LlmProviderConfigJson {
    name: String,
    endpoint_url: String,
    api_key: String,
    endpoint_kind: EndpointKind,
    models: Vec<LlmProviderModelEntry>,
}

// ---------------------------------------------------------------------------
// schema / migration
// ---------------------------------------------------------------------------

pub fn ensure_llm_provider_schema(connection: &Connection) -> AppResult<()> {
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS llm_providers (
            id TEXT PRIMARY KEY,
            config_json TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        ",
    )?;
    Ok(())
}

/// 从旧 llm_settings (LlmSettings 扁平格式) 迁移到 llm_providers + LlmGlobalSettings 格式。
pub fn migrate_llm_providers_if_needed(connection: &Connection) -> AppResult<()> {
    ensure_llm_provider_schema(connection)?;

    let count: i64 =
        connection.query_row("SELECT COUNT(*) FROM llm_providers", [], |row| row.get(0))?;
    if count > 0 {
        return Ok(());
    }

    let legacy_json = connection
        .query_row(
            "SELECT config_json FROM llm_settings WHERE id = 'global'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;

    let Some(legacy_json) = legacy_json else {
        return Ok(());
    };

    let legacy: LlmSettings = match serde_json::from_str(&legacy_json) {
        Ok(v) => v,
        Err(_) => {
            if let Ok(global) = serde_json::from_str::<LlmGlobalSettings>(&legacy_json) {
                if !global.active_provider_id.is_empty() {
                    return Ok(());
                }
            }
            return Ok(());
        }
    };

    if legacy.endpoint_url.trim().is_empty() {
        return Ok(());
    }

    let ts = now_ts();
    let provider_id = new_entity_id("llm");
    let model_id = legacy.model_id.trim();
    let models = if model_id.is_empty() {
        vec![]
    } else {
        vec![LlmProviderModelEntry {
            id: new_entity_id("mdl"),
            model_id: model_id.to_string(),
            label: None,
            source: LlmModelSource::Manual,
        }]
    };
    let provider = LlmProvider {
        id: provider_id.clone(),
        name: "Default".to_string(),
        endpoint_url: legacy.endpoint_url.clone(),
        api_key: legacy.api_key.clone(),
        endpoint_kind: legacy.endpoint_kind,
        models,
        created_at: ts,
        updated_at: ts,
    };
    insert_llm_provider(connection, &provider)?;

    let mut global = LlmGlobalSettings::default();
    global.ingest_behavior_from(&legacy);
    global.active_provider_id = provider_id;
    global.active_model_id = if model_id.is_empty() {
        "gpt-4o".to_string()
    } else {
        model_id.to_string()
    };
    save_llm_global_settings(connection, &global)?;

    Ok(())
}

// ---------------------------------------------------------------------------
// provider helpers
// ---------------------------------------------------------------------------

fn provider_from_row(id: &str, config_json: &str, created_at: i64, updated_at: i64) -> AppResult<LlmProvider> {
    let cfg: LlmProviderConfigJson = serde_json::from_str(config_json)?;
    Ok(LlmProvider {
        id: id.to_string(),
        name: cfg.name,
        endpoint_url: cfg.endpoint_url,
        api_key: cfg.api_key,
        endpoint_kind: cfg.endpoint_kind,
        models: cfg.models,
        created_at,
        updated_at,
    })
}

fn provider_to_config_json(provider: &LlmProvider) -> AppResult<String> {
    let cfg = LlmProviderConfigJson {
        name: provider.name.clone(),
        endpoint_url: provider.endpoint_url.clone(),
        api_key: provider.api_key.clone(),
        endpoint_kind: provider.endpoint_kind,
        models: provider.models.clone(),
    };
    Ok(serde_json::to_string(&cfg)?)
}

fn insert_llm_provider(connection: &Connection, provider: &LlmProvider) -> AppResult<()> {
    provider.validate().map_err(AppError::Validation)?;
    let config_json = provider_to_config_json(provider)?;
    let sort_order: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM llm_providers",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    connection.execute(
        "INSERT INTO llm_providers (id, config_json, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![provider.id, config_json, sort_order, provider.created_at, provider.updated_at],
    )?;
    Ok(())
}

fn update_llm_provider_row(connection: &Connection, provider: &LlmProvider) -> AppResult<()> {
    provider.validate().map_err(AppError::Validation)?;
    let config_json = provider_to_config_json(provider)?;
    let updated = connection.execute(
        "UPDATE llm_providers SET config_json = ?2, updated_at = ?3 WHERE id = ?1",
        params![provider.id, config_json, provider.updated_at],
    )?;
    if updated == 0 {
        return Err(AppError::NotFound(format!("LLM provider '{}' not found", provider.id)));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// public provider API
// ---------------------------------------------------------------------------

pub fn list_llm_providers(connection: &Connection) -> AppResult<Vec<LlmProviderSummary>> {
    migrate_llm_providers_if_needed(connection)?;
    let mut stmt = connection.prepare(
        "SELECT id, config_json, created_at, updated_at FROM llm_providers ORDER BY sort_order ASC, created_at ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (id, json, ca, ua) = row?;
        let provider = provider_from_row(&id, &json, ca, ua)?;
        out.push(provider.to_summary());
    }
    Ok(out)
}

pub fn get_llm_provider(connection: &Connection, provider_id: &str) -> AppResult<LlmProvider> {
    migrate_llm_providers_if_needed(connection)?;
    let row = connection
        .query_row(
            "SELECT id, config_json, created_at, updated_at FROM llm_providers WHERE id = ?1",
            params![provider_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?, row.get::<_, i64>(3)?)),
        )
        .map_err(|_| AppError::NotFound(format!("LLM provider '{provider_id}' not found")))?;
    let (id, json, ca, ua) = row;
    provider_from_row(&id, &json, ca, ua)
}

pub fn create_llm_provider(
    connection: &Connection,
    name: &str,
    endpoint_url: &str,
    api_key: &str,
    endpoint_kind: EndpointKind,
    initial_model_id: Option<&str>,
) -> AppResult<LlmProvider> {
    migrate_llm_providers_if_needed(connection)?;
    let ts = now_ts();
    let id = new_entity_id("llm");
    let mut models = Vec::new();
    if let Some(mid) = initial_model_id.map(str::trim).filter(|s| !s.is_empty()) {
        models.push(LlmProviderModelEntry {
            id: new_entity_id("mdl"),
            model_id: mid.to_string(),
            label: None,
            source: LlmModelSource::Manual,
        });
    }
    let provider = LlmProvider {
        id,
        name: name.trim().to_string(),
        endpoint_url: endpoint_url.trim().to_string(),
        api_key: api_key.to_string(),
        endpoint_kind,
        models,
        created_at: ts,
        updated_at: ts,
    };
    insert_llm_provider(connection, &provider)?;

    let global = load_llm_global_settings(connection)?;
    if global.active_provider_id.is_empty() {
        let mut next = global;
        next.active_provider_id = provider.id.clone();
        if let Some(first) = provider.models.first() {
            next.active_model_id = first.model_id.clone();
        }
        save_llm_global_settings(connection, &next)?;
    }
    Ok(provider)
}

pub fn update_llm_provider(
    connection: &Connection,
    provider_id: &str,
    name: &str,
    endpoint_url: &str,
    api_key: &str,
    endpoint_kind: EndpointKind,
) -> AppResult<LlmProvider> {
    let mut provider = get_llm_provider(connection, provider_id)?;
    provider.name = name.trim().to_string();
    provider.endpoint_url = endpoint_url.trim().to_string();
    if !api_key.trim().is_empty() {
        provider.api_key = api_key.to_string();
    }
    provider.endpoint_kind = endpoint_kind;
    provider.updated_at = now_ts();
    update_llm_provider_row(connection, &provider)?;
    Ok(provider)
}

pub fn delete_llm_provider(connection: &Connection, provider_id: &str) -> AppResult<()> {
    let deleted =
        connection.execute("DELETE FROM llm_providers WHERE id = ?1", params![provider_id])?;
    if deleted == 0 {
        return Err(AppError::NotFound(format!("LLM provider '{provider_id}' not found")));
    }
    let mut global = load_llm_global_settings(connection)?;
    if global.active_provider_id == provider_id {
        match list_llm_providers(connection) {
            Ok(list) if !list.is_empty() => {
                global.active_provider_id = list[0].id.clone();
                if let Ok(p) = get_llm_provider(connection, &global.active_provider_id) {
                    global.active_model_id = p.models.first().map(|m| m.model_id.clone()).unwrap_or_default();
                }
            }
            _ => {
                global.active_provider_id.clear();
                global.active_model_id.clear();
            }
        }
        save_llm_global_settings(connection, &global)?;
    }
    Ok(())
}

pub fn save_llm_provider_full(connection: &Connection, provider: &LlmProvider) -> AppResult<()> {
    update_llm_provider_row(connection, provider)
}

pub fn add_llm_provider_model(
    connection: &Connection,
    provider_id: &str,
    model_id: &str,
    label: Option<&str>,
    source: LlmModelSource,
) -> AppResult<LlmProvider> {
    let mut provider = get_llm_provider(connection, provider_id)?;
    let mid = model_id.trim();
    if mid.is_empty() {
        return Err(AppError::Validation("Model ID is required".to_string()));
    }
    if provider.models.iter().any(|m| m.model_id == mid) {
        return Err(AppError::Validation(format!("Model '{mid}' already exists for this provider")));
    }
    provider.models.push(LlmProviderModelEntry {
        id: new_entity_id("mdl"),
        model_id: mid.to_string(),
        label: label.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string),
        source,
    });
    provider.updated_at = now_ts();
    update_llm_provider_row(connection, &provider)?;
    Ok(provider)
}

pub fn update_llm_provider_model(
    connection: &Connection,
    provider_id: &str,
    entry_id: &str,
    model_id: Option<&str>,
    label: Option<&str>,
) -> AppResult<LlmProvider> {
    let mut provider = get_llm_provider(connection, provider_id)?;
    let entry = provider
        .models
        .iter_mut()
        .find(|m| m.id == entry_id)
        .ok_or_else(|| AppError::NotFound(format!("Model entry '{entry_id}' not found")))?;
    if let Some(mid) = model_id.map(str::trim).filter(|s| !s.is_empty()) {
        entry.model_id = mid.to_string();
    }
    if label.is_some() {
        entry.label = label.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    }
    provider.updated_at = now_ts();
    update_llm_provider_row(connection, &provider)?;
    Ok(provider)
}

pub fn delete_llm_provider_model(
    connection: &Connection,
    provider_id: &str,
    entry_id: &str,
) -> AppResult<LlmProvider> {
    let mut provider = get_llm_provider(connection, provider_id)?;
    let before = provider.models.len();
    provider.models.retain(|m| m.id != entry_id);
    if provider.models.len() == before {
        return Err(AppError::NotFound(format!("Model entry '{entry_id}' not found")));
    }
    provider.updated_at = now_ts();
    update_llm_provider_row(connection, &provider)?;

    let mut global = load_llm_global_settings(connection)?;
    if global.active_provider_id == provider_id
        && !provider.models.iter().any(|m| m.model_id == global.active_model_id)
    {
        global.active_model_id =
            provider.models.first().map(|m| m.model_id.clone()).unwrap_or_default();
        save_llm_global_settings(connection, &global)?;
    }
    Ok(provider)
}

pub fn set_active_llm_selection(
    connection: &Connection,
    provider_id: &str,
    model_id: &str,
) -> AppResult<LlmGlobalSettings> {
    let provider = get_llm_provider(connection, provider_id)?;
    let mid = model_id.trim();
    if !mid.is_empty() && !provider.models.iter().any(|m| m.model_id == mid) {
        return Err(AppError::Validation(format!(
            "Model '{mid}' is not registered for provider '{}'",
            provider.name
        )));
    }
    let mut global = load_llm_global_settings(connection)?;
    global.active_provider_id = provider_id.to_string();
    global.active_model_id = mid.to_string();
    save_llm_global_settings(connection, &global)?;
    Ok(global)
}

// ---------------------------------------------------------------------------
// global settings
// ---------------------------------------------------------------------------

pub fn load_llm_global_settings(connection: &Connection) -> AppResult<LlmGlobalSettings> {
    migrate_llm_providers_if_needed(connection)?;
    let maybe_json = connection
        .query_row(
            "SELECT config_json FROM llm_settings WHERE id = 'global'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    match maybe_json {
        Some(json) => {
            if json.contains("activeProviderId") {
                return Ok(serde_json::from_str(&json)?);
            }
            let legacy: LlmSettings = serde_json::from_str(&json)?;
            let mut global = LlmGlobalSettings::default();
            global.ingest_behavior_from(&legacy);
            Ok(global)
        }
        None => Ok(LlmGlobalSettings::default()),
    }
}

pub fn save_llm_global_settings(
    connection: &Connection,
    settings: &LlmGlobalSettings,
) -> AppResult<()> {
    settings.validate().map_err(AppError::Validation)?;
    let config_json = serde_json::to_string(settings)?;
    connection.execute(
        "
        INSERT INTO llm_settings (id, config_json, version, updated_at)
        VALUES ('global', ?1, 1, ?2)
        ON CONFLICT(id) DO UPDATE SET
            config_json = excluded.config_json,
            version = llm_settings.version + 1,
            updated_at = excluded.updated_at
        ",
        params![config_json, now_ts()],
    )?;
    Ok(())
}

pub fn resolve_effective_llm_settings_from_db(connection: &Connection) -> AppResult<LlmSettings> {
    migrate_llm_providers_if_needed(connection)?;
    let global = load_llm_global_settings(connection)?;
    let provider = if global.active_provider_id.trim().is_empty() {
        None
    } else {
        get_llm_provider(connection, &global.active_provider_id).ok()
    };
    Ok(resolve_effective_llm_settings(&global, provider.as_ref()))
}

// ---------------------------------------------------------------------------
// save_llm_settings (兼容旧 db::save_llm_settings 路径)
// ---------------------------------------------------------------------------

pub fn save_llm_settings(connection: &Connection, settings: &LlmSettings) -> AppResult<()> {
    migrate_llm_providers_if_needed(connection)?;
    let mut global = load_llm_global_settings(connection)?;
    global.ingest_behavior_from(settings);

    if !settings.active_provider_id.is_empty() {
        global.active_provider_id = settings.active_provider_id.clone();
    }
    if !settings.model_id.trim().is_empty() {
        global.active_model_id = settings.model_id.clone();
    }

    if !settings.endpoint_url.trim().is_empty() && !global.active_provider_id.is_empty() {
        if let Ok(mut provider) = get_llm_provider(connection, &global.active_provider_id) {
            provider.endpoint_url = settings.endpoint_url.clone();
            if !settings.api_key.trim().is_empty() {
                provider.api_key = settings.api_key.clone();
            }
            provider.endpoint_kind = settings.endpoint_kind;
            provider.updated_at = now_ts();
            if !settings.model_id.trim().is_empty()
                && !provider.models.iter().any(|m| m.model_id == settings.model_id)
            {
                provider.models.push(LlmProviderModelEntry {
                    id: new_entity_id("mdl"),
                    model_id: settings.model_id.clone(),
                    label: None,
                    source: LlmModelSource::Manual,
                });
            }
            save_llm_provider_full(connection, &provider)?;
        }
    }

    save_llm_global_settings(connection, &global)
}

pub fn mark_model_text_only_in_global(connection: &Connection, model_id: &str) -> AppResult<()> {
    let mut global = load_llm_global_settings(connection)?;
    if !global.text_only_model_ids.iter().any(|id| id == model_id) {
        global.text_only_model_ids.push(model_id.to_string());
        save_llm_global_settings(connection, &global)?;
    }
    Ok(())
}
