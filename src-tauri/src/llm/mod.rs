//! LLM caption pipeline.
//!
//! 璋冪敤鍥?
//!
//! ```text
//! auto_tag_image 鈫?generate_dataset_caption 鈫?generate_dataset_caption_once
//!                                            鈫?
//!                                profile::classify_endpoint / is_thinking_model / build_reasoning_payload
//! ```
//!
//! 澶辫触鍒嗘祦閫昏緫锛堝弬瑙?`error::AppError::is_retryable`锛夛細
//!
//! * `ContentFiltered` / `HttpClient` / `Validation` / `Cancelled` 鈫?绔嬪嵆杩斿洖锛屼笉閲嶈瘯銆?
//! * `HttpServer` / `Network` / `Parse` 鈫?鎸囨暟鍥為€€鍚庨噸璇?`caption_retry_max` 娆°€?

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

/// 鑻ヤ笂娓告嫆缁濆浘鐗囪緭鍏ワ細璁板綍 model_id 涓虹函鏂囨湰锛屽苟绔嬪嵆鏃犲浘閲嶈瘯涓€娆°€?
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
                        "妯″瀷 {} 涓嶆敮鎸佸浘鐗囪緭鍏ワ紝宸茶褰曚负绾枃鏈ā鍨嬪苟鏃犳劅閲嶈瘯",
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

