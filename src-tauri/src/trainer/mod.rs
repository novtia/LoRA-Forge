pub mod diffusion_pipe;
pub mod events;
pub mod log_parser;
pub mod mock;
pub mod repos;
pub mod sd_scripts;
pub mod stats;

use std::{
    ffi::OsStr,
    fs,
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use rusqlite::OptionalExtension;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, BufReader};

use crate::{
    db,
    error::{AppError, AppResult},
    models::{
        JobStatus, TrainingLogEvent, TrainingProgressEvent, TrainingSnapshot,
        TrainingStateChangedEvent,
    },
    state::{AppState, RuntimeJob},
    utils::now_ts,
};

pub use diffusion_pipe::start_diffusion_pipe_training;
pub use events::{TRAINING_LOG_EVENT, TRAINING_PROGRESS_EVENT, TRAINING_STATE_EVENT};
pub use mock::run_mock_trainer_from_env;
pub use sd_scripts::{abort_training, pause_training, resume_training, start_training};
pub use stats::{collect_system_stats, start_system_stats_publisher};

use log_parser::{
    infer_log_level, normalize_log_level, parse_deepspeed_progress_line, parse_progress_line,
    parse_structured_log_line, progress_from_structured_log, serialize_metrics, ParsedProgress,
};

pub(super) const ABORT_GRACE_PERIOD: Duration = Duration::from_secs(3);
const ABORT_POLL_INTERVAL: Duration = Duration::from_millis(200);

type SharedLogFile = Arc<Mutex<Box<dyn std::io::Write + Send>>>;

fn is_leap_year(y: u32) -> bool {
    y % 4 == 0 && (y % 100 != 0 || y % 400 == 0)
}

/// Format current UTC time as `YYYY-MM-DD HH:MM:SS` without external crates.
fn utc_now_str() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let sec = (secs % 60) as u8;
    let min = ((secs / 60) % 60) as u8;
    let hour = ((secs / 3600) % 24) as u8;
    let mut days = (secs / 86400) as u32;
    let mut year = 1970u32;
    loop {
        let dy = if is_leap_year(year) { 366 } else { 365 };
        if days < dy {
            break;
        }
        days -= dy;
        year += 1;
    }
    let month_lens: [u8; 12] = [
        31,
        if is_leap_year(year) { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut month = 1u8;
    for &len in &month_lens {
        if days < len as u32 {
            break;
        }
        days -= len as u32;
        month += 1;
    }
    let day = (days + 1) as u8;
    format!("{year:04}-{month:02}-{day:02} {hour:02}:{min:02}:{sec:02}")
}

/// Open (or create) the project-level log file at `{root_path}/logs/{job_id}.log`.
/// Falls back to a silent sink so training is never blocked by logging failures.
fn open_project_log_file(root_path: &str, job_id: &str) -> SharedLogFile {
    let try_open = || -> std::io::Result<SharedLogFile> {
        let logs_dir = Path::new(root_path).join("logs");
        fs::create_dir_all(&logs_dir)?;
        let log_path = logs_dir.join(format!("{job_id}.log"));
        let file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)?;
        Ok(Arc::new(Mutex::new(
            Box::new(file) as Box<dyn std::io::Write + Send>
        )))
    };
    try_open().unwrap_or_else(|e| {
        eprintln!("Failed to open project log file: {e}");
        Arc::new(Mutex::new(
            Box::new(std::io::sink()) as Box<dyn std::io::Write + Send>
        ))
    })
}

/// Quote a value for safe embedding in a bash `-c` script (single-quoted).
pub(super) fn bash_shell_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Shell-like single line for logs (quote args that contain whitespace).
fn format_training_invocation(cmd: &tokio::process::Command) -> String {
    fn fmt_arg(arg: &OsStr) -> String {
        let s = arg.to_string_lossy();
        if s.is_empty() {
            return "\"\"".to_string();
        }
        if s.chars().any(|c| c.is_whitespace()) || s.contains('"') {
            format!("\"{}\"", s.replace('"', "\\\""))
        } else {
            s.into_owned()
        }
    }
    let std_cmd = cmd.as_std();
    let mut out = fmt_arg(std_cmd.get_program());
    for arg in std_cmd.get_args() {
        out.push(' ');
        out.push_str(&fmt_arg(arg));
    }
    out
}

fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(program);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    cmd
}

fn training_subprocess_command(program: impl AsRef<std::ffi::OsStr>) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(program);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    cmd
}

/// Reads stdout/stderr from the trainer and dispatches each logical "line".
///
/// We can't use `read_until(b'\n', …)` here because tqdm (used by sd-scripts) emits
/// in-place progress updates terminated with `\r` and *no* `\n`. With a strict
/// newline boundary those updates would sit in the BufReader until the next true
/// newline (often the end of an epoch), making step/loss appear to update in
/// bursts. Instead we drain the stream byte-by-byte and split on either `\r`
/// or `\n`, so every carriage-return-terminated tqdm frame is forwarded to the
/// progress parser as soon as it arrives.
///
/// A small inline buffer accumulates the current in-flight line; any leftover
/// non-terminated text at EOF is still flushed so the final message is never
/// lost.
async fn stream_logs<R>(
    app: AppHandle,
    state: AppState,
    project_id: String,
    job_id: String,
    stream: &str,
    reader: R,
    log_file: SharedLogFile,
) -> AppResult<()>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut reader = BufReader::new(reader);
    let mut chunk = [0_u8; 4096];
    let mut pending: Vec<u8> = Vec::with_capacity(1024);

    loop {
        let n = reader.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        for &byte in &chunk[..n] {
            if byte == b'\n' || byte == b'\r' {
                flush_pending(
                    &app,
                    &state,
                    &project_id,
                    &job_id,
                    stream,
                    &mut pending,
                    &log_file,
                )
                .await?;
            } else {
                pending.push(byte);
            }
        }
    }

    flush_pending(
        &app,
        &state,
        &project_id,
        &job_id,
        stream,
        &mut pending,
        &log_file,
    )
    .await?;

    Ok(())
}

async fn flush_pending(
    app: &AppHandle,
    state: &AppState,
    project_id: &str,
    job_id: &str,
    stream: &str,
    pending: &mut Vec<u8>,
    log_file: &SharedLogFile,
) -> AppResult<()> {
    if pending.is_empty() {
        return Ok(());
    }
    let text = String::from_utf8_lossy(pending).into_owned();
    pending.clear();
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    handle_stream_line(app, state, project_id, job_id, stream, trimmed, log_file).await
}

async fn handle_stream_line(
    app: &AppHandle,
    state: &AppState,
    project_id: &str,
    job_id: &str,
    stream: &str,
    line: &str,
    log_file: &SharedLogFile,
) -> AppResult<()> {
    let created_at = now_ts();
    let structured = parse_structured_log_line(line);
    let level = structured
        .as_ref()
        .map(|record| normalize_log_level(&record.level))
        .unwrap_or_else(|| infer_log_level(line));
    let display_line = structured
        .as_ref()
        .map(|record| record.message.as_str())
        .unwrap_or(line);
    let metrics_json = structured
        .as_ref()
        .and_then(|record| serialize_metrics(&record.metrics));
    let entry = state.with_db(|connection| {
        db::append_log(
            connection,
            job_id,
            stream,
            &level,
            display_line,
            created_at,
            structured.as_ref().map(|record| record.kind.as_str()),
            structured.as_ref().map(|record| record.stage.as_str()),
            structured.as_ref().map(|record| record.code.as_str()),
            structured.as_ref().map(|record| record.message.as_str()),
            metrics_json.as_deref(),
            structured.as_ref().map(|_| line),
        )
    })?;

    let _ = app.emit(
        TRAINING_LOG_EVENT,
        TrainingLogEvent {
            project_id: project_id.to_string(),
            job_id: job_id.to_string(),
            entry,
        },
    );

    // Write raw line to project log file (best-effort, never block training on failure)
    if let Ok(mut file) = log_file.lock() {
        let _ = writeln!(&mut **file, "[{}] [{}] {}", utc_now_str(), stream, line);
    }

    let fallback_progress = if structured.is_none() && !job_has_structured_logs(state, job_id)? {
        parse_progress_line(line).or_else(|| parse_deepspeed_progress_line(line))
    } else {
        None
    };

    if let Some(progress) = structured
        .as_ref()
        .and_then(progress_from_structured_log)
        .or(fallback_progress)
    {
        let snapshot = build_snapshot_from_progress(state, project_id, job_id, progress)?;
        state.with_db(|connection| db::append_snapshot(connection, job_id, &snapshot))?;
        let _ = app.emit(
            TRAINING_PROGRESS_EVENT,
            TrainingProgressEvent {
                project_id: project_id.to_string(),
                job_id: job_id.to_string(),
                snapshot,
            },
        );
    }

    Ok(())
}

