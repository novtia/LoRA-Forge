use rusqlite::{params, Connection, OptionalExtension};

use std::collections::HashMap;

use crate::{
    error::{AppError, AppResult},
    models::{
        ActiveJobSummary, BaiduTranslateSettings, DiffusionPipeConfig, JobStatus, LlmSettings,
        LossPoint, ProjectRecord, ProjectStatus, TrainingConfig, TrainingEnvSettings,
        TrainingLogLine, TrainingSnapshot,
    },
    utils::{normalize_display_path_string, now_ts},
};

pub fn initialize_database(connection: &Connection) -> AppResult<()> {
    connection.execute_batch(
        "
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            root_path TEXT NOT NULL,
            dataset_path TEXT NOT NULL,
            output_path TEXT NOT NULL,
            status TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS training_configs (
            project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
            config_json TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS diffusion_pipe_configs (
            project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
            config_json TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS training_env_settings (
            id TEXT PRIMARY KEY,
            config_json TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS llm_settings (
            id TEXT PRIMARY KEY,
            config_json TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS baidu_translate_settings (
            id TEXT PRIMARY KEY,
            config_json TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS dataset_group_configs (
            project_id TEXT NOT NULL,
            group_path TEXT NOT NULL,
            group_type TEXT NOT NULL DEFAULT 'normal',
            PRIMARY KEY (project_id, group_path)
        );

        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            pid INTEGER,
            started_at INTEGER NOT NULL,
            ended_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS job_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
            seq INTEGER NOT NULL,
            stream TEXT NOT NULL,
            level TEXT NOT NULL,
            kind TEXT,
            stage TEXT,
            code TEXT,
            message TEXT,
            metrics_json TEXT,
            raw_line TEXT,
            line TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS job_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
            epoch INTEGER NOT NULL,
            epoch_total INTEGER NOT NULL,
            step INTEGER NOT NULL,
            step_total INTEGER NOT NULL,
            loss REAL NOT NULL,
            lr REAL NOT NULL,
            runtime_seconds INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );
        ",
    )?;
    ensure_job_logs_columns(connection)?;

    Ok(())
}

fn ensure_job_logs_columns(connection: &Connection) -> AppResult<()> {
    ensure_job_logs_column(connection, "kind", "TEXT")?;
    ensure_job_logs_column(connection, "stage", "TEXT")?;
    ensure_job_logs_column(connection, "code", "TEXT")?;
    ensure_job_logs_column(connection, "message", "TEXT")?;
    ensure_job_logs_column(connection, "metrics_json", "TEXT")?;
    ensure_job_logs_column(connection, "raw_line", "TEXT")?;
    Ok(())
}

fn ensure_job_logs_column(
    connection: &Connection,
    column: &str,
    definition: &str,
) -> AppResult<()> {
    let mut statement = connection.prepare("PRAGMA table_info(job_logs)")?;
    let existing = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;

    if !existing.iter().any(|name| name == column) {
        connection.execute(
            &format!("ALTER TABLE job_logs ADD COLUMN {column} {definition}"),
            [],
        )?;
    }

    Ok(())
}

fn training_log_channel(
    kind: Option<&str>,
    stage: Option<&str>,
    code: Option<&str>,
) -> &'static str {
    if kind.is_some() || stage.is_some() || code.is_some() {
        "rich"
    } else {
        "raw"
    }
}

pub fn recover_unfinished_jobs(connection: &Connection) -> AppResult<()> {
    let timestamp = now_ts();
    connection.execute(
        "UPDATE jobs SET status = 'interrupted', ended_at = COALESCE(ended_at, ?1) WHERE status IN ('running', 'paused')",
        params![timestamp],
    )?;
    connection.execute(
        "UPDATE projects SET status = 'interrupted', updated_at = ?1 WHERE status IN ('running', 'paused')",
        params![timestamp],
    )?;

    Ok(())
}

pub fn insert_project(connection: &Connection, project: &ProjectRecord) -> AppResult<()> {
    let tags_json = serde_json::to_string(&project.tags)?;
    connection.execute(
        "
        INSERT INTO projects (id, name, root_path, dataset_path, output_path, status, tags_json, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ",
        params![
            project.id,
            project.name,
            project.root_path,
            project.dataset_path,
            project.output_path,
            project.status.as_str(),
            tags_json,
            project.updated_at,
        ],
    )?;

    Ok(())
}

pub fn list_projects(connection: &Connection) -> AppResult<Vec<ProjectRecord>> {
    let mut statement = connection.prepare(
        "
        SELECT id, name, root_path, dataset_path, output_path, status, tags_json, updated_at
        FROM projects
        ORDER BY updated_at DESC, name ASC
        ",
    )?;

    let projects = statement
        .query_map([], row_to_project)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(projects)
}

pub fn get_project(connection: &Connection, project_id: &str) -> AppResult<ProjectRecord> {
    connection
        .query_row(
            "
            SELECT id, name, root_path, dataset_path, output_path, status, tags_json, updated_at
            FROM projects
            WHERE id = ?1
            ",
            params![project_id],
            row_to_project,
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("Project '{project_id}' does not exist")))
}

pub fn update_project_status(
    connection: &Connection,
    project_id: &str,
    status: ProjectStatus,
) -> AppResult<()> {
    connection.execute(
        "UPDATE projects SET status = ?1, updated_at = ?2 WHERE id = ?3",
        params![status.as_str(), now_ts(), project_id],
    )?;
    Ok(())
}

pub fn update_project_tags(
    connection: &Connection,
    project_id: &str,
    tags: &[String],
) -> AppResult<()> {
    connection.execute(
        "UPDATE projects SET tags_json = ?1, updated_at = ?2 WHERE id = ?3",
        params![serde_json::to_string(tags)?, now_ts(), project_id],
    )?;
    Ok(())
}

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
        Some(config_json) => Ok(serde_json::from_str(&config_json)?),
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
        Some(config_json) => Ok(serde_json::from_str(&config_json)?),
        None => Ok(DiffusionPipeConfig::default()),
    }
}

// ── dataset group configs ──────────────────────────────────────────────────

/// Upsert the type ("normal" | "reg") for a dataset directory group.
pub fn save_dataset_group_type(
    connection: &Connection,
    project_id: &str,
    group_path: &str,
    group_type: &str,
) -> AppResult<()> {
    if group_type == "normal" {
        // "normal" is the default → just delete any existing row so we stay clean
        connection.execute(
            "DELETE FROM dataset_group_configs WHERE project_id = ?1 AND group_path = ?2",
            params![project_id, group_path],
        )?;
    } else {
        connection.execute(
            "INSERT INTO dataset_group_configs (project_id, group_path, group_type)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(project_id, group_path) DO UPDATE SET group_type = excluded.group_type",
            params![project_id, group_path, group_type],
        )?;
    }
    Ok(())
}

/// Returns a map of group_path → group_type for all non-normal groups in a project.
pub fn load_dataset_group_types(
    connection: &Connection,
    project_id: &str,
) -> AppResult<HashMap<String, String>> {
    let mut stmt = connection.prepare(
        "SELECT group_path, group_type FROM dataset_group_configs WHERE project_id = ?1",
    )?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows.into_iter().collect())
}

