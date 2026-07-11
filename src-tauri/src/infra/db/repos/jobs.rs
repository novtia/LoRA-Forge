/**
 * @file infra/db/repos/jobs.rs
 * @description jobs / job_logs / job_snapshots 表：创建任务、追加日志/快照、查询活跃任务摘要。
 */
use rusqlite::{params, Connection, OptionalExtension};

use crate::{
    error::AppResult,
    models::{ActiveJobSummary, JobStatus, LossPoint, TrainingLogLine, TrainingSnapshot},
};

use crate::utils::now_ts;

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
        INSERT INTO job_logs
            (job_id, seq, stream, level, kind, stage, code, message, metrics_json, raw_line, line, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        ",
        params![
            job_id, seq, stream, level, kind, stage, code, message,
            metrics_json, raw_line, line, created_at
        ],
    )?;

    connection.execute(
        "
        DELETE FROM job_logs
        WHERE job_id = ?1
          AND id NOT IN (
            SELECT id FROM job_logs WHERE job_id = ?1 ORDER BY seq DESC LIMIT 500
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
        metrics: metrics_json.and_then(|v| serde_json::from_str(v).ok()),
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
        INSERT INTO job_snapshots
            (job_id, epoch, epoch_total, step, step_total, loss, lr, runtime_seconds, created_at)
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
            SELECT id FROM job_snapshots WHERE job_id = ?1 ORDER BY step DESC LIMIT 240
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
    let query_with = "
        SELECT jobs.id, jobs.project_id, projects.name, jobs.status, jobs.pid, jobs.started_at
        FROM jobs
        INNER JOIN projects ON projects.id = jobs.project_id
        WHERE jobs.project_id = ?1
        ORDER BY jobs.started_at DESC
        LIMIT 1
    ";
    let query_any = "
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
    ";

    let identity = if let Some(pid) = project_id {
        connection
            .query_row(query_with, params![pid], row_to_job_identity)
            .optional()?
    } else {
        connection
            .query_row(query_any, [], row_to_job_identity)
            .optional()?
    };

    let Some((job_id, project_id, project_name, status, pid, started_at)) = identity else {
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
                    .and_then(|v| serde_json::from_str(&v).ok()),
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

fn row_to_job_identity(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<(String, String, String, JobStatus, Option<u32>, i64)> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        JobStatus::from_db(&row.get::<_, String>(3)?),
        row.get::<_, Option<i64>>(4)?.map(|v| v as u32),
        row.get(5)?,
    ))
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
