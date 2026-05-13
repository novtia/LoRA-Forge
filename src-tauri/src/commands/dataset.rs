use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    process::Command,
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
    utils::{ensure_within, normalize_display_path, normalize_relative_path},
};

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCaptionInput {
    pub project_id: String,
    pub relative_path: String,
    pub caption: String,
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
pub async fn auto_tag_image(
    project_id: String,
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    respond(generate_caption_inner(state.inner().clone(), &project_id, &relative_path, "llm").await)
}

#[tauri::command]
pub async fn interrogate_image(
    project_id: String,
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    respond(
        generate_caption_inner(state.inner().clone(), &project_id, &relative_path, "wd14").await,
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
    entries.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
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
            .then_with(|| left.relative_path.cmp(&right.relative_path))
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

async fn generate_caption_inner(
    state: AppState,
    project_id: &str,
    relative_path: &str,
    mode: &str,
) -> AppResult<String> {
    let (project, settings) = state.with_db(|connection| {
        Ok((
            db::get_project(connection, project_id)?,
            db::load_llm_settings(connection)?,
        ))
    })?;
    let dataset_root = PathBuf::from(project.dataset_path);
    let image_path = resolve_dataset_path(&dataset_root, relative_path)?;

    llm::generate_dataset_caption(&settings, &image_path, mode).await
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
    let status = Command::new("ffmpeg")
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
    images.sort();
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
