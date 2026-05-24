//! LLM caption pipeline.
//!
//! 调用图:
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

mod caption_tools;
pub mod models_list;
mod profile;

use std::{
    fs,
    future::Future,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    },
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::Client;
use serde_json::{json, Map, Value};
use tokio::time::sleep;

use crate::{
    error::{AppError, AppResult},
    models::{CaptionTagMode, EndpointKind, LlmSettings, PriorCaptionMode},
    state::AppState,
};

const DEFAULT_SYSTEM_PROMPT: &str = include_str!("../../../prompts/system-prompt.en.md");
const AUTO_TAG_PROMPT: &str = "Generate a concise, training-ready caption for this image for a Stable Diffusion or LoRA dataset. Return only a comma-separated Danbooru-style tag list with no preamble and no full sentences. Include subject, appearance, clothing, pose, framing, environment, and scene lighting when visible. Do NOT include art-style or medium tags (anime, realistic, sketch, cel_shading, monochrome, illustration, etc.), quality tags (masterpiece, best_quality, score_*), or artist names — the LoRA learns rendering from pixels. Keep it factual.";
const MODIFY_CAPTION_SYSTEM_PROMPT: &str = "You edit Danbooru-style comma-separated training captions for Stable Diffusion / LoRA datasets. \
The user provides the current caption and natural-language edit instructions. \
You MUST apply changes ONLY by calling the provided tools (add_tags, remove_tags, replace_tag, set_caption). \
Do not output markdown or explanations in the final message. After tool calls the system returns the updated caption. \
When the caption matches the user's intent, stop calling tools — do not send a summary or confirmation text.";
const MAX_CAPTION_TOOL_ROUNDS: usize = 8;
/// Keeps multimodal payloads small; omit prior turn if exceeding this character count after trim.
const MAX_PREVIOUS_ASSISTANT_CHARS: usize = 12_000;
/// 用于日志截断（避免在 stderr / api log 里写出整张图的 base64）。
const LOG_FIELD_TRUNCATE_CHARS: usize = 2000;
const HTTP_CONNECT_TIMEOUT_SECS: u64 = 15;
const HTTP_TOTAL_TIMEOUT_SECS: u64 = 180;
const HTTP_POOL_IDLE_SECS: u64 = 90;
const USER_AGENT_VALUE: &str = concat!("lora-forge/", env!("CARGO_PKG_VERSION"));

/// 全局共享的 HTTP 客户端，避免每个请求都重建 TLS / 连接池。
pub(crate) fn shared_http_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(HTTP_CONNECT_TIMEOUT_SECS))
            .timeout(Duration::from_secs(HTTP_TOTAL_TIMEOUT_SECS))
            .pool_idle_timeout(Duration::from_secs(HTTP_POOL_IDLE_SECS))
            .user_agent(USER_AGENT_VALUE)
            .build()
            .expect("failed to build shared reqwest client")
    })
}

fn truncate_previous_assistant_caption(raw: &str) -> String {
    if raw.chars().count() <= MAX_PREVIOUS_ASSISTANT_CHARS {
        return raw.to_string();
    }
    let take = MAX_PREVIOUS_ASSISTANT_CHARS.saturating_sub(1);
    let mut out: String = raw.chars().take(take).collect();
    out.push('…');
    out
}

/// 构造单轮 user prompt：基础打标指令 + 可选的用户备注 + 可选的"参考 caption（文本嵌入版）"。
///
/// * `prior_caption_for_user_text` 仅在 `PriorCaptionMode::InjectAsUserExample` 时传入。
/// * `assistant_turn_without_image` 用于"老前端没传上一张图片路径"的兼容路径——此时 prior caption
///   作为 assistant 消息插在 user 前但**没有对应的 user 图片**，需要文本里明确告诉模型"上一条是
///   前一张图的 caption、本次是新图、别照抄"。完整合法对话（带 prior image）则**不需要**这段提示。
fn compose_auto_tag_user_prompt(
    user_message: Option<&str>,
    prior_caption_for_user_text: Option<&str>,
    assistant_turn_without_image: bool,
) -> String {
    let mut body = match user_message.map(str::trim).filter(|s| !s.is_empty()) {
        None => AUTO_TAG_PROMPT.to_string(),
        Some(extra) => format!(
            "{}\n\nAdditional notes from the user (treat as authoritative if they correct a misread of the image):\n{}",
            AUTO_TAG_PROMPT, extra
        ),
    };
    if assistant_turn_without_image {
        body = format!(
            "The assistant message above is your prior caption for a DIFFERENT image in this session. The attachment in THIS user message is a NEW image. Write a brand-new caption for only the new attachment; do not copy the prior caption. Keep the same output format your instructions require.\n\n{}",
            body
        );
    }
    if let Some(prior) = prior_caption_for_user_text {
        body = format!(
            "{}\n\n### Reference caption for a DIFFERENT image (do not copy; use only to align tone/format):\n{}",
            body, prior
        );
    }
    body
}

