/**
 * @file infra/db/repos/projects.rs
 * @description projects 表 CRUD：创建、列表、查询、更新 status/tags。
 */

use rusqlite::{params, Connection, OptionalExtension};

use crate::{
    error::{AppError, AppResult},
    models::{ProjectRecord, ProjectStatus},
    utils::normalize_display_path_string,
};

use crate::utils::now_ts;

pub fn insert_project(connection: &Connection, project: &ProjectRecord) -> AppResult<()> {
    let tags_json = serde_json::to_string(&project.tags)?;
    connection.execute(
        "
        INSERT INTO projects (id, name, root_path, dataset_path, output_path, status, tags_json, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ",
        params![
            project.id,
            project.name,
            project.root_path,
            project.dataset_path,
            project.output_path,
            project.status.as_str(),
            tags_json,
            project.updated_at,
        ],
    )?;
    Ok(())
}

pub fn list_projects(connection: &Connection) -> AppResult<Vec<ProjectRecord>> {
    let mut statement = connection.prepare(
        "
        SELECT id, name, root_path, dataset_path, output_path, status, tags_json, updated_at
        FROM projects
        ORDER BY updated_at DESC, name ASC
        ",
    )?;
    let projects = statement
        .query_map([], row_to_project)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(projects)
}

pub fn get_project(connection: &Connection, project_id: &str) -> AppResult<ProjectRecord> {
    connection
        .query_row(
            "
            SELECT id, name, root_path, dataset_path, output_path, status, tags_json, updated_at
            FROM projects
            WHERE id = ?1
            ",
            params![project_id],
            row_to_project,
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("Project '{project_id}' does not exist")))
}

pub fn update_project_status(
    connection: &Connection,
    project_id: &str,
    status: ProjectStatus,
) -> AppResult<()> {
    connection.execute(
        "UPDATE projects SET status = ?1, updated_at = ?2 WHERE id = ?3",
        params![status.as_str(), now_ts(), project_id],
    )?;
    Ok(())
}

pub fn update_project_tags(
    connection: &Connection,
    project_id: &str,
    tags: &[String],
) -> AppResult<()> {
    connection.execute(
        "UPDATE projects SET tags_json = ?1, updated_at = ?2 WHERE id = ?3",
        params![serde_json::to_string(tags)?, now_ts(), project_id],
    )?;
    Ok(())
}

fn row_to_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectRecord> {
    let tags_json: String = row.get(6)?;
    let tags = serde_json::from_str::<Vec<String>>(&tags_json).unwrap_or_default();
    Ok(ProjectRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        root_path: normalize_display_path_string(&row.get::<_, String>(2)?),
        dataset_path: normalize_display_path_string(&row.get::<_, String>(3)?),
        output_path: normalize_display_path_string(&row.get::<_, String>(4)?),
        status: ProjectStatus::from_db(&row.get::<_, String>(5)?),
        tags,
        size_bytes: 0,
        updated_at: row.get(7)?,
    })
}
