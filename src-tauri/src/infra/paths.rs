/**
 * @file infra/paths.rs
 * @description 应用磁盘路径布局（app_dir/db/jobs/hardware_cache），由 AppState 在启动时填充。
 */
use std::path::PathBuf;

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct AppPaths {
    pub app_dir: PathBuf,
    pub db_path: PathBuf,
    pub jobs_dir: PathBuf,
    pub hardware_cache_path: PathBuf,
}
