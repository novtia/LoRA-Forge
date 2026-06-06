/**
 * @file db.rs
 * @description Phase 3 兼容薄壳：DB 逻辑已拆到 `infra::db` 及各 repos，此处 re-export 保持
 *   旧调用点不变；后续阶段会把调用点逐步切到 `crate::infra::db::*`。
 */

#[allow(unused_imports)]
pub use crate::infra::db::{initialize_database, recover_unfinished_jobs};

#[allow(unused_imports)]
pub use crate::infra::db::repos::{
    baidu::{load_baidu_translate_settings, save_baidu_translate_settings},
    dataset_groups::{
        load_dataset_group_types, remove_dataset_group_configs, rename_dataset_group_config,
        save_dataset_group_type,
    },
    jobs::{append_log, append_snapshot, create_job, get_active_job, update_job_status},
    llm::{
        mark_model_text_only_in_global,
        resolve_effective_llm_settings_from_db as load_llm_settings,
        save_llm_settings,
    },
    projects::{
        delete_project, get_project, insert_project, list_projects, update_project_record,
        update_project_status, update_project_tags,
    },
    training::{
        load_diffusion_pipe_config, load_training_config, load_training_env,
        save_diffusion_pipe_config, save_training_config, save_training_env,
    },
    training_repos::{delete_custom_repo, insert_custom_repo, list_custom_repos},
};