fn build_user_message_content(text: &str, image_data_url: Option<&str>, supports_vision: bool) -> Value {
    if supports_vision {
        if let Some(url) = image_data_url.filter(|u| !u.is_empty()) {
            return json!([
                {"type": "text", "text": text},
                {"type": "image_url", "image_url": {"url": url}},
            ]);
        }
    }
    json!(text)
}

fn compose_modify_user_prompt(
    user_instruction: &str,
    current_caption: &str,
    include_image_note: bool,
) -> String {
    let mut body = format!(
        "Current caption (comma-separated Danbooru tags):\n{}\n\nUser edit request:\n{}",
        current_caption.trim(),
        user_instruction.trim()
    );
    if include_image_note {
        body.push_str(
            "\n\nAn image of the subject is attached for reference when deciding tag changes.",
        );
    } else {
        body.push_str(
            "\n\n(No image is available — edit the caption text only based on the user's request.)",
        );
    }
    body.push_str("\n\nUse the provided tools to apply the requested changes.");
    body
}

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

    // 上一张图: 仅当传入路径解析为可读文件时才编码 data URL；任何 IO 失败都静默降级（continue without prior turn）。
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
    let tools = caption_tools::caption_edit_tool_definitions();
    let mut tools_applied = false;

    for round in 0..MAX_CAPTION_TOOL_ROUNDS {
        if cancel.load(Ordering::SeqCst) {
            return Err(AppError::Cancelled);
        }

        let request_body =
            build_request_body_with_tools(&model_id, &messages, settings, kind, is_thinking, &tools);

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

        let tool_calls = caption_tools::extract_tool_calls(&payload);
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
                caption_tools::apply_caption_tool_call(&working_caption, &tool_name, &tool_args);
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

fn build_request_body_with_tools(
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
                // 重试同样会再花一次钱却不解决根因（要调高 max_tokens / reasoning_budget），所以**不重试**。
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
                // 其余情况（reasoning-only / 显式 PROHIBITED_CONTENT / 空 content）按内容过滤处理，
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

    // temperature：OpenAI 思维模型上 schema 要求 == 1.0；其余按用户。
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

fn openrouter_extra_headers(kind: EndpointKind) -> &'static [(&'static str, &'static str)] {
    match kind {
        EndpointKind::OpenRouter => &[
            ("HTTP-Referer", "https://lora-forge.local"),
            ("X-Title", "LoRA Forge"),
        ],
        _ => &[],
    }
}

fn effective_system_prompt(settings: &LlmSettings) -> &str {
    if settings.system_prompt.trim().is_empty() {
        DEFAULT_SYSTEM_PROMPT.trim()
    } else {
        settings.system_prompt.trim()
    }
}

/// API 面板日志：紧凑单行 JSON，含 model / endpoint_kind / has_image / image_bytes / max_tokens / reasoning。
fn format_llm_request_for_api_log(
    body: &Value,
    kind: EndpointKind,
    image_bytes: usize,
    mime: &str,
    is_thinking: bool,
) -> String {
    let mut compact = serde_json::Map::new();
    if let Some(model) = body.get("model") {
        compact.insert("model".to_string(), model.clone());
    }
    compact.insert("endpoint_kind".to_string(), json!(endpoint_kind_label(kind)));
    compact.insert("is_thinking".to_string(), json!(is_thinking));
    compact.insert(
        "has_image".to_string(),
        json!(image_bytes > 0),
    );
    compact.insert("image_bytes".to_string(), json!(image_bytes));
    compact.insert("image_mime".to_string(), json!(mime));
    if let Some(messages) = body.get("messages").and_then(Value::as_array) {
        compact.insert("messages_count".to_string(), json!(messages.len()));
    }
    if let Some(mt) = body.get("max_tokens") {
        compact.insert("max_tokens".to_string(), mt.clone());
    }
    if let Some(mct) = body.get("max_completion_tokens") {
        compact.insert("max_completion_tokens".to_string(), mct.clone());
    }
    if let Some(t) = body.get("temperature") {
        compact.insert("temperature".to_string(), t.clone());
    }
    if let Some(r) = body.get("reasoning") {
        compact.insert("reasoning".to_string(), r.clone());
    }
    if let Some(r) = body.get("reasoning_effort") {
        compact.insert("reasoning_effort".to_string(), r.clone());
    }
    if let Some(r) = body.get("thinking") {
        compact.insert("thinking".to_string(), r.clone());
    }
    serde_json::to_string(&Value::Object(compact)).unwrap_or_else(|_| "{}".to_string())
}

fn endpoint_kind_label(kind: EndpointKind) -> &'static str {
    match kind {
        EndpointKind::Auto => "auto",
        EndpointKind::OpenAi => "openai",
        EndpointKind::OpenRouter => "openrouter",
        EndpointKind::AnthropicCompat => "anthropic",
    }
}