/// 缁熶竴鍏ュ彛锛氭寜 `tag_mode` 鍒嗗彂鐩存帴鎵撴爣鎴栧璇濅慨鏀广€?
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

    // 涓婁竴寮犲浘: 浠呭綋浼犲叆璺緞瑙ｆ瀽涓哄彲璇绘枃浠舵椂鎵嶇紪鐮?data URL锛涗换浣?IO 澶辫触閮介潤榛橀檷绾э紙continue without prior turn锛夈€?
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
                            "鏃犳硶璇诲彇 prior image {} ({})锛岃烦杩?prior assistant turn",
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
            // 鎸囨暟鍥為€€ + 鎶栧姩锛歮in(8000, 600 * 2^(attempt-1) + jitter[0..400])
            let base: u64 = 600u64.saturating_mul(1u64 << (attempt - 1).min(6));
            let jitter = pseudo_jitter_ms();
            let sleep_ms = base.saturating_add(jitter).min(8000);
            if let (Some(ref st), Some(prev)) = (log_sink.as_ref(), last_err.as_ref()) {
                st.push_api_log(
                    "llm",
                    "warn",
                    format!(
                        "閲嶈瘯 caption {}/{} 路 涓婃澶辫触: {} 路 绛夊緟 {}ms",
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

/// 瀵硅瘽淇敼妯″紡锛氱敤鎴锋寚浠?+ 鐜版湁 caption锛孡LM 閫氳繃鍐呴儴宸ュ叿淇敼銆?
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
                        "閲嶈瘯 caption modify {}/{} 路 {} 路 绛夊緟 {}ms",
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
                        "璇锋眰 caption modify 路 {} 路 model={} 路 with_image={} 路 {}",
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
                    "caption modify round {} 路 caption_len={}",
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
            // 宸ュ叿宸叉墽琛岃繃鍚庯紝妯″瀷甯镐細鍐嶅彂涓€娈佃鏄庢枃瀛楋紱搴旇繑鍥炲伐鍏蜂骇鍑虹殑 caption锛岃€岄潪璇存槑銆?
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
                st.push_api_log("llm", "error", format!("HTTP {} 路 {}", code, detail));
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

/// 鐢?`now_ns` 浣庝綅鍋氫竴涓潪鍔犲瘑寮哄害鐨勪吉闅忔満鎶栧姩锛岄伩鍏嶆媺鍏?`rand` 渚濊禆銆?
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

    // PriorCaptionMode 鍥涚鍒嗘敮锛?
    //  * InjectAsConversation (榛樿): `system 鈫?user(prompt 鏂囨湰) 鈫?assistant(涓婁竴 caption) 鈫?user(褰撳墠鍥?prompt)`
    //    涓婁竴杞?user **鍙彂鏂囨湰銆佷笉閲嶅鍙戝浘**锛屾棦淇濈暀鍚堟硶瀵硅瘽缁撴瀯鍙堜笉璁╂棫鍥捐Е鍙戜簩娆″畨鍏ㄥ鏍搞€?
    //  * InjectAsFullConversation (闅愬紡瑙﹀彂: 妯″紡閫?InjectAsAssistant 涓斿墠绔紶浜?prior image)
    //    浼氬彂瀹屾暣 `user(涓婂浘)鈫抋ssistant鈫抲ser(褰撳墠鍥?` 4 鏉℃秷鎭€傝璺緞鐩墠 NSFW + Gemini thinking
    //    涓婂け璐ョ巼楂橈紝涓嶄綔涓洪粯璁わ紱濡傛湁 provider 闇€瑕佹墠鐢ㄣ€?
    //  * InjectAsAssistant (鏃?prior image): `system 鈫?assistant(涓婁竴 caption) 鈫?user(褰撳墠鍥?`
    //    缁撴瀯涓嶅悎娉曪紝user prompt 閲岃拷鍔?"don't copy" 鎻愮ず璁╂ā鍨嬭瘑鍒笂涓€鏉′笉鏄嚟绌鸿鐨勩€?
    //  * InjectAsUserExample: 鎶婁笂涓€ caption 鏂囨湰宓屽叆褰撳墠 user prompt
    //  * 鍏朵粬锛圤ff / 鏃?prior锛? 绾崟杞?
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
            // 鐢?base prompt 鏂囨湰浣滀负"涓婁竴杞?user 鍐呭"鈥斺€旂粨鏋勪笂鏄悎娉曠殑澶氳疆瀵硅瘽锛?
            // user 闂啋assistant 绛斺啋user 鍐嶉棶銆傛ā鍨嬩笉浼氳寰?assistant 鏄嚟绌哄啋鍑烘潵鐨勶紝
            // 鍚屾椂涓嶉噸澶嶅彂閫佷笂涓€寮犲浘锛宼oken 鍜屽畨鍏ㄥ鏍稿帇鍔涢兘鏈€灏忋€?
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
                    "璇锋眰 caption 路 {} 路 model={} 路 {}",
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

        // 闈?2xx锛氬垎娴?4xx vs 5xx/429
        if !status.is_success() {
            let detail = extract_error_message(&body);
            let code = status.as_u16();
            if let Some(ref st) = log {
                st.push_api_log("llm", "error", format!("HTTP {} 路 {}", code, detail));
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

        // 200 浣嗗甫 error.code/message 鈫?褰?4xx 澶勭悊
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

        // refusal 瀛楁闈炵┖ 鈫?绔嬪嵆澶辫触
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

        // finish_reason / native_finish_reason 鍛戒腑杩囨护闆嗗悎 鈫?绔嬪嵆澶辫触
        if let Some(reason) = blocking_finish_reason(&payload) {
            let msg = format!(
                "LLM response was blocked by the provider's content filter ({reason})."
            );
            if let Some(ref st) = log {
                st.push_api_log("llm", "warn", msg.clone());
            }
            return Err(AppError::ContentFiltered(msg));
        }

        // 鎻愬彇鍙姝ｆ枃
        let caption = extract_user_visible_caption(&payload)
            .as_deref()
            .map(sanitize_caption)
            .filter(|s| !s.is_empty());

        let caption = match caption {
            Some(text) => text,
            None => {
                // finish_reason == length 涓旀棤鍙姝ｆ枃 鈫?妯″瀷鎶?token 鍏ㄨ姳鍦?reasoning 涓娿€?
                // 閲嶈瘯鍚屾牱浼氬啀鑺变竴娆￠挶鍗翠笉瑙ｅ喅鏍瑰洜锛堣璋冮珮 max_tokens / reasoning_budget锛夛紝鎵€浠?*涓嶉噸璇?*銆?
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
                // 鍏朵綑鎯呭喌锛坮easoning-only / 鏄惧紡 PROHIBITED_CONTENT / 绌?content锛夋寜鍐呭杩囨护澶勭悊锛?
                // **鍙噸璇?*鈥斺€旀煇浜?provider 鍚屼竴寮犲浘鍦ㄤ笉鍚岄噰鏍蜂笅鍙兘缁欏嚭鍙敤 caption銆?
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
                    "鍝嶅簲 OK HTTP {} 路 caption_len={}",
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

    // temperature锛歄penAI 鎬濈淮妯″瀷涓?schema 瑕佹眰 == 1.0锛涘叾浣欐寜鐢ㄦ埛銆?
    let temperature = if matches!(kind, EndpointKind::OpenAi | EndpointKind::Auto) && is_thinking {
        1.0
    } else {
        settings.temperature
    };
    body.insert(
        "temperature".to_string(),
        json!(temperature),
    );

    // max_tokens / max_completion_tokens 鍐崇瓥锛?
    //  * 鎬濈淮妯″瀷锛氱敤 max_completion_tokens锛?0 鏃讹級浣滀负鍙杈撳嚭棰勭畻锛涘悓鏃舵妸 max_tokens 鏀惧ぇ涓?mct + reasoning_budget
    //    浠ラ伩鍏嶆€濊€冪敤鍏夐绠楀鑷存鏂囦负绌恒€?
    //  * 鏅€氭ā鍨嬶細浠呭彂 max_tokens銆?
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
        // 娌℃湁鏄惧紡 max_completion_tokens锛氭妸 max_tokens 鑷姩鏀惧ぇ reasoning_budget锛岄伩鍏嶆€濊€冭€楀敖
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
        // 榛樿鍊煎繀椤绘槸 InjectAsConversation 鈥斺€?NSFW + Gemini thinking 涓?InjectAsAssistant + image
        // 浼氳妯″瀷鍦?PROHIBITED_CONTENT 璺緞涓婃妸 token 鍏ㄩ儴娑堣€楀湪 reasoning 涓婏紝鏄凡鐭ヨ俯鍧戙€?
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