async fn wait_for_child(runtime_job: RuntimeJob) -> AppResult<(Option<u32>, bool)> {
    let mut child = runtime_job.child.lock().await;
    let pid = child.id();
    let status = child.wait().await?;
    Ok((pid, status.success()))
}

async fn wait_for_runtime_job_exit(
    state: &AppState,
    runtime_job: &RuntimeJob,
    timeout: Duration,
) -> AppResult<bool> {
    let Some(pid) = runtime_job.pid else {
        return Ok(true);
    };

    let deadline = Instant::now() + timeout;
    loop {
        if !is_process_running(pid).await? {
            return Ok(true);
        }

        let active_job = state.runtime_job(&runtime_job.project_id)?;
        if active_job
            .as_ref()
            .map(|job| job.job_id != runtime_job.job_id)
            .unwrap_or(true)
        {
            return Ok(true);
        }

        if Instant::now() >= deadline {
            return Ok(false);
        }

        tokio::time::sleep(ABORT_POLL_INTERVAL).await;
    }
}

async fn force_kill_process(pid: Option<u32>) -> AppResult<()> {
    let Some(pid) = pid else {
        return Ok(());
    };

    if !is_process_running(pid).await? {
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = hidden_command("taskkill");
        command.arg("/PID").arg(pid.to_string()).arg("/T").arg("/F");
        command
    };

    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let mut command = hidden_command("kill");
        command.arg("-KILL").arg(pid.to_string());
        command
    };

    let status = command.status().await?;
    if status.success() || !is_process_running(pid).await? {
        Ok(())
    } else {
        Err(AppError::Process(format!(
            "Failed to force-stop trainer process {pid}"
        )))
    }
}

