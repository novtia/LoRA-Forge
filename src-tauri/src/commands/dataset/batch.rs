/**
 * @file commands/dataset/batch.rs
 * @description 鎵归噺鎿嶄綔鍛戒护锛歚batch_rename_dataset_images`銆乣batch_convert_dataset_extensions`銆?
 */

use std::{
    fs,
    path::{Path, PathBuf},
};

use tauri::State;

use crate::{
    commands::respond,
    db,
    error::{AppError, AppResult},
    models::{BatchDatasetImageMutationResult, DatasetImagePathMapping},
    state::AppState,
    utils::{cmp_str_natural, normalize_display_path, normalize_relative_path},
};

use std::collections::HashMap;

use super::{
    BatchConvertDatasetExtensionsInput, BatchRenameDatasetImagesInput, caption_path_for_image, resolve_dataset_path,
};
use super::browse::list_dataset_entries_inner;
use super::group::{parent_relative_path, resolve_dataset_parent_dir, sanitize_group_segment};

#[tauri::command]
pub fn batch_rename_dataset_images(
    input: BatchRenameDatasetImagesInput,
    state: State<'_, AppState>,
) -> Result<BatchDatasetImageMutationResult, String> {
    respond(batch_rename_dataset_images_inner(
        state.inner().clone(),
        &input,
    ))
}

#[tauri::command]
pub fn batch_convert_dataset_extensions(
    input: BatchConvertDatasetExtensionsInput,
    state: State<'_, AppState>,
) -> Result<BatchDatasetImageMutationResult, String> {
    respond(batch_convert_dataset_extensions_inner(
        state.inner().clone(),
        &input,
    ))
}

#[tauri::command]
fn rename_image_with_caption(
    dataset_root: &Path,
    canonical_dataset_root: &Path,
    source: &Path,
    dest: &Path,
) -> AppResult<()> {
    if source == dest {
        return Ok(());
    }
    if dest.exists() {
        return Err(AppError::Validation(format!(
            "Target file '{}' already exists.",
            dest.display()
        )));
    }

    fs::rename(source, dest).or_else(|_| {
        fs::copy(source, dest)?;
        fs::remove_file(source)?;
        Ok::<(), AppError>(())
    })?;

    let source_caption = caption_path_for_image(source);
    if source_caption.exists() {
        let dest_caption = caption_path_for_image(dest);
        fs::rename(&source_caption, &dest_caption).or_else(|_| {
            fs::copy(&source_caption, &dest_caption)?;
            fs::remove_file(&source_caption)?;
            Ok::<(), AppError>(())
        })?;
    }

    let _ = dataset_root;
    let _ = canonical_dataset_root;
    Ok(())
}

fn relative_path_from_absolute(
    canonical_dataset_root: &Path,
    absolute: &Path,
) -> AppResult<String> {
    let canonical_absolute = fs::canonicalize(absolute).unwrap_or_else(|_| absolute.to_path_buf());
    Ok(normalize_relative_path(
        canonical_absolute.strip_prefix(canonical_dataset_root)?,
    ))
}

fn open_dataset_image(path: &Path) -> AppResult<image::DynamicImage> {
    let bytes = fs::read(path).map_err(|error| {
        AppError::Validation(format!(
            "Failed to read image '{}': {error}",
            normalize_display_path(path)
        ))
    })?;
    image::load_from_memory(&bytes).map_err(|error| {
        AppError::Validation(format!(
            "Failed to decode image '{}': {error}",
            normalize_display_path(path)
        ))
    })
}

