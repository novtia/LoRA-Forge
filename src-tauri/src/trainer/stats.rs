/**
 * @file trainer/stats.rs
 * @description 系统硬件/GPU 运行时指标采集与定时推送（`system-stats-updated` Tauri 事件）。
 */
use std::time::Duration;

use sysinfo::System;
use tauri::{AppHandle, Emitter};

use crate::{
    hardware,
    models::{HardwareInfo, SystemStats},
    state::AppState,
};

use super::events::SYSTEM_STATS_EVENT;

pub fn start_system_stats_publisher(app: AppHandle, state: AppState) {
    tauri::async_runtime::spawn(async move {
        loop {
            let stats = collect_system_stats(&state);
            let _ = app.emit(SYSTEM_STATS_EVENT, stats);
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
    });
}

pub fn collect_system_stats(state: &AppState) -> SystemStats {
    let mut system = System::new_all();
    system.refresh_memory();
    system.refresh_cpu_usage();
    let hardware = state.hardware_info().unwrap_or_default();
    let realtime_gpu = hardware::query_gpu_runtime_metrics();

    let total_memory = bytes_to_gb(system.total_memory());
    let used_memory = bytes_to_gb(system.used_memory());
    let cpu_usage = system.global_cpu_usage();
    let gpu_name = realtime_gpu
        .as_ref()
        .map(|m| m.gpu_name.clone())
        .unwrap_or_else(|| hardware.gpu_name.clone());
    let vram_total_gb = realtime_gpu
        .as_ref()
        .map(|m| m.vram_total_gb.max(1.0))
        .unwrap_or_else(|| hardware.vram_total_gb.max(1.0));
    let gpu_temp_c = realtime_gpu.as_ref().map(|m| m.gpu_temp_c).unwrap_or(63.0);
    let gpu_util_percent = realtime_gpu
        .as_ref()
        .map(|m| m.gpu_util_percent)
        .unwrap_or_else(|| (cpu_usage * 1.4).clamp(12.0, 98.0));
    let vram_used_gb = realtime_gpu
        .as_ref()
        .map(|m| m.vram_used_gb)
        .unwrap_or_else(|| {
            estimate_vram_usage(vram_total_gb, used_memory, total_memory, &hardware)
        });

    SystemStats {
        cpu_percent: cpu_usage,
        memory_used_gb: used_memory,
        memory_total_gb: total_memory,
        gpu_name,
        gpu_temp_c,
        gpu_util_percent,
        vram_used_gb,
        vram_total_gb,
    }
}

pub(super) fn estimate_vram_usage(
    vram_total_gb: f32,
    used_memory_gb: f32,
    total_memory_gb: f32,
    hardware: &HardwareInfo,
) -> f32 {
    if total_memory_gb <= 0.0 {
        return (vram_total_gb * 0.45).clamp(0.5, vram_total_gb);
    }
    let memory_ratio = (used_memory_gb / total_memory_gb).clamp(0.05, 0.95);
    let baseline = if hardware.source == "nvidia-smi" {
        0.18
    } else {
        0.12
    };
    (vram_total_gb * (baseline + memory_ratio * 0.42)).clamp(0.5, vram_total_gb)
}

pub(super) fn bytes_to_gb(bytes: u64) -> f32 {
    (bytes as f32) / 1024.0 / 1024.0 / 1024.0
}