fn normalize_chat_completions_url(endpoint_url: &str) -> AppResult<String> {
    let trimmed = endpoint_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(AppError::Validation("Endpoint URL is required".to_string()));
    }

    if trimmed.ends_with("/chat/completions") {
        Ok(trimmed.to_string())
    } else {
        Ok(format!("{trimmed}/chat/completions"))
    }
}

/// 将本次 chat/completions 的 HTTP 响应体打印到 stderr（开发机 `tauri dev` 终端可见）。
///
/// 解析为 JSON 后会递归把过长字符串字段截断为 `…(truncated N bytes)`，避免把整张图的 base64 写进日志。
fn print_llm_http_response_body_to_stderr(http_status: u16, body: &str) {
    eprintln!("[llm] ========== HTTP {http_status} ==========");
    match serde_json::from_str::<Value>(body) {
        Ok(mut value) => {
            truncate_large_string_fields(&mut value, LOG_FIELD_TRUNCATE_CHARS);
            let text = serde_json::to_string_pretty(&value).unwrap_or_else(|_| body.to_string());
            eprintln!("{text}");
        }
        Err(_) => {
            let head: String = body.chars().take(LOG_FIELD_TRUNCATE_CHARS).collect();
            eprintln!("{head}");
            if body.chars().count() > LOG_FIELD_TRUNCATE_CHARS {
                eprintln!(
                    "…(truncated {} chars)",
                    body.chars().count() - LOG_FIELD_TRUNCATE_CHARS
                );
            }
        }
    }
    eprintln!("[llm] ========== end ==========");
}

fn truncate_large_string_fields(value: &mut Value, max_chars: usize) {
    match value {
        Value::String(s) => {
            // 特别处理 data URL：保留 mime 头 + 字节数提示，丢弃 base64 主体
            if let Some(rest) = s.strip_prefix("data:") {
                if let Some((mime, payload)) = rest.split_once(',') {
                    let bytes_hint = payload.len();
                    *s = format!("data:{mime},...(omitted {bytes_hint} chars)");
                    return;
                }
            }
            let char_count = s.chars().count();
            if char_count > max_chars {
                let truncated: String = s.chars().take(max_chars).collect();
                *s = format!(
                    "{truncated}…(truncated {} chars)",
                    char_count - max_chars
                );
            }
        }
        Value::Array(arr) => {
            for v in arr.iter_mut() {
                truncate_large_string_fields(v, max_chars);
            }
        }
        Value::Object(map) => {
            for (_, v) in map.iter_mut() {
                truncate_large_string_fields(v, max_chars);
            }
        }
        _ => {}
    }
}

/// 解析错误消息：优先 `error.message`，否则截断 body 前 400 字符。
fn extract_error_message(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|payload| {
            payload
                .get("error")
                .filter(|v| !matches!(v, Value::Null))
                .and_then(|error| {
                    error
                        .get("message")
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                        .or_else(|| error.as_str().map(ToString::to_string))
                })
        })
        .unwrap_or_else(|| body.trim().chars().take(400).collect())
}