/// Update group_path (and all sub-paths) when a group is renamed.
pub fn rename_dataset_group_config(
    connection: &Connection,
    project_id: &str,
    old_path: &str,
    new_path: &str,
) -> AppResult<()> {
    let old_prefix = format!("{}/", old_path);
    let new_prefix = format!("{}/", new_path);
    // exact match
    connection.execute(
        "UPDATE dataset_group_configs SET group_path = ?3
         WHERE project_id = ?1 AND group_path = ?2",
        params![project_id, old_path, new_path],
    )?;
    // sub-paths: replace prefix
    let mut stmt = connection.prepare(
        "SELECT group_path FROM dataset_group_configs
         WHERE project_id = ?1 AND group_path LIKE ?2 ESCAPE '\\'",
    )?;
    let like_pattern = format!("{}%", old_prefix.replace('%', "\\%").replace('_', "\\_"));
    let sub_paths: Vec<String> = stmt
        .query_map(params![project_id, like_pattern], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for sub in sub_paths {
        let updated = format!("{}{}", new_prefix, &sub[old_prefix.len()..]);
        connection.execute(
            "UPDATE dataset_group_configs SET group_path = ?3
             WHERE project_id = ?1 AND group_path = ?2",
            params![project_id, sub, updated],
        )?;
    }
    Ok(())
}

/// Remove group_path and all sub-paths when a group is deleted.
pub fn remove_dataset_group_configs(
    connection: &Connection,
    project_id: &str,
    group_path: &str,
) -> AppResult<()> {
    let like_pattern = format!(
        "{}/{}",
        group_path.replace('%', "\\%").replace('_', "\\_"),
        "%"
    );
    connection.execute(
        "DELETE FROM dataset_group_configs
         WHERE project_id = ?1 AND (group_path = ?2 OR group_path LIKE ?3 ESCAPE '\\')",
        params![project_id, group_path, like_pattern],
    )?;
    Ok(())
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
        Some(config_json) => Ok(serde_json::from_str(&config_json)?),
        None => Ok(TrainingEnvSettings::default()),
    }
}

