//! LLM caption pipeline.
//!
//! 调用图
//!
//! ```text
//! auto_tag_image → generate_dataset_caption → generate_dataset_caption_once
//!                                            ↓
//!                                profile::classify_endpoint / is_thinking_model / build_reasoning_payload
//! ```
//!
//! 失败分流逻辑（参见 `error::AppError::is_retryable`）：
//!
//! * `ContentFiltered` / `HttpClient` / `Validation` / `Cancelled` → 立即返回，不重试。
//! * `HttpServer` / `Network` / `Parse` → 指数回退后重试 `caption_retry_max` 次。

pub mod http;
pub mod models_list;
mod profile;
pub mod prompt;
pub mod tool_calling;

use std::{
    fs,
    future::Future,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Map, Value};
use tokio::time::sleep;

use crate::{
    error::{AppError, AppResult},
    models::{CaptionTagMode, EndpointKind, LlmSettings, PriorCaptionMode},
    state::AppState,
};

use http::{
    blocking_finish_reason, extract_error_message, extract_user_visible_caption, mime_type_for_image,
    normalize_chat_completions_url, openrouter_extra_headers, print_llm_http_response_body_to_stderr,
    response_excerpt, sanitize_caption, shared_http_client,
};
use prompt::{
    build_user_message_content, compose_auto_tag_user_prompt, compose_modify_user_prompt,
    effective_system_prompt, format_llm_request_for_api_log, truncate_previous_assistant_caption,
    MODIFY_CAPTION_SYSTEM_PROMPT,
};

const MAX_CAPTION_TOOL_ROUNDS: usize = 8;


fn persist_model_as_text_only(log_sink: &AppState, model_id: &str) -> AppResult<()> {
    log_sink.with_db(|connection| crate::db::mark_model_text_only_in_global(connection, model_id))
}

/// 若上游拒绝图片输入：记录 model_id 为纯文本，并立即无图重试一次。
async fn run_with_image_fallback<F, Fut>(
    include_image: &mut bool,
    model_id: &str,
    log_sink: &Option<AppState>,
    operation: F,
) -> AppResult<String>
where
    F: Fn(bool) -> Fut,
    Fut: Future<Output = AppResult<String>>,
{
    if !*include_image {
        return operation(false).await;
    }
    match operation(true).await {
        Ok(value) => Ok(value),
        Err(err) if err.is_image_content_rejection() => {
            if let Some(st) = log_sink {
                let _ = persist_model_as_text_only(st, model_id);
                st.push_api_log(
                    "llm",
                    "info",
                    format!(
                        "模型 {} 不支持图片输入，已记录为纯文本模型并无感重试",
                        model_id
                    ),
                );
            }
            *include_image = false;
            operation(false).await
        }
        Err(err) => Err(err),
    }
}

/// 统一入口：按 `tag_mode` 分发直接打标或对话修改。
pub async fn caption_for_dataset_image(
    settings: &LlmSettings,
    image_path: &Path,
    tag_mode: CaptionTagMode,
    user_message: Option<&str>,
    current_caption: Option<&str>,
    previous_assistant_caption: Option<&str>,
    previous_image_path: Option<&Path>,
    cancel: &Arc<AtomicBool>,
    log_sink: Option<AppState>,
) -> AppResult<String> {
    match tag_mode {
        CaptionTagMode::Direct => {
            generate_dataset_caption(
                settings,
                image_path,
                user_message,
                previous_assistant_caption,
                previous_image_path,
                cancel,
                log_sink,
            )
            .await
        }
        CaptionTagMode::ConversationModify => {
            let instruction = user_message
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| {
                    AppError::Validation(
                        "Conversation modify mode requires a user instruction".to_string(),
                    )
                })?;
            let caption = current_caption
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| {
                    AppError::Validation(
                        "Conversation modify mode requires an existing caption to edit".to_string(),
                    )
                })?;
            modify_dataset_caption(
                settings,
                image_path,
                caption,
                instruction,
                cancel,
                log_sink,
            )
            .await
        }
    }
}

