/**
 * @file services/project_service.rs
 * @description 项目 CRUD 编排：列出/查询/创建项目，计算磁盘占用，初始化目录与默认训练配置。
 */

use std::{fs, path::Path};

use crate::{
    db,
    error::{AppError, AppResult},
    models::{ProjectRecord, ProjectStatus, TrainingConfig},
    state::AppState,
    utils::{directory_size, ensure_existing_dir, normalize_display_path, now_ts, slugify},
};

/// 列出全部项目，并实时填充 `size_bytes`（磁盘占用）。
pub fn list_projects(state: AppState) -> AppResult<Vec<ProjectRecord>> {
    let mut projects = state.with_db(db::list_projects)?;
    for project in &mut projects {
        project.size_bytes = directory_size(Path::new(&project.root_path));
    }
    Ok(projects)
}

/// 查询单个项目，并实时填充 `size_bytes`。
pub fn get_project(state: AppState, project_id: &str) -> AppResult<ProjectRecord> {
    let mut project = state.with_db(|connection| db::get_project(connection, project_id))?;
    project.size_bytes = directory_size(Path::new(&project.root_path));
    Ok(project)
}

/// 在 `root_path` 下创建项目目录结构（dataset/ output/），插入 DB，返回创建后的记录。
pub fn create_project(state: AppState, name: &str, root_path: &str) -> AppResult<ProjectRecord> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("Project name is required".to_string()));
    }

    let selected_root = ensure_existing_dir(Path::new(root_path))?;
    let mut project_id = slugify(name);
    let mut project_root = selected_root.join(&project_id);
    if project_root.exists() {
        project_id = format!("{}-{}", project_id, now_ts());
        project_root = selected_root.join(&project_id);
    }

    let dataset_path = project_root.join("dataset");
    let output_path = project_root.join("output");

    fs::create_dir_all(&dataset_path)?;
    fs::create_dir_all(&output_path)?;

    let default_config = TrainingConfig::default();
    let project = ProjectRecord {
        id: project_id,
        name: name.to_string(),
        root_path: normalize_display_path(&project_root),
        dataset_path: normalize_display_path(&dataset_path),
        output_path: normalize_display_path(&output_path),
        status: ProjectStatus::Ready,
        tags: default_config.summary_tags(),
        size_bytes: 0,
        updated_at: now_ts(),
    };

    state.with_db(|connection| {
        db::insert_project(connection, &project)?;
        db::save_training_config(connection, &project.id, &default_config)?;
        Ok(())
    })?;

    get_project(state, &project.id)
}

fn ensure_not_training(state: &AppState, project: &ProjectRecord) -> AppResult<()> {
    if matches!(
        project.status,
        ProjectStatus::Running | ProjectStatus::Paused
    ) {
        return Err(AppError::Validation(
            "Cannot update a project while training is active".to_string(),
        ));
    }
    if state.runtime_job(&project.id)?.is_some() {
        return Err(AppError::Validation(
            "Cannot update a project while training is active".to_string(),
        ));
    }
    Ok(())
}

/// 更新项目名称与项目根路径（仅更新数据库指针；不移动磁盘文件）。
pub fn update_project(
    state: AppState,
    project_id: &str,
    name: &str,
    root_path: &str,
) -> AppResult<ProjectRecord> {
    let name = name.trim();
    let root_path = root_path.trim();
    if name.is_empty() {
        return Err(AppError::Validation("Project name is required".to_string()));
    }
    if root_path.is_empty() {
        return Err(AppError::Validation("Project path is required".to_string()));
    }

    let project = state.with_db(|connection| db::get_project(connection, project_id))?;
    ensure_not_training(&state, &project)?;

    let project_root = ensure_existing_dir(Path::new(root_path))?;
    let dataset_path = project_root.join("dataset");
    let output_path = project_root.join("output");
    fs::create_dir_all(&dataset_path)?;
    fs::create_dir_all(&output_path)?;

    state.with_db(|connection| {
        db::update_project_record(
            connection,
            project_id,
            name,
            &normalize_display_path(&project_root),
            &normalize_display_path(&dataset_path),
            &normalize_display_path(&output_path),
        )
    })?;

    get_project(state, project_id)
}

/// 从应用库移除项目；不删除磁盘文件。训练进行中时不允许删除。
pub fn delete_project(state: AppState, project_id: &str) -> AppResult<()> {
    let project = state.with_db(|connection| db::get_project(connection, project_id))?;
    ensure_not_training(&state, &project)?;
    state.with_db(|connection| db::delete_project(connection, project_id))?;
    state.remove_runtime_job(project_id).ok();
    Ok(())
}
