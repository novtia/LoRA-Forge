/**
 * @file commands/dataset/import.rs
 * @description 图片导入命令：拖拽/选择上传普通图片 `import_dataset_images`，
 *   编辑训练目标图+参考图配对上传 `import_edit_pair`，以及 control 目录映射的读写。
 */

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    commands::respond,
    db,
    error::{AppError, AppResult},
    models::DatasetEntry,
    state::AppState,
};

use super::browse::list_dataset_entries_inner;
use super::group::parent_relative_path;
use super::{join_dataset_relative, relative_path_from_dataset_root};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFileInput {
    /// Original file name (used to derive the extension and base stem).
    pub name: String,
    /// Base64-encoded raw file bytes (no data-URL prefix).
    pub data_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDatasetImagesInput {
    pub project_id: String,
    /// Target folder (relative to dataset root). Empty / "/" means dataset root.
    #[serde(default)]
    pub target_relative_path: String,
    pub files: Vec<ImportFileInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportEditPairInput {
    pub project_id: String,
    /// Folder for target (edited) images. Empty / "/" means dataset root.
    #[serde(default)]
    pub target_relative_path: String,
    /// Folder for control (reference) images.
    pub control_relative_path: String,
    /// Target image: original name + bytes.
    pub target: ImportFileInput,
    /// Control image: original name + bytes.
    pub control: ImportFileInput,
    /// Optional edit-instruction caption written next to the target image.
    #[serde(default)]
    pub caption: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditPairImportResult {
    pub target_relative_path: String,
    pub control_relative_path: String,
    pub entries: Vec<DatasetEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDatasetControlDirInput {
    pub project_id: String,
    pub target_relative_path: String,
    pub control_relative_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveDatasetControlDirInput {
    pub project_id: String,
    pub target_relative_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadDatasetControlDirsInput {
    pub project_id: String,
}

#[tauri::command]
pub fn import_dataset_images(
    input: ImportDatasetImagesInput,
    state: State<'_, AppState>,
) -> Result<Vec<DatasetEntry>, String> {
    respond(import_dataset_images_inner(state.inner().clone(), &input))
}

#[tauri::command]
pub fn import_edit_pair(
    input: ImportEditPairInput,
    state: State<'_, AppState>,
) -> Result<EditPairImportResult, String> {
    respond(import_edit_pair_inner(state.inner().clone(), &input))
}

#[tauri::command]
pub fn set_dataset_control_dir(
    input: SetDatasetControlDirInput,
    state: State<'_, AppState>,
) -> Result<(), String> {
    respond(state.inner().clone().with_db(|connection| {
        db::save_dataset_control_dir(
            connection,
            &input.project_id,
            input.target_relative_path.trim_matches('/'),
            input.control_relative_path.trim_matches('/'),
        )
    }))
}

#[tauri::command]
pub fn remove_dataset_control_dir(
    input: RemoveDatasetControlDirInput,
    state: State<'_, AppState>,
) -> Result<(), String> {
    respond(state.inner().clone().with_db(|connection| {
        db::remove_dataset_control_dir(
            connection,
            &input.project_id,
            input.target_relative_path.trim_matches('/'),
        )
    }))
}

#[tauri::command]
pub fn load_dataset_control_dirs(
    input: LoadDatasetControlDirsInput,
    state: State<'_, AppState>,
) -> Result<HashMap<String, String>, String> {
    respond(
        state
            .inner()
            .clone()
            .with_db(|connection| db::load_dataset_control_dirs(connection, &input.project_id)),
    )
}

/// Sanitizes a single file name into `(stem, ext_lowercase)`. Rejects names whose
/// extension is not a supported image type.
fn sanitize_image_file_name(name: &str) -> AppResult<(String, String)> {
    let raw = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(name);

    let ext = Path::new(raw)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "bmp") {
        return Err(AppError::Validation(format!(
            "Unsupported image file '{name}'."
        )));
    }

    let stem_raw = Path::new(raw)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");

    let mut cleaned = String::with_capacity(stem_raw.len());
    for ch in stem_raw.chars() {
        let mapped = match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        };
        cleaned.push(mapped);
    }
    let cleaned = cleaned
        .trim_matches(|c: char| c == '.' || c.is_whitespace())
        .to_string();
    let stem = if cleaned.is_empty() {
        "image".to_string()
    } else {
        cleaned.chars().take(120).collect()
    };

    Ok((stem, ext))
}

/// Returns an unused path `<dir>/<stem>.<ext>`, appending ` (n)` to the stem on collision.
fn unique_file_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let candidate = dir.join(format!("{stem}.{ext}"));
    if !candidate.exists() {
        return candidate;
    }
    for n in 2..10_000 {
        let candidate = dir.join(format!("{stem} ({n}).{ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{stem} ({}).{ext}", crate::utils::now_ts()))
}

/// Finds a stem unused in BOTH `target_dir` and `control_dir` (ignoring extension),
/// so the target/control pair can share an identical file stem.
fn unique_pair_stem(target_dir: &Path, control_dir: &Path, base_stem: &str) -> String {
    let stem_taken = |dir: &Path, stem: &str| -> bool {
        fs::read_dir(dir)
            .map(|read| {
                read.flatten().any(|entry| {
                    Path::new(&entry.file_name())
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .map(|s| s.eq_ignore_ascii_case(stem))
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    };
    if !stem_taken(target_dir, base_stem) && !stem_taken(control_dir, base_stem) {
        return base_stem.to_string();
    }
    for n in 2..10_000 {
        let candidate = format!("{base_stem} ({n})");
        if !stem_taken(target_dir, &candidate) && !stem_taken(control_dir, &candidate) {
            return candidate;
        }
    }
    format!("{base_stem} ({})", crate::utils::now_ts())
}

fn import_dataset_images_inner(
    state: AppState,
    input: &ImportDatasetImagesInput,
) -> AppResult<Vec<DatasetEntry>> {
    let project = state.with_db(|connection| db::get_project(connection, &input.project_id))?;
    let dataset_root = PathBuf::from(project.dataset_path);
    fs::create_dir_all(&dataset_root)?;

    let target_dir = join_dataset_relative(&dataset_root, &input.target_relative_path)?;
    fs::create_dir_all(&target_dir)?;

    if input.files.is_empty() {
        return Err(AppError::Validation("No files to import.".to_string()));
    }

    for file in &input.files {
        let (stem, ext) = sanitize_image_file_name(&file.name)?;
        let bytes = STANDARD
            .decode(file.data_base64.trim())
            .map_err(|err| AppError::Validation(format!("Invalid image data: {err}")))?;
        let dest = unique_file_path(&target_dir, &stem, &ext);
        fs::write(&dest, &bytes)?;
    }

    list_dataset_entries_inner(state, &input.project_id)
}

fn import_edit_pair_inner(
    state: AppState,
    input: &ImportEditPairInput,
) -> AppResult<EditPairImportResult> {
    let project = state.with_db(|connection| db::get_project(connection, &input.project_id))?;
    let dataset_root = PathBuf::from(project.dataset_path);
    fs::create_dir_all(&dataset_root)?;

    let control_rel = input.control_relative_path.trim_matches('/');
    if control_rel.is_empty() {
        return Err(AppError::Validation(
            "Control folder must be specified.".to_string(),
        ));
    }
    let target_rel = input.target_relative_path.trim_matches('/');

    let target_dir = join_dataset_relative(&dataset_root, target_rel)?;
    fs::create_dir_all(&target_dir)?;
    let control_dir = join_dataset_relative(&dataset_root, control_rel)?;
    fs::create_dir_all(&control_dir)?;

    let (base_stem, target_ext) = sanitize_image_file_name(&input.target.name)?;
    let (_, control_ext) = sanitize_image_file_name(&input.control.name)?;
    let stem = unique_pair_stem(&target_dir, &control_dir, &base_stem);

    let target_bytes = STANDARD
        .decode(input.target.data_base64.trim())
        .map_err(|err| AppError::Validation(format!("Invalid target image data: {err}")))?;
    let control_bytes = STANDARD
        .decode(input.control.data_base64.trim())
        .map_err(|err| AppError::Validation(format!("Invalid control image data: {err}")))?;

    let target_path = target_dir.join(format!("{stem}.{target_ext}"));
    fs::write(&target_path, &target_bytes)?;
    let control_path = control_dir.join(format!("{stem}.{control_ext}"));
    fs::write(&control_path, &control_bytes)?;

    if let Some(caption) = &input.caption {
        let caption = caption.trim();
        if !caption.is_empty() {
            fs::write(target_path.with_extension("txt"), caption)?;
        }
    }

    let target_relative_path = relative_path_from_dataset_root(&dataset_root, &target_path)?;
    let control_relative_path = relative_path_from_dataset_root(&dataset_root, &control_path)?;

    // Register the target → control directory mapping so dataset TOML generation can
    // emit `control_path`. The mapping is keyed by the target folder relative path.
    let target_group_rel = if target_rel.is_empty() {
        // Files dropped directly into the dataset root cannot carry a per-folder
        // mapping; fall back to the parent folder of the written target image.
        parent_relative_path(&target_relative_path)
    } else {
        target_rel.to_string()
    };

    state.with_db(|connection| {
        db::save_dataset_control_dir(
            connection,
            &input.project_id,
            &target_group_rel,
            control_rel,
        )
    })?;

    let entries = list_dataset_entries_inner(state, &input.project_id)?;
    Ok(EditPairImportResult {
        target_relative_path,
        control_relative_path,
        entries,
    })
}