/// 严格白名单：只采纳 `choices[0].message.content` 是 string、或者数组里 `type` 命中
/// `{"text","output_text"}`（或缺省）的分片，**不**递归到 `reasoning` / `thought` / `image_url` 等。
fn extract_user_visible_caption(payload: &Value) -> Option<String> {
    let content = payload.pointer("/choices/0/message/content");
    if let Some(text) = extract_caption_from_message_content(content) {
        return Some(text);
    }
    // OpenAI legacy completions 端点
    payload
        .pointer("/choices/0/text")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn extract_caption_from_message_content(content: Option<&Value>) -> Option<String> {
    match content? {
        Value::Null => None,
        Value::String(s) => non_empty_text(s),
        Value::Array(parts) => {
            let mut chunks: Vec<String> = Vec::new();
            for part in parts {
                let Value::Object(map) = part else {
                    continue;
                };
                let typ_raw = map.get("type").and_then(Value::as_str);
                let typ = typ_raw.unwrap_or("text").trim().to_ascii_lowercase();

                if is_hidden_or_non_text_part(&typ) {
                    continue;
                }
                // 只接受白名单 type；其它一律忽略，避免穿透到 reasoning_details / images / refusal 等
                if typ_raw.is_some()
                    && !matches!(typ.as_str(), "text" | "output_text" | "input_text")
                {
                    continue;
                }

                if let Some(t) = map.get("text").and_then(Value::as_str) {
                    if let Some(trimmed) = non_empty_text(t) {
                        chunks.push(trimmed);
                    }
                } else if let Some(t) = map.get("content").and_then(Value::as_str) {
                    if let Some(trimmed) = non_empty_text(t) {
                        chunks.push(trimmed);
                    }
                }
            }
            non_empty_text(&chunks.join(" "))
        }
        Value::Object(map) => {
            // 个别 provider 直接给 {text:"..."}；只接受确定是文本的字段
            map.get("text")
                .and_then(Value::as_str)
                .and_then(non_empty_text)
                .or_else(|| {
                    map.get("content")
                        .and_then(Value::as_str)
                        .and_then(non_empty_text)
                })
        }
        _ => None,
    }
}

/// 任何包含 `reasoning|thinking|thought|image_url|input_image|refusal` 的 part type 都视为「非可见正文」。
fn is_hidden_or_non_text_part(typ: &str) -> bool {
    typ.contains("reasoning")
        || typ.contains("thinking")
        || typ.contains("thought")
        || typ == "image_url"
        || typ == "input_image"
        || typ == "refusal"
}

/// 命中以下任一 `finish_reason` / `native_finish_reason` 即视为内容审核阻断。
fn blocking_finish_reason(payload: &Value) -> Option<String> {
    const BLOCKED: &[&str] = &[
        "content_filter",
        "prohibited_content",
        "safety",
        "recitation",
        "blocklist",
        "blocked",
    ];

    let pick = |val: &Value| -> Option<String> {
        let s = val.as_str()?.trim();
        let lower = s.to_ascii_lowercase().replace('-', "_");
        if BLOCKED.iter().any(|b| lower.contains(b)) {
            Some(s.to_string())
        } else {
            None
        }
    };

    if let Some(s) = payload
        .pointer("/choices/0/finish_reason")
        .and_then(pick)
    {
        return Some(s);
    }
    if let Some(s) = payload
        .pointer("/choices/0/native_finish_reason")
        .and_then(pick)
    {
        return Some(s);
    }
    None
}

fn non_empty_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn response_excerpt(body: &str) -> String {
    let excerpt = body.trim().chars().take(400).collect::<String>();
    if excerpt.is_empty() {
        "<empty response>".to_string()
    } else {
        excerpt
    }
}

/// 清洗 caption：
///
/// 1. 剥离 fenced code blocks（\`\`\`lang ... \`\`\` → 内部内容）。
/// 2. 剥离常见前缀（`Here is/Caption:/Tags:`...）。
/// 3. 折叠空白但保留换行；按行 trim 后拼接。
/// 4. 循环 trim 引号 / 反引号 / 反引号外层字符，直到不再变化。
fn sanitize_caption(raw: &str) -> String {
    let mut text = strip_fenced_code_block(raw);
    text = strip_leading_preamble(&text);

    let collapsed: String = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    let mut cur = collapsed.trim().to_string();
    loop {
        let stripped = cur
            .trim()
            .trim_matches('`')
            .trim_matches('"')
            .trim_matches('\'')
            .trim_matches('“')
            .trim_matches('”')
            .trim_matches('‘')
            .trim_matches('’')
            .to_string();
        if stripped == cur {
            break;
        }
        cur = stripped;
    }
    cur
}

fn strip_fenced_code_block(raw: &str) -> String {
    let trimmed = raw.trim();
    if !trimmed.starts_with("```") {
        return raw.to_string();
    }
    // 找到首个换行（跳过 ```lang 语言行），与最后一个 ``` 闭合
    let after_open = match trimmed.find('\n') {
        Some(i) => &trimmed[i + 1..],
        None => return raw.to_string(),
    };
    if let Some(end) = after_open.rfind("```") {
        after_open[..end].to_string()
    } else {
        after_open.to_string()
    }
}

fn strip_leading_preamble(raw: &str) -> String {
    let trimmed = raw.trim_start();
    let lower = trimmed.to_ascii_lowercase();
    const PREFIXES: &[&str] = &[
        "here is a caption:",
        "here is the caption:",
        "here's a caption:",
        "here's the caption:",
        "caption:",
        "tags:",
        "output:",
        "result:",
    ];
    for prefix in PREFIXES {
        if lower.starts_with(prefix) {
            return trimmed[prefix.len()..].trim_start().to_string();
        }
    }
    raw.to_string()
}

fn mime_type_for_image(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        _ => "application/octet-stream",
    }
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
        // 默认值必须是 InjectAsConversation —— NSFW + Gemini thinking 上 InjectAsAssistant + image
        // 会让模型在 PROHIBITED_CONTENT 路径上把 token 全部消耗在 reasoning 上，是已知踩坑。
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
