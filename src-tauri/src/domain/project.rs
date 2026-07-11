/**
 * @file domain/project.rs
 * @description 项目领域类型：`ProjectStatus` 状态机 + `ProjectRecord` 持久化模型。
 */
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProjectStatus {
    Ready,
    Running,
    Paused,
    Completed,
    Error,
    Interrupted,
    Aborted,
}

impl Default for ProjectStatus {
    fn default() -> Self {
        Self::Ready
    }
}

impl ProjectStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Completed => "completed",
            Self::Error => "error",
            Self::Interrupted => "interrupted",
            Self::Aborted => "aborted",
        }
    }

    pub fn from_db(value: &str) -> Self {
        match value {
            "running" => Self::Running,
            "paused" => Self::Paused,
            "completed" => Self::Completed,
            "error" => Self::Error,
            "interrupted" => Self::Interrupted,
            "aborted" => Self::Aborted,
            _ => Self::Ready,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub dataset_path: String,
    pub output_path: String,
    pub status: ProjectStatus,
    pub tags: Vec<String>,
    pub size_bytes: u64,
    pub updated_at: i64,
}
