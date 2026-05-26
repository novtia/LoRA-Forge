/**
 * @file trainer/log_parser.rs
 * @description 训练日志解析：结构化日志（`@@LORA_FORGE_LOG@@` 前缀）、sd-scripts tqdm 进度行、
 *   deepspeed 进度行、日志级别规范化等。
 */

use serde::Deserialize;
use serde_json::{Map, Value};

use super::events::{STRUCTURED_LOG_PREFIX, STRUCTURED_LOG_SCHEMA};

#[derive(Default)]
pub(super) struct ParsedProgress {
    pub epoch: Option<u32>,
    pub epoch_total: Option<u32>,
    pub step: Option<u32>,
    pub step_total: Option<u32>,
    pub loss: Option<f64>,
    pub lr: Option<f64>,
    pub runtime_seconds: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(super) struct StructuredLogRecord {
    pub schema: Option<String>,
    pub kind: String,
    pub stage: String,
    pub code: String,
    pub level: String,
    pub message: String,
    #[serde(default)]
    pub metrics: Map<String, Value>,
}

pub(super) fn parse_structured_log_line(line: &str) -> Option<StructuredLogRecord> {
    let payload = line.strip_prefix(STRUCTURED_LOG_PREFIX)?;
    let record = serde_json::from_str::<StructuredLogRecord>(payload).ok()?;
    if record.schema.as_deref() != Some(STRUCTURED_LOG_SCHEMA) {
        return None;
    }
    Some(record)
}

pub(super) fn progress_from_structured_log(record: &StructuredLogRecord) -> Option<ParsedProgress> {
    if record.kind != "progress" {
        return None;
    }
    let parsed = ParsedProgress {
        epoch: metric_as_u32(&record.metrics, "epoch"),
        epoch_total: metric_as_u32(&record.metrics, "epochTotal"),
        step: metric_as_u32(&record.metrics, "step"),
        step_total: metric_as_u32(&record.metrics, "stepTotal"),
        loss: metric_as_f64(&record.metrics, "loss"),
        lr: metric_as_f64(&record.metrics, "lr"),
        runtime_seconds: metric_as_u64(&record.metrics, "runtimeSeconds"),
    };
    if parsed.epoch.is_none()
        && parsed.epoch_total.is_none()
        && parsed.step.is_none()
        && parsed.step_total.is_none()
        && parsed.loss.is_none()
        && parsed.lr.is_none()
        && parsed.runtime_seconds.is_none()
    {
        return None;
    }
    Some(parsed)
}

pub(super) fn metric_as_u32(metrics: &Map<String, Value>, key: &str) -> Option<u32> {
    metric_as_u64(metrics, key).map(|v| v as u32)
}

pub(super) fn metric_as_u64(metrics: &Map<String, Value>, key: &str) -> Option<u64> {
    match metrics.get(key)? {
        Value::Number(n) => n.as_u64(),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

pub(super) fn metric_as_f64(metrics: &Map<String, Value>, key: &str) -> Option<f64> {
    match metrics.get(key)? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

pub(super) fn serialize_metrics(metrics: &Map<String, Value>) -> Option<String> {
    if metrics.is_empty() { None } else { serde_json::to_string(metrics).ok() }
}

pub(super) fn parse_progress_line(line: &str) -> Option<ParsedProgress> {
    if line.starts_with("TRAIN ") {
        let mut parsed = ParsedProgress::default();
        for token in line.split_whitespace().skip(1) {
            if let Some((key, value)) = token.split_once('=') {
                match key {
                    "epoch" => {
                        let (cur, tot) = parse_pair(value)?;
                        parsed.epoch = Some(cur);
                        parsed.epoch_total = Some(tot);
                    }
                    "step" => {
                        let (cur, tot) = parse_pair(value)?;
                        parsed.step = Some(cur);
                        parsed.step_total = Some(tot);
                    }
                    "loss" => parsed.loss = value.parse().ok(),
                    "lr" => parsed.lr = value.parse().ok(),
                    "runtime" => parsed.runtime_seconds = value.parse().ok(),
                    _ => {}
                }
            }
        }
        return Some(parsed);
    }
    if let Some(epoch_token) = line.strip_prefix("epoch ") {
        let (cur, tot) = parse_pair(epoch_token.trim())?;
        return Some(ParsedProgress { epoch: Some(cur), epoch_total: Some(tot), ..ParsedProgress::default() });
    }
    if line.contains("steps:") {
        let (step, step_total) = find_numeric_pair(line)?;
        return Some(ParsedProgress {
            step: Some(step),
            step_total: Some(step_total),
            loss: extract_float_after(line, "avr_loss=").or_else(|| extract_float_after(line, "loss=")),
            ..ParsedProgress::default()
        });
    }
    None
}

pub(super) fn parse_deepspeed_progress_line(line: &str) -> Option<ParsedProgress> {
    if let Some(rest) = line.strip_prefix("steps: ") {
        let step_end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
        let step: Option<u32> = rest[..step_end].parse().ok();
        if step.is_some() {
            return Some(ParsedProgress { step, loss: extract_float_after(rest, "loss: "), ..ParsedProgress::default() });
        }
    }
    if line.contains("step=") && line.contains("lr=") {
        let mut parsed = ParsedProgress::default();
        for token in line.split(',') {
            let token = token.trim();
            if let Some(val) = token.strip_prefix("step=") {
                parsed.step = val.trim().parse().ok();
            } else if let Some(val) = token.strip_prefix("lr=") {
                let lr_str = val.trim().trim_start_matches('[');
                let first = lr_str.split(',').next().unwrap_or("").trim().trim_end_matches(']');
                parsed.lr = first.parse().ok();
            }
        }
        if parsed.step.is_some() {
            return Some(parsed);
        }
    }
    if let Some(epoch_str) = line.strip_prefix("Started new epoch: ") {
        let epoch: u32 = epoch_str.trim().parse().ok()?;
        return Some(ParsedProgress { epoch: Some(epoch), ..ParsedProgress::default() });
    }
    None
}

pub(super) fn parse_pair(value: &str) -> Option<(u32, u32)> {
    let (left, right) = value.split_once('/')?;
    Some((left.parse().ok()?, right.parse().ok()?))
}

pub(super) fn find_numeric_pair(value: &str) -> Option<(u32, u32)> {
    let bytes = value.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if !bytes[i].is_ascii_digit() { i += 1; continue; }
        let start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() { i += 1; }
        if i >= bytes.len() || bytes[i] != b'/' { continue; }
        let left = value[start..i].parse().ok()?;
        i += 1;
        let right_start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() { i += 1; }
        if right_start == i { continue; }
        let right = value[right_start..i].parse().ok()?;
        return Some((left, right));
    }
    None
}

pub(super) fn extract_float_after(value: &str, marker: &str) -> Option<f64> {
    let start = value.find(marker)? + marker.len();
    let tail = &value[start..];
    let end = tail.find(|c: char| !(c.is_ascii_digit() || matches!(c, '.' | '-' | '+' | 'e' | 'E'))).unwrap_or(tail.len());
    tail[..end].parse().ok()
}

pub(super) fn normalize_log_level(level: &str) -> String {
    match level.trim().to_ascii_lowercase().as_str() {
        "warning" => "warn".to_string(),
        "completed" => "success".to_string(),
        "critical" | "failed" => "error".to_string(),
        other => other.to_string(),
    }
}

pub(super) fn infer_log_level(line: &str) -> String {
    let lowered = line.to_ascii_lowercase();
    if lowered.contains("error") || lowered.contains("exception") || lowered.contains("traceback") {
        "error".to_string()
    } else if lowered.contains("warn") || lowered.contains("disk space") {
        "warn".to_string()
    } else if lowered.contains("checkpoint") || lowered.contains("complete") || lowered.contains("saved.") {
        "success".to_string()
    } else {
        "info".to_string()
    }
}

pub(super) fn parse_lr(value: &str) -> f64 {
    value.parse::<f64>().unwrap_or(0.00015)
}
