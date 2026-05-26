/**
 * @file commands/dataset/browse.rs
 * @description 鏁版嵁闆嗘祻瑙堝懡浠わ細鍒楃洰褰曘€佽幏鍙栬祫浜с€侀瑙堝浘鐢熸垚銆佹牱鍥惧垪琛ㄣ€?
 */

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
    models::{DatasetAsset, DatasetEntry, DatasetPreviewAsset, SampleImageEntry},
    state::AppState,
    utils::{
        cmp_str_natural, hidden_std_command, normalize_display_path, normalize_relative_path,
    },
};

use super::{
    collect_images, is_image_file, read_caption_file,
    resolve_dataset_path, visit_dataset,
};
use crate::utils::ensure_within;

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

pub(super) fn list_dataset_entries_inner(state: AppState, project_id: &str) -> AppResult<Vec<DatasetEntry>> {
    let project = state.with_db(|connection| db::get_project(connection, project_id))?;
    let dataset_root = PathBuf::from(project.dataset_path);
    if !dataset_root.exists() {
        return Ok(Vec::new());
    }

    let group_types =
        state.with_db(|connection| db::load_dataset_group_types(connection, project_id))?;

    let mut entries = Vec::new();
    visit_dataset(&dataset_root, &dataset_root, 0, &mut entries, &group_types)?;
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
