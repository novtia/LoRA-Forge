/**
 * @file commands/dataset/caption.rs
 * @description Caption 相关命令：读写/删除图片+caption、LLM 自动打标、取消、列出未打标路径。
 */

use std::{
    fs,
    path::PathBuf,
};

use tauri::State;

use crate::{
    commands::respond,
    db,
    error::AppResult,
    models::{CaptionTagMode, DatasetEntry},
    services::caption_service,
    state::AppState,
};

use super::{
    ListUntaggedImagePathsInput, SaveCaptionInput, caption_path_for_image,
    read_caption_file, resolve_dataset_path,
};
use super::browse::list_dataset_entries_inner;

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
pub fn cancel_llm_caption(
    project_id: Option<String>,
    relative_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // 同时传了项目与图片路径时只取消那一张；否则取消当前全部在途打标。
    match (project_id, relative_path) {
        (Some(pid), Some(rel)) => {
            let key = AppState::llm_caption_cancel_key(&pid, &rel);
            state.request_llm_caption_cancel(Some(&key));
        }
        _ => state.request_llm_caption_cancel(None),
    }
    Ok(())
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
fn list_untagged_image_paths_inner(
    state: AppState,
    input: &ListUntaggedImagePathsInput,
) -> AppResult<Vec<String>> {
    let project = state.with_db(|connection| db::get_project(connection, &input.project_id))?;
    let dataset_root = PathBuf::from(project.dataset_path);

    let mut untagged = Vec::new();
    for rel_path in &input.relative_paths {
        let image_path = match resolve_dataset_path(&dataset_root, rel_path) {
            Ok(p) => p,
            Err(_) => {
                untagged.push(rel_path.clone());
                continue;
            }
        };
        let caption_path = caption_path_for_image(&image_path);
        let has_caption = caption_path.exists()
            && fs::read_to_string(&caption_path)
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);
        if !has_caption {
            untagged.push(rel_path.clone());
        }
    }
    Ok(untagged)
}

#[tauri::command]
pub fn list_untagged_image_paths(
    input: ListUntaggedImagePathsInput,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    respond(list_untagged_image_paths_inner(state.inner().clone(), &input))
}

#[tauri::command]
pub async fn auto_tag_image(
    project_id: String,
    relative_path: String,
    tag_mode: Option<String>,
    user_message: Option<String>,
    current_caption: Option<String>,
    previous_assistant_caption: Option<String>,
    previous_image_relative_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let app_state = state.inner().clone();
    // 每张图片注册独立的取消标志，互不影响；结束后清理。
    let key = AppState::llm_caption_cancel_key(&project_id, &relative_path);
    let cancel = app_state.begin_llm_caption(&key);
    let result = caption_service::caption_image(
        app_state.clone(),
        &project_id,
        &relative_path,
        CaptionTagMode::parse(tag_mode.as_deref()),
        user_message.as_deref(),
        current_caption.as_deref(),
        previous_assistant_caption.as_deref(),
        previous_image_relative_path.as_deref(),
        cancel,
    )
    .await;
    app_state.finish_llm_caption(&key);
    respond(result)
}

