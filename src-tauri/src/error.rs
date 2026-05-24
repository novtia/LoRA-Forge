use std::{io, path::StripPrefixError};

use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Tauri error: {0}")]
    Tauri(#[from] tauri::Error),
    #[error("Process error: {0}")]
    Process(String),
    #[error("State error: {0}")]
    State(String),
    #[error("LLM caption cancelled")]
    Cancelled,
    /// 供应商内容审核拒答 / 安全过滤命中 / refusal / 无可见 text 分片 —— **可重试**
    /// （Gemini 等模型同一张图在不同采样下可能给出可用 caption；用户期望即使被标
    /// `content_filter` 也继续重试，直到耗尽 `caption_retry_max`）。
    #[error("LLM content filtered: {0}")]
    ContentFiltered(String),
    /// 模型把 token 预算全花在思考上 / `finish_reason=length` 且没有可见正文 ——
    /// 重试同样会再花一次钱却不解决根因（应让用户调高 `max_tokens` /
    /// `max_completion_tokens` / `reasoning_budget`），所以 **不重试**。
    #[error("LLM output budget exhausted: {0}")]
    OutputBudgetExhausted(String),
    /// 4xx 客户端错误（鉴权 / 配额 / 请求结构）—— **不应重试**。
    #[error("LLM HTTP {status}: {detail}")]
    HttpClient { status: u16, detail: String },
    /// 5xx / 429 服务端错误 / 限流 —— **可重试**。
    #[error("LLM HTTP {status}: {detail}")]
    HttpServer { status: u16, detail: String },
    /// 网络层错误（DNS / connect / TLS / 超时 / 读取中断）—— **可重试**。
    #[error("LLM network error: {0}")]
    Network(String),
    /// 响应体解析失败 / 结构不匹配 —— **可重试**（可能是服务端瞬时返回截断数据）。
    #[error("LLM response parse error: {0}")]
    Parse(String),
}

impl AppError {
    /// `true` 表示这种错误**可以**通过重试缓解；`false` 表示重试无意义（应立即返回）。
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            AppError::HttpServer { .. }
                | AppError::Network(_)
                | AppError::Parse(_)
                | AppError::ContentFiltered(_)
        )
    }

    /// 上游拒绝 multimodal / image_url 内容块（应改用纯文本并重试）。
    pub fn is_image_content_rejection(&self) -> bool {
        match self {
            AppError::HttpClient { detail, .. } => is_image_content_rejection_detail(detail),
            _ => false,
        }
    }
}

/// 根据 HTTP 错误详情判断是否为「不支持图片输入」。
pub fn is_image_content_rejection_detail(detail: &str) -> bool {
    let lower = detail.to_ascii_lowercase();
    lower.contains("image_url")
        || (lower.contains("expected") && lower.contains("text"))
        || (lower.contains("unknown variant") && lower.contains("image"))
        || lower.contains("does not support image")
        || lower.contains("not support image")
        || (lower.contains("multimodal") && lower.contains("not"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_rejection_detail_matches_openai_compat_error() {
        let detail = "Failed to deserialize the JSON body into the target type: messages[1]: unknown variant `image_url`, expected `text`";
        assert!(is_image_content_rejection_detail(detail));
    }
}

impl From<StripPrefixError> for AppError {
    fn from(error: StripPrefixError) -> Self {
        Self::Validation(format!("Path is outside the allowed workspace: {error}"))
    }
}
