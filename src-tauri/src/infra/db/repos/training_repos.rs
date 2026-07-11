/**
 * @file infra/db/repos/training_repos.rs
 * @description training_repos 表 CRUD：持久化用户自定义训练仓库定义（git URL / target / 安装路径）。
 */
use rusqlite::{params, Connection};

use crate::{error::AppResult, models::CustomRepoRecord, utils::now_ts};

pub fn list_custom_repos(connection: &Connection) -> AppResult<Vec<CustomRepoRecord>> {
    let mut statement =
        connection.prepare("SELECT config_json FROM training_repos ORDER BY created_at ASC")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    let mut repos = Vec::new();
    for row in rows {
        let json = row?;
        if let Ok(record) = serde_json::from_str::<CustomRepoRecord>(&json) {
            repos.push(record);
        }
    }
    Ok(repos)
}

pub fn insert_custom_repo(connection: &Connection, record: &CustomRepoRecord) -> AppResult<()> {
    let config_json = serde_json::to_string(record)?;
    let ts = now_ts();
    connection.execute(
        "
        INSERT INTO training_repos (id, config_json, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?3)
        ON CONFLICT(id) DO UPDATE SET
            config_json = excluded.config_json,
            updated_at = excluded.updated_at
        ",
        params![record.id, config_json, ts],
    )?;
    Ok(())
}

pub fn delete_custom_repo(connection: &Connection, id: &str) -> AppResult<()> {
    connection.execute("DELETE FROM training_repos WHERE id = ?1", params![id])?;
    Ok(())
}