fn batch_rename_dataset_images_inner(
    state: AppState,
    input: &BatchRenameDatasetImagesInput,
) -> AppResult<BatchDatasetImageMutationResult> {
    let project = state.with_db(|connection| db::get_project(connection, &input.project_id))?;
    let dataset_root = PathBuf::from(project.dataset_path);
    if !dataset_root.exists() {
        return Err(AppError::Validation(
            "Project dataset folder is missing.".to_string(),
        ));
    }
    let canonical_dataset_root = fs::canonicalize(&dataset_root)?;
    let base_name = sanitize_group_segment(&input.base_name)?;
    if input.start_index == 0 {
        return Err(AppError::Validation(
            "Start index must be at least 1.".to_string(),
        ));
    }

    let mut paths: Vec<String> = input
        .relative_paths
        .iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();
    paths.sort_by(|left, right| cmp_str_natural(left, right));
    paths.dedup();

    if paths.is_empty() {
        return Err(AppError::Validation(
            "No images selected for rename.".to_string(),
        ));
    }

    let mut by_parent: HashMap<String, Vec<String>> = HashMap::new();
    for relative_path in paths {
        let source = resolve_dataset_path(&dataset_root, &relative_path)?;
        if !source.is_file() || !is_image_file(&source) {
            return Err(AppError::Validation(format!(
                "'{relative_path}' is not an image file."
            )));
        }
        by_parent
            .entry(parent_relative_path(&relative_path))
            .or_default()
            .push(relative_path);
    }

    let mut path_mappings = Vec::new();

    for (_, mut group_paths) in by_parent {
        group_paths.sort_by(|left, right| cmp_str_natural(left, right));

        let mut plans = Vec::with_capacity(group_paths.len());
        for (offset, old_relative) in group_paths.iter().enumerate() {
            let source = resolve_dataset_path(&dataset_root, old_relative)?;
            let ext = source
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("png")
                .to_string();
            let index = input.start_index.saturating_add(offset as u32);
            let final_name = format!("{base_name} ({index}).{ext}");
            let temp_name = format!(".__lf_tmp_{index}_{offset}.{ext}");
            plans.push((old_relative.clone(), temp_name, final_name));
        }

        for (old_relative, temp_name, _) in &plans {
            let source = resolve_dataset_path(&dataset_root, old_relative)?;
            let parent = source
                .parent()
                .ok_or_else(|| AppError::Validation(format!("Invalid path '{old_relative}'")))?;
            let temp_path = parent.join(temp_name);
            rename_image_with_caption(
                &dataset_root,
                &canonical_dataset_root,
                &source,
                &temp_path,
            )?;
        }

        for (old_relative, temp_name, final_name) in plans {
            let parent_key = parent_relative_path(&old_relative);
            let parent_dir = resolve_dataset_parent_dir(&dataset_root, &parent_key)?;
            let temp_path = parent_dir.join(&temp_name);
            let final_path = parent_dir.join(&final_name);
            rename_image_with_caption(
                &dataset_root,
                &canonical_dataset_root,
                &temp_path,
                &final_path,
            )?;
            let new_relative = relative_path_from_absolute(&canonical_dataset_root, &final_path)?;
            path_mappings.push(DatasetImagePathMapping {
                old_relative_path: old_relative,
                new_relative_path: new_relative,
            });
        }
    }

    let entries = list_dataset_entries_inner(state, &input.project_id)?;
    Ok(BatchDatasetImageMutationResult {
        entries,
        path_mappings,
    })
}

fn normalize_target_extension(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim().trim_start_matches('.').to_ascii_lowercase();
    match trimmed.as_str() {
        "png" | "jpg" | "jpeg" | "webp" => Ok(if trimmed == "jpeg" {
            "jpg".to_string()
        } else {
            trimmed
        }),
        other => Err(AppError::Validation(format!(
            "Unsupported target extension '{other}'. Use png, jpg, or webp."
        ))),
    }
}

fn extensions_equivalent(left: &str, right: &str) -> bool {
    let normalize = |value: &str| {
        let lower = value.to_ascii_lowercase();
        if lower == "jpeg" {
            "jpg".to_string()
        } else {
            lower
        }
    };
    normalize(left) == normalize(right)
}

