/**
 * @file lora_project_bridge.rs
 * @description 将 lora 训练项目同步到 Agent projects 表，供会话归属与 cwd 使用。
 */
use rusqlite::Connection;
use std::collections::HashSet;

use crate::agent_error::{AppError, AppResult};
use crate::data::db::DbConn;
use crate::data::project::{self, Project};
use crate::infra::db::repos::projects as lora_projects;

fn map_lora_err(error: crate::error::AppError) -> AppError {
    AppError::Other(error.to_string())
}

/**
 * 把 lora.db 中的训练项目 upsert 到 agent.db（同 id，path 使用 root_path）。
 */
pub fn sync_from_lora(lora_conn: &Connection, agent_conn: &DbConn) -> AppResult<()> {
    let records = lora_projects::list_projects(lora_conn).map_err(map_lora_err)?;
    for (index, record) in records.iter().enumerate() {
        project::upsert_from_lora(
            agent_conn,
            &record.id,
            &record.name,
            &record.root_path,
            index as i64,
            record.updated_at,
        )?;
    }
    Ok(())
}

/**
 * 同步后返回仍存在于 lora 的项目列表（按 sort_order）。
 */
pub fn list_projects(lora_conn: &Connection, agent_conn: &DbConn) -> AppResult<Vec<Project>> {
    sync_from_lora(lora_conn, agent_conn)?;
    let lora_ids: HashSet<String> = lora_projects::list_projects(lora_conn)
        .map_err(map_lora_err)?
        .into_iter()
        .map(|record| record.id)
        .collect();
    Ok(project::list(agent_conn)?
        .into_iter()
        .filter(|item| lora_ids.contains(&item.id))
        .collect())
}