pub async fn generate_dataset_caption(
    settings: &LlmSettings,
    image_path: &Path,
    user_message: Option<&str>,
    previous_assistant_caption: Option<&str>,
    previous_image_path: Option<&Path>,
    cancel: &Arc<AtomicBool>,
    log_sink: Option<AppState>,
) -> AppResult<String> {
    settings.validate().map_err(AppError::Validation)?;

    let display_image = image_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("image")
        .to_string();

    let image_bytes = fs::read(image_path)?;
    let image_byte_count = image_bytes.len();
    let mime = mime_type_for_image(image_path);
    let image_data_url = format!(
        "data:{};base64,{}",
        mime,
        STANDARD.encode(&image_bytes)
    );
    drop(image_bytes);

    // 上一张图: 仅当传入路径解析为可读文件时才编码 data URL；任一 IO 失败都静默降级（continue without prior turn）。
    let previous_image_data_url: Option<String> = match previous_image_path {
        Some(path) => match fs::read(path) {
            Ok(bytes) => Some(format!(
                "data:{};base64,{}",
                mime_type_for_image(path),
                STANDARD.encode(&bytes)
            )),
            Err(err) => {
                if let Some(ref st) = log_sink {
                    st.push_api_log(
                        "llm",
                        "warn",
                        format!(
                            "无法读取 prior image {} ({})，跳过 prior assistant turn",
                            path.display(),
                            err
                        ),
                    );
                }
                None
            }
        },
        None => None,
    };

    let max_extra_attempts = settings.caption_retry_max;
    let total_attempts = max_extra_attempts.saturating_add(1);
    let mut last_err: Option<AppError> = None;
    let mut include_image = settings.should_include_image();
    let model_id = settings.model_id.clone();

    for attempt in 0..=max_extra_attempts {
        if cancel.load(Ordering::SeqCst) {
            return Err(AppError::Cancelled);
        }
        if attempt > 0 {
            // 指数回退 + 抖动：min(8000, 600 * 2^(attempt-1) + jitter[0..400])
            let base: u64 = 600u64.saturating_mul(1u64 << (attempt - 1).min(6));
            let jitter = pseudo_jitter_ms();
            let sleep_ms = base.saturating_add(jitter).min(8000);
            if let (Some(ref st), Some(prev)) = (log_sink.as_ref(), last_err.as_ref()) {
                st.push_api_log(
                    "llm",
                    "warn",
                    format!(
                        "重试 caption {}/{} · 上次失败: {} · 等待 {}ms",
                        attempt,
                        max_extra_attempts,
                        prev,
                        sleep_ms
                    ),
                );
            }
            sleep(Duration::from_millis(sleep_ms)).await;
        }
        if cancel.load(Ordering::SeqCst) {
            return Err(AppError::Cancelled);
        }
        match run_with_image_fallback(&mut include_image, &model_id, &log_sink, |with_image| {
            generate_dataset_caption_once(
                settings,
                &image_data_url,
                image_byte_count,
                mime,
                user_message,
                previous_assistant_caption,
                previous_image_data_url.as_deref(),
                with_image,
                cancel,
                display_image.clone(),
                log_sink.clone(),
            )
        })
        .await
        {
            Ok(caption) => return Ok(caption),
            Err(err) => {
                if !err.is_retryable() {
                    return Err(err);
                }
                last_err = Some(err);
            }
        }
    }

    Err(last_err.unwrap_or_else(|| {
        AppError::Process(format!(
            "LLM caption failed after {} attempt(s)",
            total_attempts
        ))
    }))
}

