pub mod batch;
pub mod browse;
pub mod caption;
pub mod group;
pub mod import;

use std::{
    fs,
    path::{Path, PathBuf},
};

use std::collections::HashMap;

use crate::{
    error::{AppError, AppResult},
    models::{DatasetEntry, DatasetEntryKind, DatasetGroupType},
    utils::{cmp_str_natural, ensure_within, normalize_relative_path},
};

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCaptionInput {
    pub project_id: String,
    pub relative_path: String,
    pub caption: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupDatasetImagesInput {
    pub project_id: String,
    /// Image relative paths (dataset-root-relative, forward-slash separated) to move
    /// into the new group folder.
    pub relative_paths: Vec<String>,
    /// Display name for the new group; will be sanitized into a folder name.
    pub group_name: String,
    /// Optional parent folder (dataset-root-relative) under which the new group is
    /// created. When `None` or empty, the group folder is created directly under
    /// the dataset root.
    pub parent_relative_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveDatasetImagesInput {
    pub project_id: String,
    pub relative_paths: Vec<String>,
    /// Existing target folder (relative to dataset root). Empty string / "/" means root.
    pub target_relative_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameDatasetGroupInput {
    pub project_id: String,
    pub group_relative_path: String,
    pub new_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveDatasetGroupInput {
    pub project_id: String,
    pub group_relative_path: String,
    /// When `true`, recursively delete the directory and any contents. When
    /// `false`, the call fails if non-image content remains beneath the group.
    #[serde(default)]
    pub delete_contents: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDatasetGroupTypeInput {
    pub project_id: String,
    pub group_relative_path: String,
    /// "normal" | "reg"
    pub group_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchRenameDatasetImagesInput {
    pub project_id: String,
    pub relative_paths: Vec<String>,
    pub base_name: String,
    #[serde(default = "default_rename_start_index")]
    pub start_index: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchConvertDatasetExtensionsInput {
    pub project_id: String,
    pub relative_paths: Vec<String>,
    /// Target extension without dot, e.g. "png", "jpg", "webp".
    pub target_extension: String,
}

fn default_rename_start_index() -> u32 {
    1
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListUntaggedImagePathsInput {
    pub project_id: String,
    /// Dataset-root-relative paths of images to check.
    pub relative_paths: Vec<String>,
}

pub(super) fn visit_dataset(
    root: &Path,
    current: &Path,
    depth: u32,
    entries: &mut Vec<DatasetEntry>,
    group_types: &HashMap<String, String>,
) -> AppResult<()> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        let relative = normalize_relative_path(path.strip_prefix(root)?);
        let name = entry.file_name().to_string_lossy().to_string();
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            let group_type = group_types
                .get(&relative)
                .map(|s| DatasetGroupType::from_str(s));
            entries.push(DatasetEntry {
                relative_path: relative.clone(),
                name,
                kind: DatasetEntryKind::Directory,
                depth,
                group_type,
            });
            visit_dataset(root, &path, depth + 1, entries, group_types)?;
        } else if is_image_file(&path) {
            entries.push(DatasetEntry {
                relative_path: relative,
                name,
                kind: DatasetEntryKind::Image,
                depth,
                group_type: None,
            });
        } else {
            entries.push(DatasetEntry {
                relative_path: relative,
                name,
                kind: DatasetEntryKind::File,
                depth,
                group_type: None,
            });
        }
    }

    Ok(())
}

pub(super) fn collect_images(root: &Path) -> AppResult<Vec<PathBuf>> {
    let mut images = Vec::new();
    visit_images(root, &mut images)?;
    images
        .sort_by(|left, right| cmp_str_natural(&left.to_string_lossy(), &right.to_string_lossy()));
    Ok(images)
}

pub(super) fn visit_images(current: &Path, images: &mut Vec<PathBuf>) -> AppResult<()> {
    if !current.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            visit_images(&path, images)?;
        } else if is_image_file(&path) {
            images.push(path);
        }
    }

    Ok(())
}

pub(super) fn resolve_dataset_path(root: &Path, relative_path: &str) -> AppResult<PathBuf> {
    let target = root.join(relative_path.replace('/', std::path::MAIN_SEPARATOR_STR));
    ensure_within(root, &target)
}

/// Joins a dataset-relative directory/file path under `root` without requiring the
/// target to already exist (unlike [`resolve_dataset_path`], which canonicalizes via
/// [`ensure_within`] and fails with IO error 2 on missing paths).
pub(super) fn join_dataset_relative(root: &Path, relative_path: &str) -> AppResult<PathBuf> {
    let trimmed = relative_path.trim().trim_matches('/');
    if trimmed.is_empty() || trimmed == "." {
        return Ok(root.to_path_buf());
    }
    for segment in trimmed.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            return Err(AppError::Validation(
                "Dataset path must not contain '..'.".to_string(),
            ));
        }
        if segment.contains('\\') {
            return Err(AppError::Validation(format!(
                "Invalid dataset path segment '{segment}'."
            )));
        }
    }
    Ok(root.join(trimmed.replace('/', std::path::MAIN_SEPARATOR_STR)))
}

/// Returns a forward-slash dataset-relative path after the file has been written.
pub(super) fn relative_path_from_dataset_root(
    dataset_root: &Path,
    absolute: &Path,
) -> AppResult<String> {
    let canon_root = fs::canonicalize(dataset_root)?;
    let canon_abs = fs::canonicalize(absolute)?;
    Ok(normalize_relative_path(
        canon_abs.strip_prefix(&canon_root).map_err(|_| {
            AppError::Validation(format!(
                "Path '{}' is outside dataset root '{}'.",
                absolute.display(),
                dataset_root.display()
            ))
        })?,
    ))
}

pub(super) fn caption_path_for_image(path: &Path) -> PathBuf {
    path.with_extension("txt")
}

pub(super) fn read_caption_file(path: &Path) -> AppResult<String> {
    let caption_path = caption_path_for_image(path);
    if caption_path.exists() {
        Ok(fs::read_to_string(caption_path)?.trim().to_string())
    } else {
        Ok(String::new())
    }
}

pub(super) fn is_image_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "bmp"
            )
        })
        .unwrap_or(false)
}
