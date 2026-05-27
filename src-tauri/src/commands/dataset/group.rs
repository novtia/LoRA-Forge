/**
 * @file commands/dataset/group.rs
 * @description 分组命令：创建组/移动图片/重命名组/删除组/设置组类型。
 */

use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use tauri::State;

use crate::{
    commands::respond,
    db,
    error::{AppError, AppResult},
    models::DatasetEntry,
    state::AppState,
    utils::normalize_relative_path,
};

use super::{
    GroupDatasetImagesInput, MoveDatasetImagesInput, RemoveDatasetGroupInput,
    RenameDatasetGroupInput, SetDatasetGroupTypeInput, caption_path_for_image,
    is_image_file, resolve_dataset_path,
};
use super::browse::list_dataset_entries_inner;

#[tauri::command]
pub fn group_dataset_images(
    input: GroupDatasetImagesInput,
    state: State<'_, AppState>,
) -> Result<Vec<DatasetEntry>, String> {
    respond(group_dataset_images_inner(state.inner().clone(), &input))
}

#[tauri::command]
pub fn move_dataset_images(
    input: MoveDatasetImagesInput,
    state: State<'_, AppState>,
) -> Result<Vec<DatasetEntry>, String> {
    respond(move_dataset_images_inner(state.inner().clone(), &input))
}

#[tauri::command]
pub fn rename_dataset_group(
    input: RenameDatasetGroupInput,
    state: State<'_, AppState>,
) -> Result<Vec<DatasetEntry>, String> {
    respond(rename_dataset_group_inner(state.inner().clone(), &input))
}

#[tauri::command]
pub fn remove_dataset_group(
    input: RemoveDatasetGroupInput,
    state: State<'_, AppState>,
) -> Result<Vec<DatasetEntry>, String> {
    respond(remove_dataset_group_inner(state.inner().clone(), &input))
}

#[tauri::command]
pub fn set_dataset_group_type(
    input: SetDatasetGroupTypeInput,
    state: State<'_, AppState>,
) -> Result<Vec<DatasetEntry>, String> {
    respond(set_dataset_group_type_inner(state.inner().clone(), &input))
}

pub(super) fn sanitize_group_segment(name: &str) -> AppResult<String> {
    let trimmed = name.trim().trim_matches(|c: char| c == '.' || c.is_whitespace());
    if trimmed.is_empty() {
        return Err(AppError::Validation(
            "Group name must not be empty.".to_string(),
        ));
    }

    let mut cleaned = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
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
    if cleaned.is_empty() {
        return Err(AppError::Validation(
            "Group name contains only unsupported characters.".to_string(),
        ));
    }

    // Reject reserved Windows device names (case-insensitive).
    let upper = cleaned.to_ascii_uppercase();
    const RESERVED: &[&str] = &[
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
        "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let bare = upper.split('.').next().unwrap_or("");
    if RESERVED.contains(&bare) {
        return Err(AppError::Validation(format!(
            "Group name '{cleaned}' is a reserved system name."
        )));
    }

    // Most file systems cap a single segment around 255 bytes.
    let truncated: String = cleaned.chars().take(120).collect();
    Ok(truncated)
}

/// Resolves a dataset-root-relative parent directory; an empty/`"."`/`"/"` input maps to
/// the dataset root itself.
pub(super) fn resolve_dataset_parent_dir(dataset_root: &Path, parent_relative: &str) -> AppResult<PathBuf> {
    let trimmed = parent_relative.trim().trim_matches('/');
    if trimmed.is_empty() || trimmed == "." {
        return Ok(dataset_root.to_path_buf());
    }
    let resolved = resolve_dataset_path(dataset_root, trimmed)?;
    if !resolved.is_dir() {
        return Err(AppError::Validation(format!(
            "Parent path '{trimmed}' is not a directory."
        )));
    }
    Ok(resolved)
}

/// Generates `<base>`, `<base> (2)`, `<base> (3)`… until an unused folder name is
/// found inside `parent_dir`. Used when the user-supplied group name collides with
/// an existing sibling — the caller still saves the user's intent verbatim where
/// possible and only falls back to a numeric suffix when needed.
fn unique_group_folder(parent_dir: &Path, base: &str) -> PathBuf {
    let candidate = parent_dir.join(base);
    if !candidate.exists() {
        return candidate;
    }
    for n in 2..1000 {
        let suffixed = parent_dir.join(format!("{base} ({n})"));
        if !suffixed.exists() {
            return suffixed;
        }
    }
    // Extremely unlikely; fall back to timestamp suffix.
    let ts = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    parent_dir.join(format!("{base} ({ts})"))
}

/// Moves one image and its sibling `.txt` caption into `target_dir`, returning the
/// new dataset-relative path on success. Skips the file when the source already
/// resides in the destination.
fn move_image_into_dir(
    dataset_root: &Path,
    canonical_dataset_root: &Path,
    relative_path: &str,
    target_dir: &Path,
) -> AppResult<Option<String>> {
    let source = resolve_dataset_path(dataset_root, relative_path)?;
    if !source.is_file() || !is_image_file(&source) {
        return Err(AppError::Validation(format!(
            "'{relative_path}' is not an image file."
        )));
    }

    // Make sure both `source` and `target_dir` are in the same canonical form before
    // we compare or strip prefixes. On Windows `fs::canonicalize` returns extended
    // length paths (with the `\\?\` prefix), so mixing canonical with non-canonical
    // paths breaks both the "already in target" short-circuit and the trailing
    // `strip_prefix(canonical_dataset_root)` call. We canonicalize `target_dir` once
    // up-front and derive everything else from it.
    let canonical_target_dir = fs::canonicalize(target_dir)?;
    if source
        .parent()
        .and_then(|p| fs::canonicalize(p).ok())
        .as_deref()
        == Some(&canonical_target_dir)
    {
        return Ok(None);
    }

    let file_name = source
        .file_name()
        .ok_or_else(|| AppError::Validation(format!("Invalid file name in '{relative_path}'")))?
        .to_owned();

    let mut dest = canonical_target_dir.join(&file_name);
    if dest.exists() {
        // Disambiguate by appending a numeric suffix to the stem so we never silently
        // overwrite a pre-existing image inside the destination group.
        let stem = Path::new(&file_name)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "image".to_string());
        let ext = Path::new(&file_name)
            .extension()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        for n in 2..10_000 {
            let candidate_name = if ext.is_empty() {
                format!("{stem} ({n})")
            } else {
                format!("{stem} ({n}).{ext}")
            };
            let candidate = canonical_target_dir.join(&candidate_name);
            if !candidate.exists() {
                dest = candidate;
                break;
            }
        }
    }

    fs::rename(&source, &dest).or_else(|_| {
        // Cross-device fallback: copy then remove the original. Note that on Windows
        // moving across drive letters (e.g. dataset on D:, system on C:) returns an
        // OS error from `rename`, so we always need this fallback in practice.
        fs::copy(&source, &dest)?;
        fs::remove_file(&source)?;
        Ok::<(), AppError>(())
    })?;

    // Move the sibling caption (.txt) if present, mirroring the new file stem.
    let source_caption = caption_path_for_image(&source);
    if source_caption.exists() {
        let dest_caption = caption_path_for_image(&dest);
        fs::rename(&source_caption, &dest_caption).or_else(|_| {
            fs::copy(&source_caption, &dest_caption)?;
            fs::remove_file(&source_caption)?;
            Ok::<(), AppError>(())
        })?;
    }

    // Both `dest` and `canonical_dataset_root` are canonical, so strip_prefix is
    // guaranteed to succeed and produce a dataset-relative path the frontend can use.
    let dest_relative = normalize_relative_path(dest.strip_prefix(canonical_dataset_root)?);
    Ok(Some(dest_relative))
}