/// 对话修改模式：用户指令 + 现有 caption，LLM 通过内部工具修改。
pub async fn modify_dataset_caption(
    settings: &LlmSettings,
    image_path: &Path,
    current_caption: &str,
    user_instruction: &str,
    cancel: &Arc<AtomicBool>,
    log_sink: Option<AppState>,
) -> AppResult<String> {
    settings.validate().map_err(AppError::Validation)?;

    let display_image = image_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("image")
        .to_string();
    let mime = mime_type_for_image(image_path);
    let image_bytes = fs::read(image_path)?;
    let image_data_url = format!(
        "data:{};base64,{}",
        mime,
        STANDARD.encode(&image_bytes)
    );
    drop(image_bytes);

    let max_extra_attempts = settings.caption_retry_max;
    let mut last_err: Option<AppError> = None;
    let mut include_image = settings.should_include_image();
    let model_id = settings.model_id.clone();

    for attempt in 0..=max_extra_attempts {
        if cancel.load(Ordering::SeqCst) {
            return Err(AppError::Cancelled);
        }
        if attempt > 0 {
            let base: u64 = 600u64.saturating_mul(1u64 << (attempt - 1).min(6));
            let sleep_ms = base.saturating_add(pseudo_jitter_ms()).min(8000);
            if let (Some(ref st), Some(prev)) = (log_sink.as_ref(), last_err.as_ref()) {
                st.push_api_log(
                    "llm",
                    "warn",
                    format!(
                        "重试 caption modify {}/{} · {} · 等待 {}ms",
                        attempt, max_extra_attempts, prev, sleep_ms
                    ),
                );
            }
            sleep(Duration::from_millis(sleep_ms)).await;
        }
        if cancel.load(Ordering::SeqCst) {
            return Err(AppError::Cancelled);
        }
        match run_with_image_fallback(&mut include_image, &model_id, &log_sink, |with_image| {
            modify_dataset_caption_once(
                settings,
                Some(image_data_url.as_str()),
                current_caption,
                user_instruction,
                with_image,
                cancel,
                display_image.clone(),
                log_sink.clone(),
            )
        })
        .await
        {
            Ok(caption) => return Ok(caption),
            Err(err) => {
                if !err.is_retryable() {
                    return Err(err);
                }
                last_err = Some(err);
            }
        }
    }

    Err(last_err.unwrap_or_else(|| {
        AppError::Process("LLM caption modify failed after retries".to_string())
    }))
}

#[allow(clippy::too_many_arguments)]
async fn modify_dataset_caption_once(
    settings: &LlmSettings,
    image_data_url: Option<&str>,
    initial_caption: &str,
    user_instruction: &str,
    include_image: bool,
    cancel: &Arc<AtomicBool>,
    display_image: String,
    log_sink: Option<AppState>,
) -> AppResult<String> {
    if cancel.load(Ordering::SeqCst) {
        return Err(AppError::Cancelled);
    }

    let endpoint = normalize_chat_completions_url(&settings.endpoint_url)?;
    let kind = profile::classify_endpoint(settings);
    let is_thinking = profile::is_thinking_model(&settings.model_id);
    let model_id = settings.model_id.clone();
    let api_key = settings.api_key.trim().to_string();

    let user_prompt = compose_modify_user_prompt(
        user_instruction,
        initial_caption,
        include_image && image_data_url.is_some(),
    );

    let mut messages: Vec<Value> = vec![
        json!({
            "role": "system",
            "content": MODIFY_CAPTION_SYSTEM_PROMPT,
        }),
        json!({
            "role": "user",
            "content": build_user_message_content(
                &user_prompt,
                image_data_url,
                include_image,
            ),
        }),
    ];

    let mut working_caption = initial_caption.trim().to_string();
    let tools = tool_calling::caption_edit_tool_definitions();
    let mut tools_applied = false;

    for round in 0..MAX_CAPTION_TOOL_ROUNDS {
        if cancel.load(Ordering::SeqCst) {
            return Err(AppError::Cancelled);
        }

        let request_body =
            build_request_body_with_tools_inner(&model_id, &messages, settings, kind, is_thinking, &tools);

        if let Some(ref st) = log_sink {
            if round == 0 {
                st.push_api_log(
                    "llm",
                    "info",
                    format!(
                        "请求 caption modify · {} · model={} · with_image={} · {}",
                        display_image,
                        model_id,
                        include_image,
                        endpoint.trim()
                    ),
                );
            }
            st.push_api_log(
                "llm",
                "info",
                format!(
                    "caption modify round {} · caption_len={}",
                    round + 1,
                    working_caption.len()
                ),
            );
        }

        let payload = post_chat_completions(
            &endpoint,
            &request_body,
            &api_key,
            kind,
            cancel,
            log_sink.as_ref(),
        )
        .await?;

        let tool_calls = tool_calling::extract_tool_calls(&payload);
        if tool_calls.is_empty() {
            // 工具已执行过后，模型常会再发一段说明文字；应返回工具产出的 caption，而非说明。
            if tools_applied {
                return Ok(sanitize_caption(&working_caption));
            }
            if let Some(text) = extract_user_visible_caption(&payload)
                .as_deref()
                .map(sanitize_caption)
                .filter(|s| !s.is_empty())
            {
                return Ok(text);
            }
            if working_caption.trim().is_empty() {
                return Err(AppError::ContentFiltered(
                    "LLM did not apply caption edits via tools".to_string(),
                ));
            }
            return Ok(sanitize_caption(&working_caption));
        }

        tools_applied = true;
        let assistant_message = payload
            .pointer("/choices/0/message")
            .cloned()
            .unwrap_or(Value::Null);
        messages.push(assistant_message);

        for (tool_id, tool_name, tool_args) in tool_calls {
            let (new_caption, tool_err) =
                tool_calling::apply_caption_tool_call(&working_caption, &tool_name, &tool_args);
            working_caption = new_caption;
            let tool_content = if let Some(err) = tool_err {
                json!({ "success": false, "error": err, "caption": working_caption })
            } else {
                json!({ "success": true, "caption": working_caption })
            };
            messages.push(json!({
                "role": "tool",
                "tool_call_id": tool_id,
                "content": tool_content.to_string(),
            }));
        }
    }

    Ok(sanitize_caption(&working_caption))
}