async fn is_process_running(pid: u32) -> AppResult<bool> {
    #[cfg(target_os = "windows")]
    {
        let output = hidden_command("tasklist")
            .arg("/FI")
            .arg(format!("PID eq {pid}"))
            .arg("/FO")
            .arg("CSV")
            .arg("/NH")
            .output()
            .await?;
        if !output.status.success() {
            return Err(AppError::Process(format!(
                "Failed to inspect trainer process {pid}"
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        return Ok(stdout.lines().any(|line| line.starts_with('"')));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let status = hidden_command("kill")
            .arg("-0")
            .arg(pid.to_string())
            .status()
            .await?;
        Ok(status.success())
    }
}

fn finalize_job(
    state: &AppState,
    project_id: &str,
    job_id: &str,
    status: JobStatus,
    pid: Option<u32>,
) -> JobStatus {
    let _ = state.with_db(|connection| {
        db::update_job_status(connection, job_id, status, pid, Some(now_ts()))?;
        db::update_project_status(connection, project_id, status.to_project_status())?;
        Ok(())
    });

    status
}

fn read_control_state(path: &Path) -> AppResult<String> {
    Ok(fs::read_to_string(path)?.trim().to_string())
}

fn final_status_after_exit(
    state: &AppState,
    job_id: &str,
    control_file: &Path,
    success: bool,
) -> JobStatus {
    let current = current_status(state, job_id).unwrap_or(JobStatus::Interrupted);
    let control = read_control_state(control_file).unwrap_or_else(|_| "running".to_string());

    if current == JobStatus::Aborted || control == "aborted" {
        JobStatus::Aborted
    } else if success {
        JobStatus::Completed
    } else {
        JobStatus::Failed
    }
}

fn emit_state_change(app: &AppHandle, project_id: &str, job_id: &str, status: JobStatus) {
    let _ = app.emit(
        TRAINING_STATE_EVENT,
        TrainingStateChangedEvent {
            project_id: project_id.to_string(),
            job_id: job_id.to_string(),
            status,
        },
    );
}

fn current_status(state: &AppState, job_id: &str) -> AppResult<JobStatus> {
    let current = state.with_db(|connection| {
        connection
            .query_row(
                "SELECT status FROM jobs WHERE id = ?1",
                rusqlite::params![job_id],
                |row| row.get::<_, String>(0),
            )
            .map(|value| JobStatus::from_db(&value))
            .map_err(Into::into)
    })?;

    Ok(current)
}

fn build_snapshot_from_progress(
    state: &AppState,
    project_id: &str,
    job_id: &str,
    progress: ParsedProgress,
) -> AppResult<TrainingSnapshot> {
    let current_job = state
        .with_db(|connection| db::get_active_job(connection, Some(project_id)))?
        .filter(|job| job.job_id == job_id);
    let runtime_seconds = progress
        .runtime_seconds
        .unwrap_or(current_runtime_seconds(state, job_id).unwrap_or(0));

    Ok(TrainingSnapshot {
        epoch: progress
            .epoch
            .or_else(|| current_job.as_ref().map(|job| job.epoch))
            .unwrap_or(0),
        epoch_total: progress
            .epoch_total
            .or_else(|| current_job.as_ref().map(|job| job.epoch_total))
            .unwrap_or(0),
        step: progress
            .step
            .or_else(|| current_job.as_ref().map(|job| job.step))
            .unwrap_or(0),
        step_total: progress
            .step_total
            .or_else(|| current_job.as_ref().map(|job| job.step_total))
            .unwrap_or(0),
        loss: progress
            .loss
            .or_else(|| current_job.as_ref().map(|job| job.loss))
            .unwrap_or(0.0),
        lr: progress
            .lr
            .or_else(|| current_job.as_ref().map(|job| job.lr))
            .unwrap_or(0.0),
        runtime_seconds,
        pid: state.runtime_job(project_id)?.and_then(|job| job.pid),
        status: current_status(state, job_id)?,
    })
}

fn current_runtime_seconds(state: &AppState, job_id: &str) -> AppResult<u64> {
    let runtime = state.with_db(|connection| {
        connection
            .query_row(
                "SELECT MAX(0, COALESCE(ended_at, ?2) - started_at) FROM jobs WHERE id = ?1",
                rusqlite::params![job_id, now_ts()],
                |row| row.get::<_, i64>(0),
            )
            .map_err(Into::into)
    })?;
    Ok(runtime as u64)
}

fn job_has_structured_logs(state: &AppState, job_id: &str) -> AppResult<bool> {
    state.with_db(|connection| {
        connection
            .query_row(
                "SELECT 1 FROM job_logs WHERE job_id = ?1 AND raw_line IS NOT NULL LIMIT 1",
                rusqlite::params![job_id],
                |_| Ok(1_i64),
            )
            .optional()
            .map(|value| value.is_some())
            .map_err(Into::into)
    })
}

#[cfg(test)]
mod tests {
    use super::bash_shell_quote;

    #[test]
    fn bash_shell_quote_preserves_spaces() {
        let path = "/mnt/d/ComfyUI windows portable/train/gufeng/output/20260606_18-58-23";
        assert_eq!(
            bash_shell_quote(path),
            "'/mnt/d/ComfyUI windows portable/train/gufeng/output/20260606_18-58-23'"
        );
    }

    #[test]
    fn bash_shell_quote_escapes_single_quotes() {
        assert_eq!(bash_shell_quote("it's"), "'it'\\''s'");
    }

    #[test]
    fn bash_shell_quote_empty() {
        assert_eq!(bash_shell_quote(""), "''");
    }
}
