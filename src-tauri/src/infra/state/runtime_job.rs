/**
 * @file infra/state/runtime_job.rs
 * @description 进行中的训练任务句柄（child 进程 + control_file + 控制模式）。
 */

use std::{path::PathBuf, sync::Arc};

use tokio::process::Child;

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
