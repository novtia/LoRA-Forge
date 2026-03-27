pub mod config;
pub mod dataset;
pub mod projects;
pub mod system;
pub mod training;

use crate::error::AppResult;

pub fn respond<T>(result: AppResult<T>) -> Result<T, String> {
    result.map_err(|error| error.to_string())
}
