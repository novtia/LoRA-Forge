/**
 * @file infra/environment.rs
 * @description 本机环境只读巡检：探测 Python（Windows + WSL）、WSL 发行版、git、CUDA/驱动/GPU、磁盘空间。
 *   纯进程调用，不修改任何系统状态。
 */
use serde_json::Value;

use crate::{
    infra::process::{hidden_std_command, now_ts},
    models::{CudaInfo, DiskInfo, EnvironmentReport, PythonRuntime, WslDistroInfo},
};

/// Run a program and return trimmed stdout (falling back to stderr). `None` when both are empty.
fn cmd_output(program: &str, args: &[&str]) -> Option<String> {
    let output = hidden_std_command(program).args(args).output().ok()?;
    let mut text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        text = String::from_utf8_lossy(&output.stderr).trim().to_string();
    }
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn where_first(program: &str) -> Option<String> {
    let output = hidden_std_command("where").arg(program).output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
}

fn wsl_args(distro: &str) -> Option<String> {
    let trimmed = distro.trim();
    if trimmed.is_empty() || trimmed == "default" {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn run_wsl_capture(distro: &str, script: &str) -> Option<String> {
    let mut command = hidden_std_command("wsl");
    command.env("WSL_UTF8", "1");
    if let Some(name) = wsl_args(distro) {
        command.arg("-d").arg(name);
    }
    command.arg("--").arg("bash").arg("-lc").arg(script);
    let output = command.output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Python
// ─────────────────────────────────────────────────────────────────────────────

fn windows_python() -> Option<PythonRuntime> {
    let version = cmd_output("python", &["--version"])?;
    if !version.to_ascii_lowercase().contains("python") {
        return None;
    }
    let path = where_first("python").unwrap_or_default();
    Some(PythonRuntime {
        label: "Windows".to_string(),
        version: version.replacen("Python", "", 1).trim().to_string(),
        path,
        source: "windows".to_string(),
    })
}

fn wsl_python(distro: &str) -> Option<PythonRuntime> {
    let out = run_wsl_capture(
        distro,
        "python3 --version 2>&1; echo '@@SEP@@'; command -v python3 2>/dev/null",
    )?;
    let mut parts = out.split("@@SEP@@");
    let version_part = parts.next().unwrap_or("").trim().to_string();
    let path_part = parts.next().unwrap_or("").trim().to_string();
    if !version_part.to_ascii_lowercase().contains("python") {
        return None;
    }
    let label = match wsl_args(distro) {
        Some(name) => format!("WSL: {name}"),
        None => "WSL".to_string(),
    };
    Some(PythonRuntime {
        label,
        version: version_part.replacen("Python", "", 1).trim().to_string(),
        path: path_part,
        source: "wsl".to_string(),
    })
}

fn detect_pythons(distro: &str) -> Vec<PythonRuntime> {
    let mut pythons = Vec::new();
    if let Some(py) = windows_python() {
        pythons.push(py);
    }
    if let Some(py) = wsl_python(distro) {
        pythons.push(py);
    }
    pythons
}

// ─────────────────────────────────────────────────────────────────────────────
// WSL distros
// ─────────────────────────────────────────────────────────────────────────────

fn detect_wsl_distros() -> Vec<WslDistroInfo> {
    let mut command = hidden_std_command("wsl");
    command.env("WSL_UTF8", "1").arg("-l").arg("-v");
    let output = match command.output() {
        Ok(output) => output,
        Err(_) => return Vec::new(),
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let mut distros = Vec::new();
    for raw in text.lines() {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.starts_with("NAME") {
            continue;
        }
        let is_default = trimmed.starts_with('*');
        let rest = trimmed.trim_start_matches('*').trim();
        let cols: Vec<&str> = rest.split_whitespace().collect();
        if cols.is_empty() {
            continue;
        }
        distros.push(WslDistroInfo {
            name: cols.first().copied().unwrap_or("").to_string(),
            state: cols.get(1).copied().unwrap_or("").to_string(),
            version: cols.get(2).copied().unwrap_or("").to_string(),
            is_default,
        });
    }
    distros
}

// ─────────────────────────────────────────────────────────────────────────────
// CUDA / GPU
// ─────────────────────────────────────────────────────────────────────────────

fn detect_cuda() -> CudaInfo {
    let mut info = CudaInfo::default();

    if let Some(line) = cmd_output(
        "nvidia-smi",
        &[
            "--query-gpu=driver_version,name",
            "--format=csv,noheader,nounits",
        ],
    ) {
        if let Some(first) = line.lines().next() {
            let mut parts = first.split(',').map(str::trim);
            info.driver_version = parts.next().unwrap_or("").to_string();
            info.gpu_name = parts.next().unwrap_or("").to_string();
            info.available = !info.driver_version.is_empty();
        }
    }

    if info.available {
        if let Some(full) = cmd_output("nvidia-smi", &[]) {
            if let Some(idx) = full.find("CUDA Version:") {
                let tail = &full[idx + "CUDA Version:".len()..];
                info.cuda_version = tail.split_whitespace().next().unwrap_or("").to_string();
            }
        }
    }

    if let Some(nvcc) = cmd_output("nvcc", &["--version"]) {
        if let Some(idx) = nvcc.find("release ") {
            let tail = &nvcc[idx + "release ".len()..];
            info.nvcc_version = tail.split(',').next().unwrap_or("").trim().to_string();
        }
    }

    info
}

// ─────────────────────────────────────────────────────────────────────────────
// Disks
// ─────────────────────────────────────────────────────────────────────────────

fn json_number(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn bytes_to_gb(bytes: f64) -> f32 {
    ((bytes / 1024.0 / 1024.0 / 1024.0) * 10.0).round() as f32 / 10.0
}

fn detect_disks() -> Vec<DiskInfo> {
    let Some(json) = cmd_output(
        "powershell",
        &[
            "-NoProfile",
            "-Command",
            "Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free | ConvertTo-Json -Compress",
        ],
    ) else {
        return Vec::new();
    };

    let value: Value = match serde_json::from_str(&json) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let items = match value {
        Value::Array(items) => items,
        other => vec![other],
    };

    let mut disks = Vec::new();
    for item in items {
        let name = item
            .get("Name")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string();
        let used = item.get("Used").and_then(json_number).unwrap_or(0.0);
        let free = item.get("Free").and_then(json_number).unwrap_or(0.0);
        if used + free <= 0.0 {
            continue;
        }
        disks.push(DiskInfo {
            name,
            used_gb: bytes_to_gb(used),
            free_gb: bytes_to_gb(free),
            total_gb: bytes_to_gb(used + free),
        });
    }
    disks
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate
// ─────────────────────────────────────────────────────────────────────────────

pub fn inspect(distro: &str) -> EnvironmentReport {
    EnvironmentReport {
        pythons: detect_pythons(distro),
        wsl_distros: detect_wsl_distros(),
        git_version: cmd_output("git", &["--version"])
            .map(|value| value.replacen("git version", "", 1).trim().to_string())
            .unwrap_or_default(),
        cuda: detect_cuda(),
        disks: detect_disks(),
        detected_at: now_ts(),
    }
}
