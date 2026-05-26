/**
 * @file app/mod.rs
 * @description Tauri 入口装配：构建 Builder、注册 AppState、挂载 plugin、生成 invoke_handler。
 *   lib.rs 只调 `app::run()`，所有装配细节都在这里。
 */

use tauri::Manager;

use crate::{infra::state::AppState, trainer};

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let state = AppState::initialize(app.handle())?;
            trainer::start_system_stats_publisher(app.handle().clone(), state.clone());
            app.manage(state);
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            crate::commands::projects::list_projects,
            crate::commands::projects::get_project,
            crate::commands::projects::create_project,
            crate::commands::settings::load_training_config,
            crate::commands::settings::save_training_config,
            crate::commands::settings::load_training_env,
            crate::commands::settings::save_training_env,
            crate::commands::settings::load_llm_settings,
            crate::commands::settings::save_llm_settings,
            crate::commands::llm::provider::list_llm_providers,
            crate::commands::llm::provider::get_llm_provider,
            crate::commands::llm::provider::create_llm_provider,
            crate::commands::llm::provider::update_llm_provider,
            crate::commands::llm::provider::delete_llm_provider,
            crate::commands::llm::provider::add_llm_provider_model,
            crate::commands::llm::provider::update_llm_provider_model,
            crate::commands::llm::provider::delete_llm_provider_model,
            crate::commands::llm::provider::fetch_llm_provider_models,
            crate::commands::llm::provider::set_active_llm_selection,
            crate::commands::settings::load_baidu_translate_settings,
            crate::commands::settings::save_baidu_translate_settings,
            crate::commands::settings::baidu_translate,
            crate::commands::api_log::get_recent_api_logs,
            crate::commands::api_log::clear_api_logs,
            crate::commands::dataset::browse::list_dataset_entries,
            crate::commands::dataset::browse::list_sample_images,
            crate::commands::dataset::browse::get_dataset_asset,
            crate::commands::dataset::browse::get_dataset_preview_assets,
            crate::commands::dataset::caption::read_caption,
            crate::commands::dataset::caption::write_caption,
            crate::commands::dataset::caption::delete_dataset_image,
            crate::commands::dataset::caption::cancel_llm_caption,
            crate::commands::dataset::caption::auto_tag_image,
            crate::commands::dataset::caption::list_untagged_image_paths,
            crate::commands::dataset::group::group_dataset_images,
            crate::commands::dataset::group::move_dataset_images,
            crate::commands::dataset::group::rename_dataset_group,
            crate::commands::dataset::group::remove_dataset_group,
            crate::commands::dataset::group::set_dataset_group_type,
            crate::commands::dataset::batch::batch_convert_dataset_extensions,
            crate::commands::dataset::batch::batch_rename_dataset_images,
            crate::commands::training::start_training,
            crate::commands::training::start_training_from_latest_weights,
            crate::commands::training::get_latest_output_checkpoint,
            crate::commands::training::pause_training,
            crate::commands::training::resume_training,
            crate::commands::training::abort_training,
            crate::commands::training::export_checkpoint,
            crate::commands::training::load_diffusion_pipe_config,
            crate::commands::training::save_diffusion_pipe_config,
            crate::commands::training::start_diffusion_pipe_training,

            crate::commands::system::get_system_stats,
            crate::commands::system::get_active_job,
            crate::commands::settings::read_text_file,
            crate::commands::settings::write_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