fn group_dataset_images_inner(
    state: AppState,
    input: &GroupDatasetImagesInput,
) -> AppResult<Vec<DatasetEntry>> {
    let project = state.with_db(|connection| db::get_project(connection, &input.project_id))?;
    let dataset_root = PathBuf::from(project.dataset_path);
    if !dataset_root.exists() {
        return Err(AppError::Validation(
            "Project dataset folder is missing.".to_string(),
        ));
    }
    let canonical_dataset_root = fs::canonicalize(&dataset_root)?;

    let parent_dir =
        resolve_dataset_parent_dir(&dataset_root, input.parent_relative_path.as_deref().unwrap_or(""))?;
    let sanitized = sanitize_group_segment(&input.group_name)?;
    let group_dir = unique_group_folder(&parent_dir, &sanitized);
    fs::create_dir_all(&group_dir)?;

    for relative_path in &input.relative_paths {
        if relative_path.trim().is_empty() {
            continue;
        }
        move_image_into_dir(&dataset_root, &canonical_dataset_root, relative_path, &group_dir)?;
    }

    list_dataset_entries_inner(state, &input.project_id)
}

fn move_dataset_images_inner(
    state: AppState,
    input: &MoveDatasetImagesInput,
) -> AppResult<Vec<DatasetEntry>> {
    let project = state.with_db(|connection| db::get_project(connection, &input.project_id))?;
    let dataset_root = PathBuf::from(project.dataset_path);
    if !dataset_root.exists() {
        return Err(AppError::Validation(
            "Project dataset folder is missing.".to_string(),
        ));
    }
    let canonical_dataset_root = fs::canonicalize(&dataset_root)?;
    let target_dir = resolve_dataset_parent_dir(&dataset_root, &input.target_relative_path)?;
    fs::create_dir_all(&target_dir)?;

    for relative_path in &input.relative_paths {
        if relative_path.trim().is_empty() {
            continue;
        }
        move_image_into_dir(&dataset_root, &canonical_dataset_root, relative_path, &target_dir)?;
    }

    list_dataset_entries_inner(state, &input.project_id)
}

