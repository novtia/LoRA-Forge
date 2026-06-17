/**
 * @file llm/prompt.rs
 * @description Prompt 组装：Auto-tag 指令、对话修改指令、用户消息 content 构建、系统提示词解析。
 */

use serde_json::{json, Value};

use crate::models::{EndpointKind, LlmSettings};

use super::http::{endpoint_kind_label, LOG_FIELD_TRUNCATE_CHARS};

pub(crate) const DEFAULT_SYSTEM_PROMPT: &str =
    include_str!("../../../prompts/system-prompt.en.md");

pub(crate) const AUTO_TAG_PROMPT: &str = "Generate a concise, training-ready caption for this image for a Stable Diffusion or LoRA dataset. Return only a comma-separated Danbooru-style tag list with no preamble and no full sentences. Include subject, appearance, clothing, pose, framing, environment, and scene lighting when visible. Do NOT include art-style or medium tags (anime, realistic, sketch, cel_shading, monochrome, illustration, etc.), quality tags (masterpiece, best_quality, score_*), or artist names — the LoRA learns rendering from pixels. Keep it factual.";

pub(crate) const MODIFY_CAPTION_SYSTEM_PROMPT: &str = "You edit Danbooru-style comma-separated training captions for Stable Diffusion / LoRA datasets. \
The user provides the current caption and natural-language edit instructions. \
You MUST apply changes ONLY by calling the provided tools (add_tags, remove_tags, replace_tag, set_caption). \
Do not output markdown or explanations in the final message. After tool calls the system returns the updated caption. \
When the caption matches the user's intent, stop calling tools — do not send a summary or confirmation text.";

pub(crate) const EDIT_INSTRUCTION_SYSTEM_PROMPT: &str = "You write concise image-editing instructions for training an image-EDIT model (e.g. Flux Kontext / Flux.2 Klein edit). \
You are shown TWO images: the FIRST is the REFERENCE (before / source) image, the SECOND is the TARGET (after / edited) image. \
Output a single short imperative instruction that, applied to the reference image, would produce the target image. \
Describe ONLY what changed (subject, attributes, colors, style, added/removed elements, background, pose, lighting) — do not describe what stayed the same. \
Return one plain sentence with no preamble, no markdown, no quotes, and no explanation.";

pub(crate) const EDIT_INSTRUCTION_PROMPT: &str = "The first image is the reference (before) image and the second image is the target (after) image. Write one concise imperative edit instruction that transforms the reference into the target. Mention only the differences. Return only the instruction sentence.";

/// 编辑指令模式：基础指令 + 可选用户备注，输入为「改前图 + 改后图」。
pub(crate) fn compose_edit_instruction_user_prompt(user_message: Option<&str>) -> String {
    match user_message.map(str::trim).filter(|s| !s.is_empty()) {
        None => EDIT_INSTRUCTION_PROMPT.to_string(),
        Some(extra) => format!(
            "{}\n\nAdditional notes from the user (treat as authoritative):\n{}",
            EDIT_INSTRUCTION_PROMPT, extra
        ),
    }
}

/// 构造带两张图（改前 + 改后）的 user content；不支持视觉时降级为纯文本。
pub(crate) fn build_edit_user_message_content(
    text: &str,
    reference_image_url: &str,
    target_image_url: &str,
    supports_vision: bool,
) -> Value {
    if supports_vision && !reference_image_url.is_empty() && !target_image_url.is_empty() {
        return json!([
            {"type": "text", "text": text},
            {"type": "text", "text": "Reference (before) image:"},
            {"type": "image_url", "image_url": {"url": reference_image_url}},
            {"type": "text", "text": "Target (after) image:"},
            {"type": "image_url", "image_url": {"url": target_image_url}},
        ]);
    }
    json!(text)
}

/// Keeps multimodal payloads small; omit prior turn if exceeding this character count after trim.
pub(crate) const MAX_PREVIOUS_ASSISTANT_CHARS: usize = 12_000;

pub(crate) fn truncate_previous_assistant_caption(raw: &str) -> String {
    if raw.chars().count() <= MAX_PREVIOUS_ASSISTANT_CHARS {
        return raw.to_string();
    }
    let take = MAX_PREVIOUS_ASSISTANT_CHARS.saturating_sub(1);
    let mut out: String = raw.chars().take(take).collect();
    out.push('…');
    out
}

/// 构造单轮 user prompt：基础打标指令 + 可选的用户备注 + 可选的"参考 caption（文本嵌入版）"。
pub(crate) fn compose_auto_tag_user_prompt(
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

pub(crate) fn compose_modify_user_prompt(
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

pub(crate) fn build_user_message_content(
    text: &str,
    image_data_url: Option<&str>,
    supports_vision: bool,
) -> Value {
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

pub(crate) fn effective_system_prompt(settings: &LlmSettings) -> &str {
    if settings.system_prompt.trim().is_empty() {
        DEFAULT_SYSTEM_PROMPT.trim()
    } else {
        settings.system_prompt.trim()
    }
}

/// API 面板日志：紧凑单行 JSON，含 model / endpoint_kind / has_image / image_bytes / max_tokens / reasoning。
pub(crate) fn format_llm_request_for_api_log(
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
    compact.insert("has_image".to_string(), json!(image_bytes > 0));
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
    for key in ["reasoning", "reasoning_effort", "thinking"] {
        if let Some(r) = body.get(key) {
            compact.insert(key.to_string(), r.clone());
        }
    }
    let _ = LOG_FIELD_TRUNCATE_CHARS; // 仅供 http.rs 使用，这里不截断
    serde_json::to_string(&Value::Object(compact)).unwrap_or_else(|_| "{}".to_string())
}
