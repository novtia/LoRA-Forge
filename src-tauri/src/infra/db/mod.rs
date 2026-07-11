/**
 * @file infra/db/mod.rs
 * @description DB 层入口：Schema 初始化（含增量迁移）、启动时恢复中断任务，对外暴露 repos。
 */
pub mod repos;

use rusqlite::{params, Connection};

use crate::{error::AppResult, utils::now_ts};

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

        CREATE TABLE IF NOT EXISTS llm_providers (
            id TEXT PRIMARY KEY,
            config_json TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS baidu_translate_settings (
            id TEXT PRIMARY KEY,
            config_json TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS training_repos (
            id TEXT PRIMARY KEY,
            config_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS dataset_group_configs (
            project_id TEXT NOT NULL,
            group_path TEXT NOT NULL,
            group_type TEXT NOT NULL DEFAULT 'normal',
            PRIMARY KEY (project_id, group_path)
        );

        CREATE TABLE IF NOT EXISTS dataset_control_dirs (
            project_id TEXT NOT NULL,
            target_path TEXT NOT NULL,
            control_path TEXT NOT NULL,
            PRIMARY KEY (project_id, target_path)
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
    for (col, def) in [
        ("kind", "TEXT"),
        ("stage", "TEXT"),
        ("code", "TEXT"),
        ("message", "TEXT"),
        ("metrics_json", "TEXT"),
        ("raw_line", "TEXT"),
    ] {
        ensure_job_logs_column(connection, col, def)?;
    }
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