pub fn save_llm_settings(connection: &Connection, settings: &LlmSettings) -> AppResult<()> {
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

pub fn load_llm_settings(connection: &Connection) -> AppResult<LlmSettings> {
    let maybe_json = connection
        .query_row(
            "SELECT config_json FROM llm_settings WHERE id = 'global'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;

    match maybe_json {
        Some(config_json) => Ok(serde_json::from_str(&config_json)?),
        None => Ok(LlmSettings::default()),
    }
}

pub fn save_baidu_translate_settings(
    connection: &Connection,
    settings: &BaiduTranslateSettings,
) -> AppResult<()> {
    let config_json = serde_json::to_string(settings)?;
    connection.execute(
        "
        INSERT INTO baidu_translate_settings (id, config_json, version, updated_at)
        VALUES ('global', ?1, 1, ?2)
        ON CONFLICT(id) DO UPDATE SET
            config_json = excluded.config_json,
            version = baidu_translate_settings.version + 1,
            updated_at = excluded.updated_at
        ",
        params![config_json, now_ts()],
    )?;

    Ok(())
}

pub fn load_baidu_translate_settings(
    connection: &Connection,
) -> AppResult<BaiduTranslateSettings> {
    let maybe_json = connection
        .query_row(
            "SELECT config_json FROM baidu_translate_settings WHERE id = 'global'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;

    match maybe_json {
        Some(config_json) => Ok(serde_json::from_str(&config_json)?),
        None => Ok(BaiduTranslateSettings::default()),
    }
}

pub fn create_job(
    connection: &Connection,
    job_id: &str,
    project_id: &str,
    pid: Option<u32>,
    status: JobStatus,
) -> AppResult<()> {
    connection.execute(
        "
        INSERT INTO jobs (id, project_id, kind, status, pid, started_at, ended_at)
        VALUES (?1, ?2, 'training', ?3, ?4, ?5, NULL)
        ",
        params![
            job_id,
            project_id,
            status.as_str(),
            pid.map(i64::from),
            now_ts()
        ],
    )?;
    Ok(())
}

pub fn update_job_status(
    connection: &Connection,
    job_id: &str,
    status: JobStatus,
    pid: Option<u32>,
    ended_at: Option<i64>,
) -> AppResult<()> {
    connection.execute(
        "
        UPDATE jobs
        SET status = ?1, pid = ?2, ended_at = COALESCE(?3, ended_at)
        WHERE id = ?4
        ",
        params![status.as_str(), pid.map(i64::from), ended_at, job_id],
    )?;
    Ok(())
}

pub fn append_log(
    connection: &Connection,
    job_id: &str,
    stream: &str,
    level: &str,
    line: &str,
    created_at: i64,
    kind: Option<&str>,
    stage: Option<&str>,
    code: Option<&str>,
    message: Option<&str>,
    metrics_json: Option<&str>,
    raw_line: Option<&str>,
) -> AppResult<TrainingLogLine> {
    let seq = connection.query_row(
        "SELECT COALESCE(MAX(seq), 0) + 1 FROM job_logs WHERE job_id = ?1",
        params![job_id],
        |row| row.get::<_, i64>(0),
    )?;

    connection.execute(
        "
        INSERT INTO job_logs (job_id, seq, stream, level, kind, stage, code, message, metrics_json, raw_line, line, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        ",
        params![
            job_id,
            seq,
            stream,
            level,
            kind,
            stage,
            code,
            message,
            metrics_json,
            raw_line,
            line,
            created_at
        ],
    )?;

    connection.execute(
        "
        DELETE FROM job_logs
        WHERE job_id = ?1
          AND id NOT IN (
            SELECT id FROM job_logs
            WHERE job_id = ?1
            ORDER BY seq DESC
            LIMIT 500
          )
        ",
        params![job_id],
    )?;

    Ok(TrainingLogLine {
        seq,
        stream: stream.to_string(),
        level: level.to_string(),
        channel: training_log_channel(kind, stage, code).to_string(),
        kind: kind.map(ToOwned::to_owned),
        stage: stage.map(ToOwned::to_owned),
        code: code.map(ToOwned::to_owned),
        message: message.map(ToOwned::to_owned),
        metrics: metrics_json.and_then(|value| serde_json::from_str(value).ok()),
        raw_line: raw_line.map(ToOwned::to_owned),
        line: line.to_string(),
        created_at,
    })
}

pub fn append_snapshot(
    connection: &Connection,
    job_id: &str,
    snapshot: &TrainingSnapshot,
) -> AppResult<()> {
    connection.execute(
        "
        INSERT INTO job_snapshots (job_id, epoch, epoch_total, step, step_total, loss, lr, runtime_seconds, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ",
        params![
            job_id,
            i64::from(snapshot.epoch),
            i64::from(snapshot.epoch_total),
            i64::from(snapshot.step),
            i64::from(snapshot.step_total),
            snapshot.loss,
            snapshot.lr,
            snapshot.runtime_seconds as i64,
            now_ts(),
        ],
    )?;

    connection.execute(
        "
        DELETE FROM job_snapshots
        WHERE job_id = ?1
          AND id NOT IN (
            SELECT id FROM job_snapshots
            WHERE job_id = ?1
            ORDER BY step DESC
            LIMIT 240
          )
        ",
        params![job_id],
    )?;

    Ok(())
}

pub fn get_active_job(
    connection: &Connection,
    project_id: Option<&str>,
) -> AppResult<Option<ActiveJobSummary>> {
    let query = if project_id.is_some() {
        "
        SELECT jobs.id, jobs.project_id, projects.name, jobs.status, jobs.pid, jobs.started_at
        FROM jobs
        INNER JOIN projects ON projects.id = jobs.project_id
        WHERE jobs.project_id = ?1
        ORDER BY jobs.started_at DESC
        LIMIT 1
        "
    } else {
        "
        SELECT jobs.id, jobs.project_id, projects.name, jobs.status, jobs.pid, jobs.started_at
        FROM jobs
        INNER JOIN projects ON projects.id = jobs.project_id
        ORDER BY
            CASE jobs.status
                WHEN 'running' THEN 0
                WHEN 'paused' THEN 1
                WHEN 'interrupted' THEN 2
                WHEN 'completed' THEN 3
                WHEN 'failed' THEN 4
                WHEN 'aborted' THEN 5
                ELSE 9
            END,
            jobs.started_at DESC
        LIMIT 1
        "
    };

    let mut summary = if let Some(project_id) = project_id {
        connection
            .query_row(query, params![project_id], row_to_job_identity)
            .optional()?
    } else {
        connection
            .query_row(query, [], row_to_job_identity)
            .optional()?
    };

    let Some((job_id, project_id, project_name, status, pid, started_at)) = summary.take() else {
        return Ok(None);
    };

    let latest_snapshot = connection
        .query_row(
            "
            SELECT epoch, epoch_total, step, step_total, loss, lr, runtime_seconds
            FROM job_snapshots
            WHERE job_id = ?1
            ORDER BY step DESC, id DESC
            LIMIT 1
            ",
            params![job_id],
            |row| {
                Ok(TrainingSnapshot {
                    epoch: row.get::<_, i64>(0)? as u32,
                    epoch_total: row.get::<_, i64>(1)? as u32,
                    step: row.get::<_, i64>(2)? as u32,
                    step_total: row.get::<_, i64>(3)? as u32,
                    loss: row.get(4)?,
                    lr: row.get(5)?,
                    runtime_seconds: row.get::<_, i64>(6)? as u64,
                    pid,
                    status,
                })
            },
        )
        .optional()?
        .unwrap_or(TrainingSnapshot {
            runtime_seconds: started_at.max(0) as u64,
            pid,
            status,
            ..TrainingSnapshot::default()
        });

    let history = recent_history(connection, &job_id, 60)?;
    let recent_logs = recent_logs(connection, &job_id, 120)?;

    Ok(Some(ActiveJobSummary {
        checkpoint_name: format!("{project_name}.safetensors"),
        job_id,
        project_id,
        project_name,
        status,
        pid,
        runtime_seconds: latest_snapshot.runtime_seconds,
        epoch: latest_snapshot.epoch,
        epoch_total: latest_snapshot.epoch_total,
        step: latest_snapshot.step,
        step_total: latest_snapshot.step_total,
        loss: latest_snapshot.loss,
        lr: latest_snapshot.lr,
        history,
        recent_logs,
    }))
}

fn recent_logs(
    connection: &Connection,
    job_id: &str,
    limit: usize,
) -> AppResult<Vec<TrainingLogLine>> {
    let mut statement = connection.prepare(
        "
        SELECT seq, stream, level, kind, stage, code, message, metrics_json, raw_line, line, created_at
        FROM job_logs
        WHERE job_id = ?1
        ORDER BY seq DESC
        LIMIT ?2
        ",
    )?;

    let mut logs = statement
        .query_map(params![job_id, limit as i64], |row| {
            Ok(TrainingLogLine {
                seq: row.get(0)?,
                stream: row.get(1)?,
                level: row.get(2)?,
                channel: training_log_channel(
                    row.get::<_, Option<String>>(3)?.as_deref(),
                    row.get::<_, Option<String>>(4)?.as_deref(),
                    row.get::<_, Option<String>>(5)?.as_deref(),
                )
                .to_string(),
                kind: row.get(3)?,
                stage: row.get(4)?,
                code: row.get(5)?,
                message: row.get(6)?,
                metrics: row
                    .get::<_, Option<String>>(7)?
                    .and_then(|value| serde_json::from_str(&value).ok()),
                raw_line: row.get(8)?,
                line: row.get(9)?,
                created_at: row.get(10)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    logs.reverse();
    Ok(logs)
}

fn recent_history(
    connection: &Connection,
    job_id: &str,
    limit: usize,
) -> AppResult<Vec<LossPoint>> {
    let mut statement = connection.prepare(
        "
        SELECT step, loss
        FROM job_snapshots
        WHERE job_id = ?1
        ORDER BY step DESC
        LIMIT ?2
        ",
    )?;

    let mut history = statement
        .query_map(params![job_id, limit as i64], |row| {
            Ok(LossPoint {
                step: row.get::<_, i64>(0)? as u32,
                loss: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    history.reverse();
    Ok(history)
}

fn row_to_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectRecord> {
    let tags_json: String = row.get(6)?;
    let tags = serde_json::from_str::<Vec<String>>(&tags_json).unwrap_or_default();

    Ok(ProjectRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        root_path: normalize_display_path_string(&row.get::<_, String>(2)?),
        dataset_path: normalize_display_path_string(&row.get::<_, String>(3)?),
        output_path: normalize_display_path_string(&row.get::<_, String>(4)?),
        status: ProjectStatus::from_db(&row.get::<_, String>(5)?),
        tags,
        size_bytes: 0,
        updated_at: row.get(7)?,
    })
}

fn row_to_job_identity(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<(String, String, String, JobStatus, Option<u32>, i64)> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        JobStatus::from_db(&row.get::<_, String>(3)?),
        row.get::<_, Option<i64>>(4)?.map(|value| value as u32),
        row.get(5)?,
    ))
}
