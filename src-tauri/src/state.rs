use std::{
    collections::{HashMap, VecDeque},
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::Connection;
use tauri::{AppHandle, Manager};
use tokio::process::Child;

use crate::{
    db,
    error::{AppError, AppResult},
    hardware,
    models::{ApiLogEntry, HardwareInfo},
};

const API_LOG_CAP: usize = 400;

fn api_log_now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct AppPaths {
    pub app_dir: PathBuf,
    pub db_path: PathBuf,
    pub jobs_dir: PathBuf,
    pub hardware_cache_path: PathBuf,
}

#[allow(dead_code)]
#[derive(Clone)]
pub enum RuntimeJobControlMode {
    ControlFile,
    ProcessSignals,
}

#[derive(Clone)]
pub struct RuntimeJob {
    pub job_id: String,
    pub project_id: String,
    pub pid: Option<u32>,
    pub control_file: PathBuf,
    pub control_mode: RuntimeJobControlMode,
    pub child: Arc<tokio::sync::Mutex<Child>>,
}

struct AppStateInner {
    paths: AppPaths,
    db: Mutex<Connection>,
    jobs: Mutex<HashMap<String, RuntimeJob>>,
    hardware_info: Mutex<HardwareInfo>,
    llm_caption_cancel: Arc<AtomicBool>,
    api_logs: Mutex<VecDeque<ApiLogEntry>>,
}

#[derive(Clone)]
pub struct AppState {
    inner: Arc<AppStateInner>,
}

impl AppState {
    pub fn initialize(app: &AppHandle) -> AppResult<Self> {
        let app_dir = app.path().app_data_dir()?;
        fs::create_dir_all(&app_dir)?;

        let jobs_dir = app_dir.join("jobs");
        fs::create_dir_all(&jobs_dir)?;
        let hardware_cache_path = app_dir.join("hardware-cache.json");
        let hardware_info = hardware::load_or_detect_hardware_info(&hardware_cache_path);

        let db_path = app_dir.join("lora-forge.sqlite3");
        let connection = Connection::open(&db_path)?;
        db::initialize_database(&connection)?;
        db::recover_unfinished_jobs(&connection)?;

        Ok(Self {
            inner: Arc::new(AppStateInner {
                paths: AppPaths {
                    app_dir,
                    db_path,
                    jobs_dir,
                    hardware_cache_path,
                },
                db: Mutex::new(connection),
                jobs: Mutex::new(HashMap::new()),
                hardware_info: Mutex::new(hardware_info),
                llm_caption_cancel: Arc::new(AtomicBool::new(false)),
                api_logs: Mutex::new(VecDeque::with_capacity(API_LOG_CAP.min(64))),
            }),
        })
    }

    pub fn push_api_log(&self, source: &str, level: &str, message: impl Into<String>) {
        let entry = ApiLogEntry {
            created_at: api_log_now_ms(),
            source: source.to_string(),
            level: level.to_string(),
            message: message.into(),
        };
        let Ok(mut guard) = self.inner.api_logs.lock() else {
            return;
        };
        while guard.len() >= API_LOG_CAP {
            guard.pop_front();
        }
        guard.push_back(entry);
    }

    pub fn recent_api_logs(&self, mut limit: usize) -> Vec<ApiLogEntry> {
        limit = limit.min(API_LOG_CAP).max(1);
        let Ok(guard) = self.inner.api_logs.lock() else {
            return Vec::new();
        };
        let skip = guard.len().saturating_sub(limit);
        guard.iter().skip(skip).cloned().collect()
    }

    pub fn clear_api_logs(&self) {
        if let Ok(mut guard) = self.inner.api_logs.lock() {
            guard.clear();
        }
    }

    pub fn llm_caption_cancel_flag(&self) -> Arc<AtomicBool> {
        self.inner.llm_caption_cancel.clone()
    }

    pub fn reset_llm_caption_cancel(&self) {
        self.inner
            .llm_caption_cancel
            .store(false, Ordering::SeqCst);
    }

    pub fn request_llm_caption_cancel(&self) {
        self.inner
            .llm_caption_cancel
            .store(true, Ordering::SeqCst);
    }

    pub fn paths(&self) -> AppPaths {
        self.inner.paths.clone()
    }

    pub fn with_db<T, F>(&self, action: F) -> AppResult<T>
    where
        F: FnOnce(&Connection) -> AppResult<T>,
    {
        let guard = self
            .inner
            .db
            .lock()
            .map_err(|_| AppError::State("Database mutex is poisoned".to_string()))?;
        action(&guard)
    }

    pub fn insert_runtime_job(&self, runtime_job: RuntimeJob) -> AppResult<()> {
        let mut jobs = self
            .inner
            .jobs
            .lock()
            .map_err(|_| AppError::State("Runtime job registry is poisoned".to_string()))?;
        jobs.insert(runtime_job.project_id.clone(), runtime_job);
        Ok(())
    }

    pub fn runtime_job(&self, project_id: &str) -> AppResult<Option<RuntimeJob>> {
        let jobs = self
            .inner
            .jobs
            .lock()
            .map_err(|_| AppError::State("Runtime job registry is poisoned".to_string()))?;
        Ok(jobs.get(project_id).cloned())
    }

    pub fn remove_runtime_job(&self, project_id: &str) -> AppResult<Option<RuntimeJob>> {
        let mut jobs = self
            .inner
            .jobs
            .lock()
            .map_err(|_| AppError::State("Runtime job registry is poisoned".to_string()))?;
        Ok(jobs.remove(project_id))
    }

    pub fn hardware_info(&self) -> AppResult<HardwareInfo> {
        let info = self
            .inner
            .hardware_info
            .lock()
            .map_err(|_| AppError::State("Hardware info mutex is poisoned".to_string()))?;
        Ok(info.clone())
    }
}
