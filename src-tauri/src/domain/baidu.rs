/**
 * @file domain/baidu.rs
 * @description 百度翻译接入凭据持久化结构。
 */
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BaiduTranslateSettings {
    pub app_id: String,
    pub secret_key: String,
}

impl Default for BaiduTranslateSettings {
    fn default() -> Self {
        Self {
            app_id: String::new(),
            secret_key: String::new(),
        }
    }
}