fn rename_dataset_group_inner(
    state: AppState,
    input: &RenameDatasetGroupInput,
) -> AppResult<Vec<DatasetEntry>> {
    let project = state.with_db(|connection| db::get_project(connection, &input.project_id))?;
    let dataset_root = PathBuf::from(project.dataset_path);
    let group_path = resolve_dataset_path(&dataset_root, &input.group_relative_path)?;
    if !group_path.is_dir() {
        return Err(AppError::Validation(format!(
            "'{}' is not a group folder.",
            input.group_relative_path
        )));
    }

    let parent = group_path
        .parent()
        .ok_or_else(|| AppError::Validation("Cannot rename the dataset root.".to_string()))?
        .to_path_buf();

    let sanitized = sanitize_group_segment(&input.new_name)?;
    let target = parent.join(&sanitized);
    if target == group_path {
        return list_dataset_entries_inner(state, &input.project_id);
    }
    if target.exists() {
        return Err(AppError::Validation(format!(
            "A folder named '{sanitized}' already exists alongside the group."
        )));
    }

    // Derive old/new relative paths from the input string — avoids canonicalize on
    // the not-yet-existing target path.
    let old_relative = input.group_relative_path.trim_matches('/').to_string();
    let new_relative = match old_relative.rfind('/') {
        Some(idx) => format!("{}/{sanitized}", &old_relative[..idx]),
        None => sanitized.clone(),
    };

    fs::rename(&group_path, &target)?;

    state.with_db(|connection| {
        db::rename_dataset_group_config(connection, &input.project_id, &old_relative, &new_relative)
    })?;

    list_dataset_entries_inner(state, &input.project_id)
}

fn remove_dataset_group_inner(
    state: AppState,
    input: &RemoveDatasetGroupInput,
) -> AppResult<Vec<DatasetEntry>> {
    let project = state.with_db(|connection| db::get_project(connection, &input.project_id))?;
    let dataset_root = PathBuf::from(project.dataset_path);
    let canonical_dataset_root = fs::canonicalize(&dataset_root)?;
    let group_path = resolve_dataset_path(&dataset_root, &input.group_relative_path)?;
    if !group_path.is_dir() {
        return Err(AppError::Validation(format!(
            "'{}' is not a group folder.",
            input.group_relative_path
        )));
    }
    if group_path == canonical_dataset_root {
        return Err(AppError::Validation(
            "Cannot remove the dataset root.".to_string(),
        ));
    }

    let parent_dir = group_path
        .parent()
        .ok_or_else(|| AppError::Validation("Group has no parent directory.".to_string()))?
        .to_path_buf();

    let group_relative = input.group_relative_path.trim_matches('/').to_string();

    if input.delete_contents {
        fs::remove_dir_all(&group_path)?;
        let _ = state.with_db(|connection| {
            db::remove_dataset_group_configs(connection, &input.project_id, &group_relative)
        });
        return list_dataset_entries_inner(state, &input.project_id);
    }

    // Default behaviour: move images up to the parent and try to remove the now-empty
    // group. Any non-image content blocks the removal and surfaces a validation error.
    let mut to_move = Vec::new();
    let mut has_other = false;
    for entry in fs::read_dir(&group_path)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            has_other = true;
            continue;
        }
        if is_image_file(&path) {
            let rel = normalize_relative_path(path.strip_prefix(&canonical_dataset_root)?);
            to_move.push(rel);
        }
    }

    for rel in &to_move {
        move_image_into_dir(&dataset_root, &canonical_dataset_root, rel, &parent_dir)?;
    }

    // Try to remove the now-empty group; if anything is left behind (e.g. caption
    // orphans, non-image files, nested folders) surface a clear error so the user
    // can clean up manually instead of silently keeping the group around.
    let result = match fs::remove_dir(&group_path) {
        Ok(()) => Ok(()),
        Err(_) if has_other => Err(AppError::Validation(
            "Group still contains non-image content. Re-run with deleteContents=true to remove it.".to_string(),
        )),
        Err(err) => Err(err.into()),
    };
    result?;

    state.with_db(|connection| {
        db::remove_dataset_group_configs(connection, &input.project_id, &group_relative)
    })?;

    list_dataset_entries_inner(state, &input.project_id)
}

fn set_dataset_group_type_inner(
    state: AppState,
    input: &SetDatasetGroupTypeInput,
) -> AppResult<Vec<DatasetEntry>> {
    let project = state.with_db(|connection| db::get_project(connection, &input.project_id))?;
    let dataset_root = PathBuf::from(project.dataset_path);
    let group_path = resolve_dataset_path(&dataset_root, &input.group_relative_path)?;
    if !group_path.is_dir() {
        return Err(AppError::Validation(format!(
            "'{}' is not a group folder.",
            input.group_relative_path
        )));
    }
    let group_type = match input.group_type.as_str() {
        "reg" => "reg",
        _ => "normal",
    };
    state.with_db(|connection| {
        db::save_dataset_group_type(
            connection,
            &input.project_id,
            &input.group_relative_path,
            group_type,
        )
    })?;
    list_dataset_entries_inner(state, &input.project_id)
}

pub(super) fn parent_relative_path(relative_path: &str) -> String {
    let trimmed = relative_path.trim().trim_matches('/');
    trimmed
        .rsplit_once('/')
        .map(|(parent, _)| parent.to_string())
        .unwrap_or_default()
}


