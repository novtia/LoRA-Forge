/**
 * @file trainer/events.rs
 * @description 训练事件名称常量与结构化日志协议标识符。
 */

pub const TRAINING_PROGRESS_EVENT: &str = "training-progress";
pub const TRAINING_LOG_EVENT: &str = "training-log-line";
pub const TRAINING_STATE_EVENT: &str = "training-state-changed";
pub const SYSTEM_STATS_EVENT: &str = "system-stats-updated";

pub const STRUCTURED_LOG_PREFIX: &str = "@@LORA_FORGE_LOG@@";
pub const STRUCTURED_LOG_SCHEMA: &str = "lora-forge.training.log/v1";
