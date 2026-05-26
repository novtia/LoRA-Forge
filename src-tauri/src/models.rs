/**
 * @file models.rs
 * @description Phase 2 兼容薄壳：领域类型按业务域拆分到 `domain/` 子模块，此处仅做 re-export
 *   兼容旧的 `use crate::models::*` 调用点；后续阶段会把调用点逐步切到 `crate::domain::*`。
 */

#[allow(unused_imports)]
pub use crate::domain::{
    baidu::BaiduTranslateSettings,
    common::{ApiLogEntry, HardwareInfo, SystemStats},
    dataset::{
        BatchDatasetImageMutationResult, DatasetAsset, DatasetEntry, DatasetEntryKind,
        DatasetGroupType, DatasetImagePathMapping, DatasetPreviewAsset, SampleImageEntry,
    },
    llm::{
        resolve_effective_llm_settings, CaptionTagMode, EndpointKind, LlmGlobalSettings,
        LlmModelSource, LlmProvider, LlmProviderModelEntry, LlmProviderSummary, LlmSettings,
        PriorCaptionMode, ReasoningEffort,
    },
    project::{ProjectRecord, ProjectStatus},
    training::{
        ActiveJobSummary, DiffusionPipeConfig, JobStatus, LossPoint, TrainingConfig,
        TrainingEnvSettings, TrainingLogEvent, TrainingLogLine, TrainingProgressEvent,
        TrainingSnapshot, TrainingStateChangedEvent,
    },
};
