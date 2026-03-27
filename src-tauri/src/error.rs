use std::{io, path::StripPrefixError};

use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Tauri error: {0}")]
    Tauri(#[from] tauri::Error),
    #[error("Process error: {0}")]
    Process(String),
    #[error("State error: {0}")]
    State(String),
}

impl From<StripPrefixError> for AppError {
    fn from(error: StripPrefixError) -> Self {
        Self::Validation(format!("Path is outside the allowed workspace: {error}"))
    }
}
