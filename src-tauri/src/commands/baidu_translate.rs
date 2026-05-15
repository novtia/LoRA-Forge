use serde::Deserialize;
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

use crate::{
    commands::respond,
    db,
    models::BaiduTranslateSettings,
    state::AppState,
};

const BAIDU_TRANSLATE_URL: &str = "https://fanyi-api.baidu.com/api/trans/vip/translate";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBaiduTranslateInput {
    pub settings: BaiduTranslateSettings,
}

#[tauri::command]
pub fn load_baidu_translate_settings(state: State<'_, AppState>) -> Result<BaiduTranslateSettings, String> {
    respond(state.with_db(db::load_baidu_translate_settings))
}

#[tauri::command]
pub fn save_baidu_translate_settings(
    input: SaveBaiduTranslateInput,
    state: State<'_, AppState>,
) -> Result<BaiduTranslateSettings, String> {
    let settings = input.settings;
    respond(
        state
            .with_db(|connection| db::save_baidu_translate_settings(connection, &settings))
            .map(|()| settings),
    )
}

/// Calls the Baidu general translation API. `from` / `to` use Baidu language codes (e.g. `en`, `zh`, `auto`).
#[tauri::command]
pub async fn baidu_translate(
    text: String,
    from: Option<String>,
    to: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }

    let settings = state
        .with_db(db::load_baidu_translate_settings)
        .map_err(|e| e.to_string())?;

    if settings.app_id.trim().is_empty() || settings.secret_key.trim().is_empty() {
        return Err(
            "未配置百度翻译：请在「设计」→「LLM」→「API 配置」中填写 App ID 与密钥。"
                .to_string(),
        );
    }

    let app_state = state.inner().clone();

    let from_lang = from
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "auto".to_string());
    let to_lang = to
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "zh".to_string());

    translate_baidu_request(trimmed, &from_lang, &to_lang, &settings, Some(&app_state)).await
}

async fn translate_baidu_request(
    query: &str,
    from: &str,
    to: &str,
    settings: &BaiduTranslateSettings,
    log_sink: Option<&AppState>,
) -> Result<String, String> {
    if let Some(st) = log_sink {
        st.push_api_log(
            "baidu_translate",
            "info",
            format!(
                "POST translate · {}→{} · chars={}",
                from,
                to,
                query.chars().count()
            ),
        );
    }

    let appid = settings.app_id.trim();
    let secret = settings.secret_key.trim();

    let salt = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| (d.as_micros() as u64 % 900_000_000) + 100_000_000)
        .unwrap_or(987_654_321);
    let salt_str = salt.to_string();

    let sign_source = format!("{}{}{}{}", appid, query, salt_str, secret);
    let digest = md5::compute(sign_source.as_bytes());
    let sign = format!("{:x}", digest);

    let client = reqwest::Client::new();
    let response = match client
        .post(BAIDU_TRANSLATE_URL)
        .form(&[
            ("q", query),
            ("from", from),
            ("to", to),
            ("appid", appid),
            ("salt", salt_str.as_str()),
            ("sign", sign.as_str()),
        ])
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            let msg = format!("Baidu translate request failed: {e}");
            if let Some(st) = log_sink {
                st.push_api_log("baidu_translate", "error", msg.clone());
            }
            return Err(msg);
        }
    };

    let status = response.status();
    let body: Value = match response.json().await {
        Ok(v) => v,
        Err(e) => {
            let msg = format!("Baidu translate: invalid JSON ({status}): {e}");
            if let Some(st) = log_sink {
                st.push_api_log("baidu_translate", "error", msg.clone());
            }
            return Err(msg);
        }
    };

    if let Some(code) = body.get("error_code") {
        let code_str = match code {
            Value::String(s) => s.clone(),
            _ => code.to_string(),
        };
        let msg = body
            .get("error_msg")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        let err_line = format!("Baidu translate error {code_str}: {msg}");
        if let Some(st) = log_sink {
            st.push_api_log("baidu_translate", "error", err_line.clone());
        }
        return Err(err_line);
    }

    let items = match body.get("trans_result").and_then(|v| v.as_array()) {
        Some(arr) => arr,
        None => {
            let msg = "Baidu translate: missing trans_result".to_string();
            if let Some(st) = log_sink {
                st.push_api_log("baidu_translate", "error", msg.clone());
            }
            return Err(msg);
        }
    };

    let mut out = String::new();
    for item in items {
        if let Some(dst) = item.get("dst").and_then(|v| v.as_str()) {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(dst);
        }
    }

    if out.is_empty() {
        let msg = "Baidu translate: empty translation".to_string();
        if let Some(st) = log_sink {
            st.push_api_log("baidu_translate", "error", msg.clone());
        }
        return Err(msg);
    }

    if let Some(st) = log_sink {
        st.push_api_log(
            "baidu_translate",
            "info",
            format!("响应 OK · segments={} · chars={}", items.len(), out.chars().count()),
        );
    }

    Ok(out)
}
