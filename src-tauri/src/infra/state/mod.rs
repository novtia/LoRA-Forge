/**
 * @file infra/state/mod.rs
 * @description Tauri 进程范围内的全局可变状态容器：DB 连接池、运行中任务表、硬件信息、API 日志、LLM 取消标志。
 */

pub mod api_log;
pub mod runtime_job;

use std::{
    collections::HashMap,
    fs,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::{
    error::{AppError, AppResult},
    infra::{db, hardware, paths::AppPaths},
    models::{ApiLogEntry, HardwareInfo},
};

pub use api_log::ApiLogStore;
pub use runtime_job::{RuntimeJob, RuntimeJobControlMode};

struct AppStateInner {
    paths: AppPaths,
    db: Mutex<Connection>,
    jobs: Mutex<HashMap<String, RuntimeJob>>,
    hardware_info: Mutex<HardwareInfo>,
    llm_caption_cancel: Arc<AtomicBool>,
    api_logs: ApiLogStore,
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
                api_logs: ApiLogStore::new(),
            }),
        })
    }

    pub fn push_api_log(&self, source: &str, level: &str, message: impl Into<String>) {
        self.inner.api_logs.push(source, level, message);
    }

    pub fn recent_api_logs(&self, limit: usize) -> Vec<ApiLogEntry> {
        self.inner.api_logs.recent(limit)
    }

    pub fn clear_api_logs(&self) {
        self.inner.api_logs.clear();
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
