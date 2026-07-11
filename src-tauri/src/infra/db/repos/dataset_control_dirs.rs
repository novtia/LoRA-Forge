/**
 * @file infra/db/repos/dataset_control_dirs.rs
 * @description dataset_control_dirs 表：编辑训练「目标目录 → 参考(control)目录」映射的读写、删除、重命名跟随。
 */
use std::collections::HashMap;

use rusqlite::{params, Connection};

use crate::error::AppResult;

/// Upsert a "target dir → control dir" mapping for edit-model training.
pub fn save_dataset_control_dir(
    connection: &Connection,
    project_id: &str,
    target_path: &str,
    control_path: &str,
) -> AppResult<()> {
    connection.execute(
        "INSERT INTO dataset_control_dirs (project_id, target_path, control_path)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(project_id, target_path) DO UPDATE SET control_path = excluded.control_path",
        params![project_id, target_path, control_path],
    )?;
    Ok(())
}

/// Remove a single "target dir → control dir" mapping.
pub fn remove_dataset_control_dir(
    connection: &Connection,
    project_id: &str,
    target_path: &str,
) -> AppResult<()> {
    connection.execute(
        "DELETE FROM dataset_control_dirs WHERE project_id = ?1 AND target_path = ?2",
        params![project_id, target_path],
    )?;
    Ok(())
}

/// Returns a map of target_path → control_path for all edit pairs in a project.
pub fn load_dataset_control_dirs(
    connection: &Connection,
    project_id: &str,
) -> AppResult<HashMap<String, String>> {
    let mut stmt = connection.prepare(
        "SELECT target_path, control_path FROM dataset_control_dirs WHERE project_id = ?1",
    )?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows.into_iter().collect())
}
