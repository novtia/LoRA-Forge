/**
 * @file services/caption_service.rs
 * @description 单图打标完整流程：从 DB 读取项目与 LLM 设置 → 解析图片路径 → 调 LLM 打标流水线。
 *   不依赖 Tauri，可被 commands 层和批量任务共享调用。
 */

use std::{
    path::PathBuf,
    sync::{atomic::AtomicBool, Arc},
};

use crate::{
    db,
    error::AppResult,
    llm,
    models::CaptionTagMode,
    state::AppState,
};

/// 对数据集中的单张图片执行 LLM 打标，返回生成的 caption 字符串。
///
/// - `tag_mode` — `Direct`（直接生成）或 `ConversationModify`（基于现有 caption 修改）
/// - `user_message` — 用户附加指令
/// - `current_caption` — 当前 caption（ConversationModify 模式必填）
/// - `previous_assistant_caption` / `previous_image_relative_path` — 上一张图的 caption / 路径（用于注入对话上下文）
#[allow(clippy::too_many_arguments)]
pub async fn caption_image(
    state: AppState,
    project_id: &str,
    relative_path: &str,
    tag_mode: CaptionTagMode,
    user_message: Option<&str>,
    current_caption: Option<&str>,
    previous_assistant_caption: Option<&str>,
    previous_image_relative_path: Option<&str>,
    cancel: Arc<AtomicBool>,
) -> AppResult<String> {
    let (project, settings) = state.with_db(|connection| {
        Ok((
            db::get_project(connection, project_id)?,
            db::load_llm_settings(connection)?,
        ))
    })?;

    let dataset_root = PathBuf::from(project.dataset_path);
    let image_path = resolve_dataset_path(&dataset_root, relative_path)?;

    // 仅在能成功解析出之前图的路径、且存在时才传给 LLM 层；
    // 否则传 None（防止错误数据导致 IO 错误打断主流程）。
    let previous_image_path = previous_image_relative_path.and_then(|rel| {
        let resolved = resolve_dataset_path(&dataset_root, rel).ok()?;
        if resolved.is_file() { Some(resolved) } else { None }
    });

    llm::caption_for_dataset_image(
        &settings,
        &image_path,
        tag_mode,
        user_message,
        current_caption,
        previous_assistant_caption,
        previous_image_path.as_deref(),
        &cancel,
        Some(state.clone()),
    )
    .await
}

fn resolve_dataset_path(root: &PathBuf, relative_path: &str) -> AppResult<PathBuf> {
    use crate::utils::ensure_within;
    let target = root.join(relative_path.replace('/', std::path::MAIN_SEPARATOR_STR));
    ensure_within(root, &target)
}
