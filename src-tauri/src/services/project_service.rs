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
