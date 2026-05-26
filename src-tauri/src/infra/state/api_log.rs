/**
 * @file infra/state/api_log.rs
 * @description LLM / 外部 API 调用的内存环形日志（最近 400 条），供前端 system log 面板展示。
 */

use std::{
    collections::VecDeque,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::models::ApiLogEntry;

pub const API_LOG_CAP: usize = 400;

fn api_log_now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 内存环形日志存储；超过 `API_LOG_CAP` 自动丢弃最旧的条目。
pub struct ApiLogStore {
    entries: Mutex<VecDeque<ApiLogEntry>>,
}

impl ApiLogStore {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(VecDeque::with_capacity(API_LOG_CAP.min(64))),
        }
    }

    pub fn push(&self, source: &str, level: &str, message: impl Into<String>) {
        let entry = ApiLogEntry {
            created_at: api_log_now_ms(),
            source: source.to_string(),
            level: level.to_string(),
            message: message.into(),
        };
        let Ok(mut guard) = self.entries.lock() else {
            return;
        };
        while guard.len() >= API_LOG_CAP {
            guard.pop_front();
        }
        guard.push_back(entry);
    }

    pub fn recent(&self, mut limit: usize) -> Vec<ApiLogEntry> {
        limit = limit.min(API_LOG_CAP).max(1);
        let Ok(guard) = self.entries.lock() else {
            return Vec::new();
        };
        let skip = guard.len().saturating_sub(limit);
        guard.iter().skip(skip).cloned().collect()
    }

    pub fn clear(&self) {
        if let Ok(mut guard) = self.entries.lock() {
            guard.clear();
        }
    }
}

impl Default for ApiLogStore {
    fn default() -> Self {
        Self::new()
    }
}