fn build_request_body_with_tools_inner(
    model_id: &str,
    messages: &[Value],
    settings: &LlmSettings,
    kind: EndpointKind,
    is_thinking: bool,
    tools: &Value,
) -> Value {
    let mut body = build_request_body(model_id, messages, settings, kind, is_thinking);
    if let Value::Object(ref mut map) = body {
        map.insert("tools".to_string(), tools.clone());
        map.insert("tool_choice".to_string(), json!("auto"));
    }
    body
}

async fn post_chat_completions(
    endpoint: &str,
    request_body: &Value,
    api_key: &str,
    kind: EndpointKind,
    cancel: &Arc<AtomicBool>,
    log_sink: Option<&AppState>,
) -> AppResult<Value> {
    let extra_headers = openrouter_extra_headers(kind);
    let work = async move {
        let client = shared_http_client();
        let mut request = client.post(endpoint).json(request_body);
        if !api_key.is_empty() {
            request = request.bearer_auth(api_key);
        }
        for (name, value) in extra_headers.iter() {
            request = request.header(*name, *value);
        }

        let response = request
            .send()
            .await
            .map_err(|err| AppError::Network(err.to_string()))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|err| AppError::Network(err.to_string()))?;

        print_llm_http_response_body_to_stderr(status.as_u16(), &body);

        if !status.is_success() {
            let detail = extract_error_message(&body);
            let code = status.as_u16();
            if let Some(st) = log_sink {
                st.push_api_log("llm", "error", format!("HTTP {} · {}", code, detail));
            }
            if code == 429 || (500..600).contains(&code) {
                return Err(AppError::HttpServer { status: code, detail });
            }
            return Err(AppError::HttpClient { status: code, detail });
        }

        let payload: Value = serde_json::from_str(&body).map_err(|err| {
            AppError::Parse(format!(
                "Failed to parse LLM response as JSON: {err}. Response excerpt: {}",
                response_excerpt(&body)
            ))
        })?;

        if let Some(err_obj) = payload.get("error") {
            if !matches!(err_obj, Value::Null) {
                if let Some(detail) = err_obj
                    .get("message")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                {
                    return Err(AppError::HttpClient {
                        status: 200,
                        detail,
                    });
                }
            }
        }

        Ok(payload)
    };

    run_with_cancel(work, cancel).await
}

/// 用 `now_ns` 低位做一个非加密强度的伪随机抖动，避免拉入 `rand` 依赖。
fn pseudo_jitter_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(0);
    nanos % 400
}

