/**
 * @file infra/db/repos/dataset_groups.rs
 * @description dataset_group_configs 表：分组类型（normal/reg）的读写、重命名、删除。
 */
use std::collections::HashMap;

use rusqlite::{params, Connection};

use crate::error::AppResult;

/// Upsert the type ("normal" | "reg") for a dataset directory group.
pub fn save_dataset_group_type(
    connection: &Connection,
    project_id: &str,
    group_path: &str,
    group_type: &str,
) -> AppResult<()> {
    if group_type == "normal" {
        connection.execute(
            "DELETE FROM dataset_group_configs WHERE project_id = ?1 AND group_path = ?2",
            params![project_id, group_path],
        )?;
    } else {
        connection.execute(
            "INSERT INTO dataset_group_configs (project_id, group_path, group_type)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(project_id, group_path) DO UPDATE SET group_type = excluded.group_type",
            params![project_id, group_path, group_type],
        )?;
    }
    Ok(())
}

/// Returns a map of group_path → group_type for all non-normal groups in a project.
pub fn load_dataset_group_types(
    connection: &Connection,
    project_id: &str,
) -> AppResult<HashMap<String, String>> {
    let mut stmt = connection.prepare(
        "SELECT group_path, group_type FROM dataset_group_configs WHERE project_id = ?1",
    )?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows.into_iter().collect())
}

/// Update group_path (and all sub-paths) when a group is renamed.
pub fn rename_dataset_group_config(
    connection: &Connection,
    project_id: &str,
    old_path: &str,
    new_path: &str,
) -> AppResult<()> {
    let old_prefix = format!("{old_path}/");
    let new_prefix = format!("{new_path}/");
    connection.execute(
        "UPDATE dataset_group_configs SET group_path = ?3
         WHERE project_id = ?1 AND group_path = ?2",
        params![project_id, old_path, new_path],
    )?;
    let mut stmt = connection.prepare(
        "SELECT group_path FROM dataset_group_configs
         WHERE project_id = ?1 AND group_path LIKE ?2 ESCAPE '\\'",
    )?;
    let like_pattern = format!("{}%", old_prefix.replace('%', "\\%").replace('_', "\\_"));
    let sub_paths: Vec<String> = stmt
        .query_map(params![project_id, like_pattern], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for sub in sub_paths {
        let updated = format!("{}{}", new_prefix, &sub[old_prefix.len()..]);
        connection.execute(
            "UPDATE dataset_group_configs SET group_path = ?3
             WHERE project_id = ?1 AND group_path = ?2",
            params![project_id, sub, updated],
        )?;
    }
    Ok(())
}

/// Remove group_path and all sub-paths when a group is deleted.
pub fn remove_dataset_group_configs(
    connection: &Connection,
    project_id: &str,
    group_path: &str,
) -> AppResult<()> {
    let like_pattern = format!(
        "{}/{}",
        group_path.replace('%', "\\%").replace('_', "\\_"),
        "%"
    );
    connection.execute(
        "DELETE FROM dataset_group_configs
         WHERE project_id = ?1 AND (group_path = ?2 OR group_path LIKE ?3 ESCAPE '\\')",
        params![project_id, group_path, like_pattern],
    )?;
    Ok(())
}
