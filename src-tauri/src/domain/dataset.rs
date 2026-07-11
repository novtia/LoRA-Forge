/**
 * @file domain/dataset.rs
 * @description 数据集相关领域类型：目录条目、分组、批量重命名结果、资产/预览/样图。
 */
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DatasetEntryKind {
    Directory,
    Image,
    File,
}

/// Logical role of a directory group in the dataset.
/// `Normal` = regular training images; `Reg` = regularization images (`is_reg = true` in sd-scripts).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum DatasetGroupType {
    #[default]
    Normal,
    Reg,
}

impl DatasetGroupType {
    pub fn from_str(s: &str) -> Self {
        match s {
            "reg" => Self::Reg,
            _ => Self::Normal,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetEntry {
    pub relative_path: String,
    pub name: String,
    pub kind: DatasetEntryKind,
    pub depth: u32,
    /// Present only for `Directory` kind entries.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_type: Option<DatasetGroupType>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetImagePathMapping {
    pub old_relative_path: String,
    pub new_relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchDatasetImageMutationResult {
    pub entries: Vec<DatasetEntry>,
    pub path_mappings: Vec<DatasetImagePathMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetAsset {
    pub relative_path: String,
    pub name: String,
    pub file_path: String,
    pub caption: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetPreviewAsset {
    pub relative_path: String,
    pub name: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleImageEntry {
    pub relative_path: String,
    pub name: String,
    pub file_path: String,
    pub depth: u32,
    pub modified_at: u64,
}