async fn run_with_cancel<T, F>(future: F, cancel: &Arc<AtomicBool>) -> AppResult<T>
where
    F: Future<Output = AppResult<T>>,
{
    tokio::pin!(future);
    loop {
        tokio::select! {
            result = &mut future => return result,
            _ = tokio::time::sleep(Duration::from_millis(100)) => {
                if cancel.load(Ordering::SeqCst) {
                    return Err(AppError::Cancelled);
                }
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn generate_dataset_caption_once(
    settings: &LlmSettings,
    image_data_url: &str,
    image_byte_count: usize,
    mime: &'static str,
    user_message: Option<&str>,
    previous_assistant_caption: Option<&str>,
    previous_image_data_url: Option<&str>,
    include_image: bool,
    cancel: &Arc<AtomicBool>,
    display_image: String,
    log_sink: Option<AppState>,
) -> AppResult<String> {
    if cancel.load(Ordering::SeqCst) {
        return Err(AppError::Cancelled);
    }

    let endpoint = normalize_chat_completions_url(&settings.endpoint_url)?;
    let endpoint_log = endpoint.clone();
    let display_log = display_image.clone();

    let kind = profile::classify_endpoint(settings);
    let is_thinking = profile::is_thinking_model(&settings.model_id);

    let system_prompt = effective_system_prompt(settings).to_string();
    let prior_trimmed = previous_assistant_caption
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(truncate_previous_assistant_caption);

    // PriorCaptionMode 四种分支：
    //  * InjectAsConversation (默认): `system → user(prompt 文本) → assistant(上一 caption) → user(当前图+prompt)`
    //    上一轮 user **只发文本、不重复发图**，既保留合法对话结构又不让旧图触发二次安全审核。
    //  * InjectAsFullConversation (隐式触发: 模式选 InjectAsAssistant 且前端传了 prior image)
    //    会发完整 `user(上图)→assistant→user(当前图)` 4 条消息。该路径目前 NSFW + Gemini thinking
    //    上失败率高，不作为默认；如有 provider 需要才用。
    //  * InjectAsAssistant (无 prior image): `system → assistant(上一 caption) → user(当前图)`
    //    结构不合法，user prompt 里追加 "don't copy" 提示让模型识别上一条不是凭空说的。
    //  * InjectAsUserExample: 把上一 caption 文本嵌入当前 user prompt
    //  * 其他（Off / 无 prior）: 纯单轮
    enum PriorStrategy {
        TextOnlyConversation(String),
        FullConversation(String, String),
        AssistantOnly(String),
        UserExample(String),
        None,
    }

    let strategy = match (prior_trimmed.as_deref(), settings.prior_caption_mode) {
        (Some(prev), PriorCaptionMode::InjectAsConversation) => {
            PriorStrategy::TextOnlyConversation(prev.to_string())
        }
        (Some(prev), PriorCaptionMode::InjectAsAssistant) => match previous_image_data_url {
            Some(prev_image) => PriorStrategy::FullConversation(prev.to_string(), prev_image.to_string()),
            None => PriorStrategy::AssistantOnly(prev.to_string()),
        },
        (Some(prev), PriorCaptionMode::InjectAsUserExample) => PriorStrategy::UserExample(prev.to_string()),
        _ => PriorStrategy::None,
    };

    let assistant_only_needs_warning = matches!(strategy, PriorStrategy::AssistantOnly(_));
    let prior_text_inline = match &strategy {
        PriorStrategy::UserExample(s) => Some(s.clone()),
        _ => None,
    };

    let user_prompt = compose_auto_tag_user_prompt(
        user_message,
        prior_text_inline.as_deref(),
        assistant_only_needs_warning,
    );

    let model_id = settings.model_id.clone();
    let model_log = model_id.clone();
    let api_key = settings.api_key.trim().to_string();
    let log = log_sink;

    let mut messages: Vec<Value> = vec![json!({
        "role": "system",
        "content": system_prompt,
    })];

    match strategy {
        PriorStrategy::TextOnlyConversation(prev_caption) => {
            // 用 base prompt 文本作为"上一轮 user 内容"——结构上是合法的多轮对话：
            // user 问→assistant 答→user 再问。模型不会觉得 assistant 是凭空冒出来的，
            // 同时不重复发送上一张图，token 和安全审核压力都最小。
            let prior_user_prompt = compose_auto_tag_user_prompt(user_message, None, false);
            messages.push(json!({
                "role": "user",
                "content": prior_user_prompt,
            }));
            messages.push(json!({
                "role": "assistant",
                "content": prev_caption,
            }));
        }
        PriorStrategy::FullConversation(prev_caption, prev_image) => {
            let prior_user_prompt = compose_auto_tag_user_prompt(user_message, None, false);
            messages.push(json!({
                "role": "user",
                "content": build_user_message_content(
                    &prior_user_prompt,
                    Some(&prev_image),
                    include_image,
                ),
            }));
            messages.push(json!({
                "role": "assistant",
                "content": prev_caption,
            }));
        }
        PriorStrategy::AssistantOnly(prev_caption) => {
            messages.push(json!({
                "role": "assistant",
                "content": prev_caption,
            }));
        }
        PriorStrategy::UserExample(_) | PriorStrategy::None => {}
    }

    messages.push(json!({
        "role": "user",
        "content": build_user_message_content(
            &user_prompt,
            Some(image_data_url),
            include_image,
        ),
    }));

    let request_body = build_request_body(&model_id, &messages, settings, kind, is_thinking);
    let llm_request_log_preview =
        format_llm_request_for_api_log(&request_body, kind, image_byte_count, mime, is_thinking);

    let extra_headers = openrouter_extra_headers(kind);

    let work = async move {
        if let Some(ref st) = log {
            st.push_api_log(
                "llm",
                "info",
                format!(
                    "请求 caption · {} · model={} · {}",
                    display_log,
                    model_log,
                    endpoint_log.trim()
                ),
            );
            st.push_api_log("llm", "info", llm_request_log_preview);
        }

        let client = shared_http_client();
        let mut request = client.post(&endpoint).json(&request_body);
        if !api_key.is_empty() {
            request = request.bearer_auth(api_key);
        }
        for (name, value) in extra_headers.iter() {
            request = request.header(*name, *value);
        }

        let response = match request.send().await {
            Ok(resp) => resp,
            Err(err) => {
                let msg = err.to_string();
                if let Some(ref st) = log {
                    st.push_api_log("llm", "error", format!("network: {msg}"));
                }
                return Err(AppError::Network(msg));
            }
        };
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|err| AppError::Network(err.to_string()))?;

        print_llm_http_response_body_to_stderr(status.as_u16(), &body);

        // 非 2xx：分流 4xx vs 5xx/429
        if !status.is_success() {
            let detail = extract_error_message(&body);
            let code = status.as_u16();
            if let Some(ref st) = log {
                st.push_api_log("llm", "error", format!("HTTP {} · {}", code, detail));
            }
            if code == 429 || (500..600).contains(&code) {
                return Err(AppError::HttpServer { status: code, detail });
            }
            return Err(AppError::HttpClient { status: code, detail });
        }

        let payload: Value = serde_json::from_str(&body).map_err(|err| {
            AppError::Parse(format!(
                "Failed to parse LLM response as JSON: {err}. Response excerpt: {}",
                response_excerpt(&body)
            ))
        })?;

        // 200 但带 error.code/message → 当 4xx 处理
        if let Some(err_obj) = payload.get("error") {
            if !matches!(err_obj, Value::Null) {
                if let Some(detail) = err_obj
                    .get("message")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                {
                    if let Some(ref st) = log {
                        st.push_api_log(
                            "llm",
                            "error",
                            format!("LLM payload error: {detail}"),
                        );
                    }
                    return Err(AppError::HttpClient {
                        status: 200,
                        detail,
                    });
                }
            }
        }

        // refusal 字段非空 → 立即失败
        if let Some(refusal) = payload
            .pointer("/choices/0/message/refusal")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let msg = format!("LLM refused to generate a caption: {refusal}");
            if let Some(ref st) = log {
                st.push_api_log("llm", "warn", msg.clone());
            }
            return Err(AppError::ContentFiltered(msg));
        }

        // finish_reason / native_finish_reason 命中过滤集合 → 立即失败
        if let Some(reason) = blocking_finish_reason(&payload) {
            let msg = format!(
                "LLM response was blocked by the provider's content filter ({reason})."
            );
            if let Some(ref st) = log {
                st.push_api_log("llm", "warn", msg.clone());
            }
            return Err(AppError::ContentFiltered(msg));
        }

        // 提取可见正文
        let caption = extract_user_visible_caption(&payload)
            .as_deref()
            .map(sanitize_caption)
            .filter(|s| !s.is_empty());

        let caption = match caption {
            Some(text) => text,
            None => {
                // finish_reason == length 且无可见正文 → 模型把 token 全花在 reasoning 上。
                // 重试同样会再花一次钱却不解决根因（要调高 max_tokens / reasoning_budget），所以 **不重试**。
                if let Some("length") = payload
                    .pointer("/choices/0/finish_reason")
                    .and_then(Value::as_str)
                {
                    let msg = format!(
                        "LLM exhausted token budget with no visible output (finish_reason=length). Increase max_tokens / max_completion_tokens / reasoning_budget. Response excerpt: {}",
                        response_excerpt(&body)
                    );
                    if let Some(ref st) = log {
                        st.push_api_log("llm", "error", msg.clone());
                    }
                    return Err(AppError::OutputBudgetExhausted(msg));
                }
                // 其余情况（reasoning-only / 显式 PROHIBITED_CONTENT / 空 content）按内容过滤处理；
                // **可重试**——某些 provider 同一张图在不同采样下可能给出可用 caption。
                return Err(AppError::ContentFiltered(format!(
                    "LLM response did not contain visible text content (likely blocked or empty). Response excerpt: {}",
                    response_excerpt(&body)
                )));
            }
        };

        if matches!(
            payload
                .pointer("/choices/0/finish_reason")
                .and_then(Value::as_str),
            Some("length")
        ) {
            if let Some(ref st) = log {
                st.push_api_log(
                    "llm",
                    "warn",
                    "finish_reason=length, output may be truncated".to_string(),
                );
            }
        }

        if let Some(ref st) = log {
            st.push_api_log(
                "llm",
                "info",
                format!(
                    "响应 OK HTTP {} · caption_len={}",
                    status.as_u16(),
                    caption.len(),
                ),
            );
        }

        Ok(caption)
    };

    run_with_cancel(work, cancel).await
}

fn build_request_body(
    model_id: &str,
    messages: &[Value],
    settings: &LlmSettings,
    kind: EndpointKind,
    is_thinking: bool,
) -> Value {
    let mut body = Map::new();
    body.insert("model".to_string(), Value::String(model_id.to_string()));
    body.insert("messages".to_string(), Value::Array(messages.to_vec()));

    // temperature：OpenAI 思维模型由 schema 要求 == 1.0；其余按用户。
    let temperature = if matches!(kind, EndpointKind::OpenAi | EndpointKind::Auto) && is_thinking {
        1.0
    } else {
        settings.temperature
    };
    body.insert(
        "temperature".to_string(),
        json!(temperature),
    );

    // max_tokens / max_completion_tokens 决策：
    //  * 思维模型：用 max_completion_tokens（>0 时）作为可见输出预算；同时把 max_tokens 放大为 mct + reasoning_budget
    //    以避免思考用光预算导致正文为空。
    //  * 普通模型：仅发 max_tokens。
    if is_thinking && settings.max_completion_tokens > 0 {
        body.insert(
            "max_completion_tokens".to_string(),
            json!(settings.max_completion_tokens),
        );
        let total = settings
            .max_completion_tokens
            .saturating_add(settings.reasoning_budget.max(settings.max_tokens));
        body.insert("max_tokens".to_string(), json!(total));
    } else if is_thinking {
        // 没有显式 max_completion_tokens：把 max_tokens 自动放大 reasoning_budget，避免思考耗尽
        let expanded = settings.max_tokens.saturating_add(settings.reasoning_budget);
        body.insert("max_tokens".to_string(), json!(expanded));
    } else {
        body.insert("max_tokens".to_string(), json!(settings.max_tokens));
    }

    if let Some((field, value)) = profile::build_reasoning_payload(kind, settings, is_thinking) {
        body.insert(field.to_string(), value);
    }

    Value::Object(body)
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_string_content() {
        let v = json!({
            "choices": [{
                "message": { "content": "  pretty image  " }
            }]
        });
        assert_eq!(
            extract_user_visible_caption(&v),
            Some("pretty image".to_string())
        );
    }

    #[test]
    fn ignore_reasoning_part_type() {
        let v = json!({
            "choices": [{
                "message": {
                    "content": [
                        {"type": "reasoning.text", "text": "let me think..."},
                    ]
                },
                "native_finish_reason": "PROHIBITED_CONTENT"
            }]
        });
        assert_eq!(extract_user_visible_caption(&v), None);
    }

    #[test]
    fn accept_text_part_only() {
        let v = json!({
            "choices": [{
                "message": {
                    "content": [
                        {"type": "reasoning", "text": "ignored"},
                        {"type": "text", "text": "good caption"}
                    ]
                }
            }]
        });
        assert_eq!(
            extract_user_visible_caption(&v),
            Some("good caption".to_string())
        );
    }

    #[test]
    fn finish_reason_blocked() {
        let v = json!({
            "choices": [{
                "finish_reason": "content_filter",
                "message": {"content": "x"}
            }]
        });
        assert!(blocking_finish_reason(&v).is_some());

        let v2 = json!({
            "choices": [{
                "finish_reason": "stop",
                "native_finish_reason": "PROHIBITED_CONTENT"
            }]
        });
        assert!(blocking_finish_reason(&v2).is_some());

        let v3 = json!({"choices":[{"finish_reason":"stop"}]});
        assert!(blocking_finish_reason(&v3).is_none());
    }

    #[test]
    fn sanitize_preserves_newlines() {
        let raw = "1girl, solo\nCenter image: a girl standing.\nUpper image: a boy kneeling.";
        assert_eq!(
            sanitize_caption(raw),
            "1girl, solo\nCenter image: a girl standing.\nUpper image: a boy kneeling."
        );
    }

    #[test]
    fn sanitize_strips_fenced_code() {
        let raw = "```\ngirl, smiling, outdoor\n```";
        assert_eq!(sanitize_caption(raw), "girl, smiling, outdoor");
    }

    #[test]
    fn sanitize_strips_preamble() {
        let raw = "Caption: girl, smiling";
        assert_eq!(sanitize_caption(raw), "girl, smiling");
    }

    #[test]
    fn truncate_data_url_in_log() {
        let mut v = json!({"image_url": {"url": "data:image/png;base64,AAAA1234567890"}});
        truncate_large_string_fields(&mut v, 4);
        assert_eq!(
            v["image_url"]["url"],
            Value::String("data:image/png;base64,...(omitted 14 chars)".to_string())
        );
    }

    #[test]
    fn error_passthrough_includes_payload_error() {
        let body = "{\"error\":{\"message\":\"bad key\"}}";
        assert_eq!(extract_error_message(body), "bad key");

        let body_null = "{\"error\":null}";
        assert!(extract_error_message(body_null).contains("error"));
    }

    #[test]
    fn prior_caption_mode_default_is_text_only_conversation() {
        // 默认值必须是 InjectAsConversation —— NSFW + Gemini thinking 下 InjectAsAssistant + image
        // 会让模型在 PROHIBITED_CONTENT 路径上把 token 全部消耗在 reasoning 上，是已知温床。
        let mode = crate::models::PriorCaptionMode::default();
        assert_eq!(mode, crate::models::PriorCaptionMode::InjectAsConversation);
    }

    #[test]
    fn content_filtered_is_retryable() {
        let err = AppError::ContentFiltered("blocked".to_string());
        assert!(
            err.is_retryable(),
            "ContentFiltered must be retried so the user's `caption_retry_max` budget is honored even on safety blocks"
        );
    }

    #[test]
    fn output_budget_exhausted_is_not_retryable() {
        let err = AppError::OutputBudgetExhausted("length".to_string());
        assert!(
            !err.is_retryable(),
            "OutputBudgetExhausted requires user config change (raise max_tokens); retrying just burns the same cost again"
        );
    }

    #[test]
    fn http_client_4xx_not_retryable() {
        let err = AppError::HttpClient { status: 401, detail: "bad key".to_string() };
        assert!(!err.is_retryable());
    }

    #[test]
    fn http_server_5xx_retryable() {
        let err = AppError::HttpServer { status: 503, detail: "down".to_string() };
        assert!(err.is_retryable());
    }
}
