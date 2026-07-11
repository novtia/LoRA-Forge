/**
 * @file infra/db/repos/baidu.rs
 * @description baidu_translate_settings 表 CRUD（单全局行）。
 */
use rusqlite::{params, Connection, OptionalExtension};

use crate::{error::AppResult, models::BaiduTranslateSettings};

use crate::utils::now_ts;

pub fn save_baidu_translate_settings(
    connection: &Connection,
    settings: &BaiduTranslateSettings,
) -> AppResult<()> {
    let config_json = serde_json::to_string(settings)?;
    connection.execute(
        "
        INSERT INTO baidu_translate_settings (id, config_json, version, updated_at)
        VALUES ('global', ?1, 1, ?2)
        ON CONFLICT(id) DO UPDATE SET
            config_json = excluded.config_json,
            version = baidu_translate_settings.version + 1,
            updated_at = excluded.updated_at
        ",
        params![config_json, now_ts()],
    )?;
    Ok(())
}

pub fn load_baidu_translate_settings(connection: &Connection) -> AppResult<BaiduTranslateSettings> {
    let maybe_json = connection
        .query_row(
            "SELECT config_json FROM baidu_translate_settings WHERE id = 'global'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    match maybe_json {
        Some(json) => Ok(serde_json::from_str(&json)?),
        None => Ok(BaiduTranslateSettings::default()),
    }
}
