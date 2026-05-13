use std::{
    fs,
    path::Path,
    process::{Command, Stdio},
};

use serde::Deserialize;

use crate::{error::AppResult, models::HardwareInfo, utils::now_ts};

fn hidden_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd
}

#[derive(Debug, Clone)]
pub struct GpuRuntimeMetrics {
    pub gpu_name: String,
    pub gpu_temp_c: f32,
    pub gpu_util_percent: f32,
    pub vram_used_gb: f32,
    pub vram_total_gb: f32,
}

pub fn load_or_detect_hardware_info(cache_path: &Path) -> HardwareInfo {
    let cached = read_cached_hardware_info(cache_path).ok();

    match detect_hardware_info() {
        Some(info) => {
            let _ = write_hardware_cache(cache_path, &info);
            info
        }
        None => cached.unwrap_or_default(),
    }
}

fn read_cached_hardware_info(cache_path: &Path) -> AppResult<HardwareInfo> {
    let content = fs::read_to_string(cache_path)?;
    Ok(serde_json::from_str(&content)?)
}

fn write_hardware_cache(cache_path: &Path, info: &HardwareInfo) -> AppResult<()> {
    let payload = serde_json::to_string_pretty(info)?;
    fs::write(cache_path, payload)?;
    Ok(())
}

fn detect_hardware_info() -> Option<HardwareInfo> {
    detect_with_nvidia_smi().or_else(detect_with_windows_video_controller)
}

pub fn query_gpu_runtime_metrics() -> Option<GpuRuntimeMetrics> {
    let output = hidden_command("nvidia-smi")
        .args([
            "--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let content = String::from_utf8_lossy(&output.stdout);
    let line = content.lines().find(|line| !line.trim().is_empty())?;
    let mut parts = line.split(',').map(str::trim);

    let gpu_name = parts.next()?.to_string();
    let gpu_temp_c = parts.next()?.parse::<f32>().ok()?;
    let gpu_util_percent = parts.next()?.parse::<f32>().ok()?;
    let memory_used_mb = parts.next()?.parse::<f32>().ok()?;
    let memory_total_mb = parts.next()?.parse::<f32>().ok()?;

    Some(GpuRuntimeMetrics {
        gpu_name,
        gpu_temp_c,
        gpu_util_percent,
        vram_used_gb: round_gb_from_mb(memory_used_mb),
        vram_total_gb: round_gb_from_mb(memory_total_mb),
    })
}

fn detect_with_nvidia_smi() -> Option<HardwareInfo> {
    let output = hidden_command("nvidia-smi")
        .args([
            "--query-gpu=name,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let content = String::from_utf8_lossy(&output.stdout);
    let line = content.lines().find(|line| !line.trim().is_empty())?;
    let mut parts = line.split(',').map(str::trim);
    let gpu_name = parts.next()?.to_string();
    let memory_mb = parts.next()?.parse::<f32>().ok()?;

    Some(HardwareInfo {
        gpu_name,
        vram_total_gb: (memory_mb / 1024.0 * 10.0).round() / 10.0,
        detected_at: now_ts(),
        source: "nvidia-smi".to_string(),
    })
}

fn detect_with_windows_video_controller() -> Option<HardwareInfo> {
    let output = hidden_command("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_VideoController | Sort-Object -Property AdapterRAM -Descending | Select-Object -First 1 Name, AdapterRAM | ConvertTo-Json -Compress",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let content = String::from_utf8_lossy(&output.stdout);
    let parsed: WindowsVideoController = serde_json::from_str(content.trim()).ok()?;
    let vram_total_gb = parsed
        .adapter_ram
        .map(|bytes| (bytes as f32 / 1024.0 / 1024.0 / 1024.0 * 10.0).round() / 10.0)
        .filter(|value| *value > 0.0)
        .unwrap_or(24.0);

    Some(HardwareInfo {
        gpu_name: parsed.name,
        vram_total_gb,
        detected_at: now_ts(),
        source: "win32_video_controller".to_string(),
    })
}

#[derive(Debug, Deserialize)]
struct WindowsVideoController {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "AdapterRAM")]
    adapter_ram: Option<u64>,
}

fn round_gb_from_mb(value_mb: f32) -> f32 {
    (value_mb / 1024.0 * 10.0).round() / 10.0
}
