/**
 * @file domain/common.rs
 * @description 跨业务域共享的轻量类型：硬件信息、系统监控、外部 API 日志。
 */

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInfo {
    pub gpu_name: String,
    pub vram_total_gb: f32,
    pub detected_at: i64,
    pub source: String,
}

impl Default for HardwareInfo {
    fn default() -> Self {
        Self {
            gpu_name: "LOCAL DEVICE".to_string(),
            vram_total_gb: 24.0,
            detected_at: 0,
            source: "default".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub cpu_percent: f32,
    pub memory_used_gb: f32,
    pub memory_total_gb: f32,
    pub gpu_name: String,
    pub gpu_temp_c: f32,
    pub gpu_util_percent: f32,
    pub vram_used_gb: f32,
    pub vram_total_gb: f32,
}

impl Default for SystemStats {
    fn default() -> Self {
        Self {
            cpu_percent: 0.0,
            memory_used_gb: 0.0,
            memory_total_gb: 0.0,
            gpu_name: "LOCAL DEVICE".to_string(),
            gpu_temp_c: 0.0,
            gpu_util_percent: 0.0,
            vram_used_gb: 0.0,
            vram_total_gb: 24.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiLogEntry {
    pub created_at: i64,
    pub source: String,
    pub level: String,
    pub message: String,
}
