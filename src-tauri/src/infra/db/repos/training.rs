/**
 * @file infra/db/repos/training.rs
 * @description training_configs / training_env_settings / diffusion_pipe_configs 表 CRUD。
 */
use rusqlite::{params, Connection, OptionalExtension};

use crate::{
    error::AppResult,
    models::{DiffusionPipeConfig, TrainingConfig, TrainingEnvSettings},
};

use crate::utils::now_ts;

pub fn save_training_config(
    connection: &Connection,
    project_id: &str,
    config: &TrainingConfig,
) -> AppResult<()> {
    let config_json = serde_json::to_string(config)?;
    connection.execute(
        "
        INSERT INTO training_configs (project_id, config_json, version, updated_at)
        VALUES (?1, ?2, 1, ?3)
        ON CONFLICT(project_id) DO UPDATE SET
            config_json = excluded.config_json,
            version = training_configs.version + 1,
            updated_at = excluded.updated_at
        ",
        params![project_id, config_json, now_ts()],
    )?;
    Ok(())
}

pub fn load_training_config(
    connection: &Connection,
    project_id: &str,
) -> AppResult<TrainingConfig> {
    let maybe_json = connection
        .query_row(
            "SELECT config_json FROM training_configs WHERE project_id = ?1",
            params![project_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    match maybe_json {
        Some(json) => Ok(serde_json::from_str(&json)?),
        None => Ok(TrainingConfig::default()),
    }
}

pub fn save_diffusion_pipe_config(
    connection: &Connection,
    project_id: &str,
    config: &DiffusionPipeConfig,
) -> AppResult<()> {
    let config_json = serde_json::to_string(config)?;
    connection.execute(
        "
        INSERT INTO diffusion_pipe_configs (project_id, config_json, version, updated_at)
        VALUES (?1, ?2, 1, ?3)
        ON CONFLICT(project_id) DO UPDATE SET
            config_json = excluded.config_json,
            version = diffusion_pipe_configs.version + 1,
            updated_at = excluded.updated_at
        ",
        params![project_id, config_json, now_ts()],
    )?;
    Ok(())
}

pub fn load_diffusion_pipe_config(
    connection: &Connection,
    project_id: &str,
) -> AppResult<DiffusionPipeConfig> {
    let maybe_json = connection
        .query_row(
            "SELECT config_json FROM diffusion_pipe_configs WHERE project_id = ?1",
            params![project_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    match maybe_json {
        Some(json) => Ok(serde_json::from_str(&json)?),
        None => Ok(DiffusionPipeConfig::default()),
    }
}

pub fn save_training_env(connection: &Connection, settings: &TrainingEnvSettings) -> AppResult<()> {
    let config_json = serde_json::to_string(settings)?;
    connection.execute(
        "
        INSERT INTO training_env_settings (id, config_json, version, updated_at)
        VALUES ('global', ?1, 1, ?2)
        ON CONFLICT(id) DO UPDATE SET
            config_json = excluded.config_json,
            version = training_env_settings.version + 1,
            updated_at = excluded.updated_at
        ",
        params![config_json, now_ts()],
    )?;
    Ok(())
}

pub fn load_training_env(connection: &Connection) -> AppResult<TrainingEnvSettings> {
    let maybe_json = connection
        .query_row(
            "SELECT config_json FROM training_env_settings WHERE id = 'global'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    match maybe_json {
        Some(json) => Ok(serde_json::from_str(&json)?),
        None => Ok(TrainingEnvSettings::default()),
    }
}
