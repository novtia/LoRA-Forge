pub mod api_log;
pub mod baidu_translate;
pub mod config;
pub mod dataset;
pub mod llm_provider;
pub mod projects;
pub mod system;
pub mod training;

use crate::error::AppResult;

pub fn respond<T>(result: AppResult<T>) -> Result<T, String> {
    result.map_err(|error| error.to_string())
}
