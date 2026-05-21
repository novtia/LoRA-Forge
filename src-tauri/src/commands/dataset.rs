use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    thread,
    time::UNIX_EPOCH,
};

use tauri::State;

use crate::{
    commands::respond,
    db,
    error::{AppError, AppResult},
    llm,
    models::{DatasetAsset, DatasetEntry, DatasetEntryKind, DatasetPreviewAsset, SampleImageEntry},
    state::AppState,
    utils::{
        cmp_str_natural, ensure_within, hidden_std_command, normalize_display_path,
        normalize_relative_path,
    },
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
    /// Image relative paths (dataset root–relative, forward-slash separated) to move
    /// into the new group folder.
    pub relative_paths: Vec<String>,
    /// Display name for the new group; will be sanitized into a folder name.
    pub group_name: String,
    /// Optional parent folder (dataset root–relative) under which the new group is
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

#[tauri::command]
pub fn list_dataset_entries(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<DatasetEntry>, String> {
    respond(list_dataset_entries_inner(
        state.inner().clone(),
        &project_id,
    ))
}

#[tauri::command]
pub fn get_dataset_asset(
    project_id: String,
    relative_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<DatasetAsset>, String> {
    respond(get_dataset_asset_inner(
        state.inner().clone(),
        &project_id,
        relative_path.as_deref(),
    ))
}

#[tauri::command]
pub fn get_dataset_preview_assets(
    project_id: String,
    relative_paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<DatasetPreviewAsset>, String> {
    respond(get_dataset_preview_assets_inner(
        state.inner().clone(),
        &project_id,
        &relative_paths,
    ))
}

#[tauri::command]
pub fn list_sample_images(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<SampleImageEntry>, String> {
    respond(list_sample_images_inner(
        state.inner().clone(),
        &project_id,
    ))
}

#[tauri::command]
pub fn read_caption(
    project_id: String,
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    respond(read_caption_inner(
        state.inner().clone(),
        &project_id,
        &relative_path,
    ))
}

#[tauri::command]
pub fn write_caption(
    input: SaveCaptionInput,
    state: State<'_, AppState>,
) -> Result<String, String> {
    respond(write_caption_inner(
        state.inner().clone(),
        &input.project_id,
        &input.relative_path,
        &input.caption,
    ))
}

#[tauri::command]
pub fn delete_dataset_image(
    project_id: String,
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<DatasetEntry>, String> {
    respond(delete_dataset_image_inner(
        state.inner().clone(),
        &project_id,
        &relative_path,
    ))
}

#[tauri::command]
pub fn cancel_llm_caption(state: State<'_, AppState>) -> Result<(), String> {
    state.request_llm_caption_cancel();
    Ok(())
}

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
pub async fn auto_tag_image(
    project_id: String,
    relative_path: String,
    user_message: Option<String>,
    previous_assistant_caption: Option<String>,
    previous_image_relative_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    state.reset_llm_caption_cancel();
    let trim_opt = |v: Option<String>| {
        v.and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
    };
    let user_message = trim_opt(user_message);
    let previous_assistant_caption = trim_opt(previous_assistant_caption);
    let previous_image_relative_path = trim_opt(previous_image_relative_path);
    respond(
        generate_caption_inner(
            state.inner().clone(),
            &project_id,
            &relative_path,
            user_message.as_deref(),
            previous_assistant_caption.as_deref(),
            previous_image_relative_path.as_deref(),
        )
        .await,
    )
}

fn list_dataset_entries_inner(state: AppState, project_id: &str) -> AppResult<Vec<DatasetEntry>> {
    let project = state.with_db(|connection| db::get_project(connection, project_id))?;
    let dataset_root = PathBuf::from(project.dataset_path);
    if !dataset_root.exists() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    visit_dataset(&dataset_root, &dataset_root, 0, &mut entries)?;
    entries.sort_by(|left, right| {
        cmp_str_natural(&left.relative_path, &right.relative_path)
    });
    Ok(entries)
}

fn list_sample_images_inner(state: AppState, project_id: &str) -> AppResult<Vec<SampleImageEntry>> {
    let project = state.with_db(|connection| db::get_project(connection, project_id))?;
    let sample_root = PathBuf::from(project.root_path).join("sample");
    if !sample_root.exists() {
        return Ok(Vec::new());
    }

    let canonical_sample_root = fs::canonicalize(&sample_root)?;
    let mut entries = Vec::new();
    visit_sample_images(&sample_root, &canonical_sample_root, 0, &mut entries)?;
    entries.sort_by(|left, right| {
        right
            .modified_at
            .cmp(&left.modified_at)
            .then_with(|| cmp_str_natural(&left.relative_path, &right.relative_path))
    });
    Ok(entries)
}

fn get_dataset_asset_inner(
    state: AppState,
    project_id: &str,
    relative_path: Option<&str>,
) -> AppResult<Option<DatasetAsset>> {
    let project = state.with_db(|connection| db::get_project(connection, project_id))?;
    let dataset_root = PathBuf::from(project.dataset_path);
    let canonical_dataset_root = fs::canonicalize(&dataset_root)?;
    let selected = match relative_path {
        Some(value) => resolve_dataset_path(&dataset_root, value)?,
        None => {
            let images = collect_images(&dataset_root)?;
            match images.into_iter().next() {
                Some(path) => ensure_within(&dataset_root, &path)?,
                None => return Ok(None),
            }
        }
    };

    if !selected.exists() || !is_image_file(&selected) {
        return Err(AppError::NotFound(format!(
            "Dataset image '{}' not found",
            relative_path.unwrap_or_default()
        )));
    }

    let selected_relative_path =
        normalize_relative_path(selected.strip_prefix(&canonical_dataset_root)?);
    let caption = read_caption_file(&selected)?;

    Ok(Some(DatasetAsset {
        relative_path: selected_relative_path,
        name: selected
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("image")
            .to_string(),
        file_path: normalize_display_path(&selected),
        caption,
        width: None,
        height: None,
    }))
}

#[derive(Debug, Clone)]
struct DatasetPreviewRequest {
    relative_path: String,
    name: String,
    source_path: PathBuf,
}

fn get_dataset_preview_assets_inner(
    state: AppState,
    project_id: &str,
    relative_paths: &[String],
) -> AppResult<Vec<DatasetPreviewAsset>> {
    if relative_paths.is_empty() {
        return Ok(Vec::new());
    }

    let project = state.with_db(|connection| db::get_project(connection, project_id))?;
    let dataset_root = PathBuf::from(project.dataset_path);
    let preview_root = state
        .paths()
        .app_dir
        .join("dataset-previews")
        .join(project_id);
    fs::create_dir_all(&preview_root)?;

    let requests = build_dataset_preview_requests(&dataset_root, relative_paths)?;
    if requests.is_empty() {
        return Ok(Vec::new());
    }

    let worker_count = thread::available_parallelism()
        .map(|count| count.get().min(4))
        .unwrap_or(2)
        .min(requests.len());
    let mut buckets = vec![Vec::new(); worker_count];
    for (index, request) in requests.into_iter().enumerate() {
        buckets[index % worker_count].push((index, request));
    }

    let mut ordered_assets = vec![None; relative_paths.len()];
    thread::scope(|scope| -> AppResult<()> {
        let mut handles = Vec::new();
        for bucket in buckets {
            if bucket.is_empty() {
                continue;
            }

            let worker_preview_root = preview_root.clone();
            handles.push(
                scope.spawn(move || -> Vec<(usize, Option<DatasetPreviewAsset>)> {
                    bucket
                        .into_iter()
                        .map(|(index, request)| {
                            let asset =
                                build_dataset_preview_asset(&worker_preview_root, request).ok();
                            (index, asset)
                        })
                        .collect()
                }),
            );
        }

        for handle in handles {
            let results = handle
                .join()
                .map_err(|_| AppError::Process("Dataset preview worker panicked".to_string()))?;
            for (index, asset) in results {
                if index < ordered_assets.len() {
                    ordered_assets[index] = asset;
                }
            }
        }

        Ok(())
    })?;

    Ok(ordered_assets.into_iter().flatten().collect())
}

fn read_caption_inner(state: AppState, project_id: &str, relative_path: &str) -> AppResult<String> {
    let project = state.with_db(|connection| db::get_project(connection, project_id))?;
    let dataset_root = PathBuf::from(project.dataset_path);
    let image_path = resolve_dataset_path(&dataset_root, relative_path)?;
    read_caption_file(&image_path)
}

fn write_caption_inner(
    state: AppState,
    project_id: &str,
    relative_path: &str,
    caption: &str,
) -> AppResult<String> {
    let project = state.with_db(|connection| db::get_project(connection, project_id))?;
    let dataset_root = PathBuf::from(project.dataset_path);
    let image_path = resolve_dataset_path(&dataset_root, relative_path)?;
    let caption_path = caption_path_for_image(&image_path);
    fs::write(caption_path, caption)?;
    Ok(caption.to_string())
}

fn delete_dataset_image_inner(
    state: AppState,
    project_id: &str,
    relative_path: &str,
) -> AppResult<Vec<DatasetEntry>> {
    let project = state.with_db(|connection| db::get_project(connection, project_id))?;
    let dataset_root = PathBuf::from(project.dataset_path);
    let image_path = resolve_dataset_path(&dataset_root, relative_path)?;
    let caption_path = caption_path_for_image(&image_path);

    if image_path.exists() {
        fs::remove_file(&image_path)?;
    }
    if caption_path.exists() {
        fs::remove_file(caption_path)?;
    }

    list_dataset_entries_inner(state, project_id)
}

/// Sanitizes a user-supplied folder name into something safe to put on disk while still
/// looking similar to the original input. Characters that are invalid on common file
/// systems are replaced with `_`; leading dots / whitespace are trimmed; the final
/// length is clamped to keep paths inside platform limits.
fn sanitize_group_segment(name: &str) -> AppResult<String> {
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

/// Resolves a dataset-root–relative parent directory; an empty/`"."`/`"/"` input maps to
/// the dataset root itself.
fn resolve_dataset_parent_dir(dataset_root: &Path, parent_relative: &str) -> AppResult<PathBuf> {
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

    fs::rename(&group_path, &target)?;
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

    if input.delete_contents {
        fs::remove_dir_all(&group_path)?;
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
    match fs::remove_dir(&group_path) {
        Ok(()) => list_dataset_entries_inner(state, &input.project_id),
        Err(_) if has_other => Err(AppError::Validation(
            "Group still contains non-image content. Re-run with deleteContents=true to remove it.".to_string(),
        )),
        Err(err) => Err(err.into()),
    }
}

async fn generate_caption_inner(
    state: AppState,
    project_id: &str,
    relative_path: &str,
    user_message: Option<&str>,
    previous_assistant_caption: Option<&str>,
    previous_image_relative_path: Option<&str>,
) -> AppResult<String> {
    let cancel = state.llm_caption_cancel_flag();
    let (project, settings) = state.with_db(|connection| {
        Ok((
            db::get_project(connection, project_id)?,
            db::load_llm_settings(connection)?,
        ))
    })?;
    let dataset_root = PathBuf::from(project.dataset_path);
    let image_path = resolve_dataset_path(&dataset_root, relative_path)?;

    // 仅在能成功解析出之前那张图的路径、且存在时才传给 LLM 层；否则按 None 处理（防止脏数据导致 IO 错误打断主流程）。
    let previous_image_path = previous_image_relative_path.and_then(|rel| {
        let resolved = resolve_dataset_path(&dataset_root, rel).ok()?;
        if resolved.is_file() {
            Some(resolved)
        } else {
            None
        }
    });

    llm::generate_dataset_caption(
        &settings,
        &image_path,
        user_message,
        previous_assistant_caption,
        previous_image_path.as_deref(),
        &cancel,
        Some(state.clone()),
    )
    .await
}

fn build_dataset_preview_requests(
    dataset_root: &Path,
    relative_paths: &[String],
) -> AppResult<Vec<DatasetPreviewRequest>> {
    let canonical_dataset_root = fs::canonicalize(dataset_root)?;
    let mut requests = Vec::with_capacity(relative_paths.len());

    for relative_path in relative_paths {
        let selected = match resolve_dataset_path(dataset_root, relative_path) {
            Ok(path) => path,
            Err(_) => continue,
        };

        if !selected.exists() || !is_image_file(&selected) {
            continue;
        }

        requests.push(DatasetPreviewRequest {
            relative_path: normalize_relative_path(selected.strip_prefix(&canonical_dataset_root)?),
            name: selected
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("image")
                .to_string(),
            source_path: selected,
        });
    }

    Ok(requests)
}

fn visit_sample_images(
    current_path: &Path,
    canonical_sample_root: &Path,
    depth: u32,
    entries: &mut Vec<SampleImageEntry>,
) -> AppResult<()> {
    for entry in fs::read_dir(current_path)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            visit_sample_images(&path, canonical_sample_root, depth + 1, entries)?;
            continue;
        }
        if !file_type.is_file() || !is_image_file(&path) {
            continue;
        }

        let metadata = entry.metadata()?;
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .unwrap_or(0);

        let normalized_path = ensure_within(canonical_sample_root, &path)?;
        let relative_path =
            normalize_relative_path(normalized_path.strip_prefix(canonical_sample_root)?);
        entries.push(SampleImageEntry {
            relative_path,
            name: path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("sample")
                .to_string(),
            file_path: normalize_display_path(&path),
            depth,
            modified_at,
        });
    }
    Ok(())
}

fn build_dataset_preview_asset(
    preview_root: &Path,
    request: DatasetPreviewRequest,
) -> AppResult<DatasetPreviewAsset> {
    let preview_path =
        ensure_dataset_preview_image(preview_root, &request.source_path, &request.relative_path)?;
    let file_path = preview_path.unwrap_or_else(|| request.source_path.clone());

    Ok(DatasetPreviewAsset {
        relative_path: request.relative_path,
        name: request.name,
        file_path: normalize_display_path(&file_path),
    })
}

fn ensure_dataset_preview_image(
    preview_root: &Path,
    source_path: &Path,
    relative_path: &str,
) -> AppResult<Option<PathBuf>> {
    let preview_path = preview_root.join(dataset_preview_cache_name(relative_path));
    if dataset_preview_is_fresh(source_path, &preview_path)? {
        return Ok(Some(preview_path));
    }

    match render_dataset_preview_with_ffmpeg(source_path, &preview_path) {
        Ok(()) if preview_path.exists() => Ok(Some(preview_path)),
        Ok(()) => Ok(None),
        Err(_) => {
            let _ = fs::remove_file(&preview_path);
            Ok(None)
        }
    }
}

fn dataset_preview_is_fresh(source_path: &Path, preview_path: &Path) -> AppResult<bool> {
    if !preview_path.exists() {
        return Ok(false);
    }

    let source_modified = source_path.metadata()?.modified()?;
    let preview_metadata = preview_path.metadata()?;
    if preview_metadata.len() == 0 {
        return Ok(false);
    }

    let preview_modified = preview_metadata.modified()?;
    Ok(preview_modified >= source_modified)
}

fn render_dataset_preview_with_ffmpeg(source_path: &Path, preview_path: &Path) -> AppResult<()> {
    let status = hidden_std_command("ffmpeg")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .arg("-threads")
        .arg("1")
        .arg("-i")
        .arg(source_path)
        .arg("-vf")
        .arg("scale=320:320:force_original_aspect_ratio=decrease:flags=lanczos")
        .arg("-frames:v")
        .arg("1")
        .arg("-q:v")
        .arg("4")
        .arg(preview_path)
        .status()?;

    if status.success() {
        Ok(())
    } else {
        Err(AppError::Process(format!(
            "ffmpeg failed to generate dataset preview for '{}'",
            source_path.display()
        )))
    }
}

fn dataset_preview_cache_name(relative_path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    "dataset-preview-v1".hash(&mut hasher);
    relative_path.hash(&mut hasher);
    format!("{:016x}.jpg", hasher.finish())
}

fn visit_dataset(
    root: &Path,
    current: &Path,
    depth: u32,
    entries: &mut Vec<DatasetEntry>,
) -> AppResult<()> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        let relative = normalize_relative_path(path.strip_prefix(root)?);
        let name = entry.file_name().to_string_lossy().to_string();
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            entries.push(DatasetEntry {
                relative_path: relative.clone(),
                name,
                kind: DatasetEntryKind::Directory,
                depth,
            });
            visit_dataset(root, &path, depth + 1, entries)?;
        } else if is_image_file(&path) {
            entries.push(DatasetEntry {
                relative_path: relative,
                name,
                kind: DatasetEntryKind::Image,
                depth,
            });
        } else {
            entries.push(DatasetEntry {
                relative_path: relative,
                name,
                kind: DatasetEntryKind::File,
                depth,
            });
        }
    }

    Ok(())
}

fn collect_images(root: &Path) -> AppResult<Vec<PathBuf>> {
    let mut images = Vec::new();
    visit_images(root, &mut images)?;
    images.sort_by(|left, right| {
        cmp_str_natural(
            &left.to_string_lossy(),
            &right.to_string_lossy(),
        )
    });
    Ok(images)
}

fn visit_images(current: &Path, images: &mut Vec<PathBuf>) -> AppResult<()> {
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

fn resolve_dataset_path(root: &Path, relative_path: &str) -> AppResult<PathBuf> {
    let target = root.join(relative_path.replace('/', std::path::MAIN_SEPARATOR_STR));
    ensure_within(root, &target)
}

fn caption_path_for_image(path: &Path) -> PathBuf {
    path.with_extension("txt")
}

fn read_caption_file(path: &Path) -> AppResult<String> {
    let caption_path = caption_path_for_image(path);
    if caption_path.exists() {
        Ok(fs::read_to_string(caption_path)?.trim().to_string())
    } else {
        Ok(String::new())
    }
}

fn is_image_file(path: &Path) -> bool {
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
