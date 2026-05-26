/**
 * @file llm_provider_db.rs
 * @description Phase 3 兼容薄壳：LLM 供应商 DB 操作已合并到 `infra::db::repos::llm`，此处 re-export。
 */

#[allow(unused_imports)]
pub use crate::infra::db::repos::llm::{
    add_llm_provider_model, create_llm_provider, delete_llm_provider, delete_llm_provider_model,
    ensure_llm_provider_schema, get_llm_provider, list_llm_providers, load_llm_global_settings,
    mark_model_text_only_in_global, migrate_llm_providers_if_needed,
    resolve_effective_llm_settings_from_db, save_llm_global_settings, save_llm_provider_full,
    save_llm_settings, set_active_llm_selection, update_llm_provider, update_llm_provider_model,
};
