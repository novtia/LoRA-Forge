use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use rusqlite::Connection;
use tauri::{AppHandle, Manager};
use tokio::process::Child;

use crate::{
    db,
    error::{AppError, AppResult},
    hardware,
    models::HardwareInfo,
};

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
    pub control_file: PathBuf,
    pub control_mode: RuntimeJobControlMode,
    pub child: Arc<tokio::sync::Mutex<Child>>,
}

struct AppStateInner {
    paths: AppPaths,
    db: Mutex<Connection>,
    jobs: Mutex<HashMap<String, RuntimeJob>>,
    hardware_info: Mutex<HardwareInfo>,
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
            }),
        })
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
