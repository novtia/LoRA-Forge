//! Internal tools for LLM-driven caption editing (conversation modify mode).
//!
//! The model emits OpenAI-style `tool_calls`; we apply them locally to the caption string.

use serde_json::{json, Value};

/// OpenAI-compatible tool definitions sent to the upstream API.
pub fn caption_edit_tool_definitions() -> Value {
    json!([
        {
            "type": "function",
            "function": {
                "name": "add_tags",
                "description": "Insert comma-separated Danbooru tags at a position in the caption.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "tags": {
                            "type": "string",
                            "description": "Comma-separated tags to insert."
                        },
                        "position": {
                            "type": "integer",
                            "description": "0 = front; positive N = after the N-th existing tag; -1 = append at end. Defaults to -1."
                        }
                    },
                    "required": ["tags"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "remove_tags",
                "description": "Remove one or more tags from the caption (case-insensitive match).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "tags": {
                            "type": "string",
                            "description": "Comma-separated tags to remove."
                        }
                    },
                    "required": ["tags"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "replace_tag",
                "description": "Replace a single tag with another (case-insensitive match on old_tag).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "old_tag": { "type": "string" },
                        "new_tag": { "type": "string" }
                    },
                    "required": ["old_tag", "new_tag"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "set_caption",
                "description": "Replace the entire caption with a new comma-separated Danbooru tag list.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "caption": {
                            "type": "string",
                            "description": "Full new caption as comma-separated tags."
                        }
                    },
                    "required": ["caption"]
                }
            }
        }
    ])
}

fn split_tags(caption: &str) -> Vec<String> {
    caption
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

fn join_tags(tags: &[String]) -> String {
    tags.join(", ")
}

fn parse_position(value: Option<&Value>, tag_count: usize) -> usize {
    let pos = value.and_then(Value::as_i64).unwrap_or(-1);
    if pos < 0 {
        tag_count
    } else {
        (pos as usize).min(tag_count)
    }
}

fn tags_from_arg(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(split_tags)
        .unwrap_or_default()
}

/// Apply a single tool call to `caption`. Returns `(new_caption, error_message)`.
pub fn apply_caption_tool_call(caption: &str, name: &str, arguments: &str) -> (String, Option<String>) {
    let args: Value = match serde_json::from_str(arguments) {
        Ok(v) => v,
        Err(err) => {
            return (
                caption.to_string(),
                Some(format!("invalid tool arguments JSON: {err}")),
            );
        }
    };

    let mut tags = split_tags(caption);

    match name {
        "add_tags" => {
            let to_add = tags_from_arg(args.get("tags"));
            if to_add.is_empty() {
                return (caption.to_string(), Some("add_tags: tags is empty".to_string()));
            }
            let pos = parse_position(args.get("position"), tags.len());
            for (i, tag) in to_add.into_iter().enumerate() {
                tags.insert(pos + i, tag);
            }
        }
        "remove_tags" => {
            let to_remove: Vec<String> = tags_from_arg(args.get("tags"))
                .into_iter()
                .map(|t| t.to_ascii_lowercase())
                .collect();
            if to_remove.is_empty() {
                return (
                    caption.to_string(),
                    Some("remove_tags: tags is empty".to_string()),
                );
            }
            tags.retain(|t| !to_remove.contains(&t.to_ascii_lowercase()));
        }
        "replace_tag" => {
            let old = args
                .get("old_tag")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty());
            let new = args
                .get("new_tag")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty());
            let (Some(old_tag), Some(new_tag)) = (old, new) else {
                return (
                    caption.to_string(),
                    Some("replace_tag: old_tag and new_tag are required".to_string()),
                );
            };
            let old_lower = old_tag.to_ascii_lowercase();
            let mut replaced = false;
            for tag in tags.iter_mut() {
                if tag.to_ascii_lowercase() == old_lower {
                    *tag = new_tag.to_string();
                    replaced = true;
                    break;
                }
            }
            if !replaced {
                return (
                    caption.to_string(),
                    Some(format!("replace_tag: tag '{old_tag}' not found")),
                );
            }
        }
        "set_caption" => {
            let new_caption = args
                .get("caption")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty());
            let Some(text) = new_caption else {
                return (
                    caption.to_string(),
                    Some("set_caption: caption is empty".to_string()),
                );
            };
            return (text.to_string(), None);
        }
        other => {
            return (
                caption.to_string(),
                Some(format!("unknown tool: {other}")),
            );
        }
    }

    (join_tags(&tags), None)
}

/// Extract tool calls from an assistant message payload.
pub fn extract_tool_calls(payload: &Value) -> Vec<(String, String, String)> {
    let Some(calls) = payload
        .pointer("/choices/0/message/tool_calls")
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for call in calls {
        let id = call
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let name = call
            .pointer("/function/name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let args = call
            .pointer("/function/arguments")
            .and_then(Value::as_str)
            .unwrap_or("{}")
            .to_string();
        if !name.is_empty() {
            out.push((id, name, args));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_tags_at_end() {
        let (out, err) = apply_caption_tool_call("1girl, solo", "add_tags", r#"{"tags":"smile"}"#);
        assert!(err.is_none());
        assert_eq!(out, "1girl, solo, smile");
    }

    #[test]
    fn add_tags_at_front() {
        let (out, _) =
            apply_caption_tool_call("1girl, solo", "add_tags", r#"{"tags":"masterpiece","position":0}"#);
        assert_eq!(out, "masterpiece, 1girl, solo");
    }

    #[test]
    fn remove_tags_case_insensitive() {
        let (out, _) = apply_caption_tool_call(
            "1girl, Solo, beach",
            "remove_tags",
            r#"{"tags":"solo, BEACH"}"#,
        );
        assert_eq!(out, "1girl");
    }

    #[test]
    fn replace_tag() {
        let (out, _) = apply_caption_tool_call(
            "1girl, beach, blue_sky",
            "replace_tag",
            r#"{"old_tag":"beach","new_tag":"forest"}"#,
        );
        assert_eq!(out, "1girl, forest, blue_sky");
    }

    #[test]
    fn set_caption() {
        let (out, _) = apply_caption_tool_call("old", "set_caption", r#"{"caption":"a, b, c"}"#);
        assert_eq!(out, "a, b, c");
    }
}