fn save_image_as_format(
    source: &Path,
    dest: &Path,
    target_extension: &str,
) -> AppResult<()> {
    use image::ImageFormat;

    let img = open_dataset_image(source)?;

    let format = match target_extension {
        "png" => ImageFormat::Png,
        "jpg" => ImageFormat::Jpeg,
        "webp" => ImageFormat::WebP,
        other => {
            return Err(AppError::Validation(format!(
                "Unsupported target extension '{other}'."
            )));
        }
    };

    if format == ImageFormat::Jpeg {
        let rgb = img.to_rgb8();
        let mut buffer = std::io::BufWriter::new(
            fs::File::create(dest).map_err(|error| {
                AppError::Validation(format!(
                    "Failed to create '{}': {error}",
                    dest.display()
                ))
            })?,
        );
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, 95);
        encoder
            .encode(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                image::ExtendedColorType::Rgb8,
            )
            .map_err(|error| {
                AppError::Validation(format!(
                    "Failed to encode JPEG for '{}': {error}",
                    dest.display()
                ))
            })?;
    } else {
        img.save_with_format(dest, format).map_err(|error| {
            AppError::Validation(format!(
                "Failed to write '{}': {error}",
                dest.display()
            ))
        })?;
    }

    Ok(())
}

fn batch_convert_dataset_extensions_inner(
    state: AppState,
    input: &BatchConvertDatasetExtensionsInput,
) -> AppResult<BatchDatasetImageMutationResult> {
    let project = state.with_db(|connection| db::get_project(connection, &input.project_id))?;
    let dataset_root = PathBuf::from(project.dataset_path);
    if !dataset_root.exists() {
        return Err(AppError::Validation(
            "Project dataset folder is missing.".to_string(),
        ));
    }
    let canonical_dataset_root = fs::canonicalize(&dataset_root)?;
    let target_extension = normalize_target_extension(&input.target_extension)?;

    let mut paths: Vec<String> = input
        .relative_paths
        .iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();
    paths.sort_by(|left, right| cmp_str_natural(left, right));
    paths.dedup();

    if paths.is_empty() {
        return Err(AppError::Validation(
            "No images selected for extension conversion.".to_string(),
        ));
    }

    let mut path_mappings = Vec::new();

    for old_relative in paths {
        let source = resolve_dataset_path(&dataset_root, &old_relative)?;
        if !source.is_file() || !is_image_file(&source) {
            return Err(AppError::Validation(format!(
                "'{old_relative}' is not an image file."
            )));
        }

        let current_ext = source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_string();

        if extensions_equivalent(&current_ext, &target_extension) {
            continue;
        }

        let stem = source
            .file_stem()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "image".to_string());
        let parent = source
            .parent()
            .ok_or_else(|| AppError::Validation(format!("Invalid path '{old_relative}'")))?;
        let mut dest = parent.join(format!("{stem}.{target_extension}"));

        if dest.exists() {
            for n in 2..10_000 {
                let candidate = parent.join(format!("{stem} ({n}).{target_extension}"));
                if !candidate.exists() {
                    dest = candidate;
                    break;
                }
            }
        }

        save_image_as_format(&source, &dest, &target_extension)?;
        let source_caption = caption_path_for_image(&source);
        let dest_caption = caption_path_for_image(&dest);
        if source_caption.exists() {
            fs::rename(&source_caption, &dest_caption).or_else(|_| {
                fs::copy(&source_caption, &dest_caption)?;
                fs::remove_file(&source_caption)?;
                Ok::<(), AppError>(())
            })?;
        }
        fs::remove_file(&source)?;

        let new_relative = relative_path_from_absolute(&canonical_dataset_root, &dest)?;
        path_mappings.push(DatasetImagePathMapping {
            old_relative_path: old_relative,
            new_relative_path: new_relative,
        });
    }

    let entries = list_dataset_entries_inner(state, &input.project_id)?;
    Ok(BatchDatasetImageMutationResult {
        entries,
        path_mappings,
    })
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
