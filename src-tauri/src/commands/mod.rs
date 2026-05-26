/**
 * @file commands/mod.rs
 * @description Tauri 命令层入口：声明各子模块，暴露 respond() 工具。
 */

pub mod api_log;
pub mod dataset;
pub mod llm;
pub mod projects;
pub mod settings;
pub mod system;
pub mod training;

use crate::error::AppResult;

pub fn respond<T>(result: AppResult<T>) -> Result<T, String> {
    result.map_err(|error| error.to_string())
}
