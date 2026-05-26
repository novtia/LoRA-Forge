mod commands;
mod db;
mod error;
mod hardware;
mod llm;
mod llm_provider_db;
mod models;
mod state;
mod trainer;
mod utils;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
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
            commands::projects::list_projects,
            commands::projects::get_project,
            commands::projects::create_project,
            commands::config::load_training_config,
            commands::config::save_training_config,
            commands::config::load_training_env,
            commands::config::save_training_env,
            commands::config::load_llm_settings,
            commands::config::save_llm_settings,
            commands::llm_provider::list_llm_providers,
            commands::llm_provider::get_llm_provider,
            commands::llm_provider::create_llm_provider,
            commands::llm_provider::update_llm_provider,
            commands::llm_provider::delete_llm_provider,
            commands::llm_provider::add_llm_provider_model,
            commands::llm_provider::update_llm_provider_model,
            commands::llm_provider::delete_llm_provider_model,
            commands::llm_provider::fetch_llm_provider_models,
            commands::llm_provider::set_active_llm_selection,
            commands::baidu_translate::load_baidu_translate_settings,
            commands::baidu_translate::save_baidu_translate_settings,
            commands::baidu_translate::baidu_translate,
            commands::api_log::get_recent_api_logs,
            commands::api_log::clear_api_logs,
            commands::dataset::list_dataset_entries,
            commands::dataset::list_sample_images,
            commands::dataset::get_dataset_asset,
            commands::dataset::get_dataset_preview_assets,
            commands::dataset::read_caption,
            commands::dataset::write_caption,
            commands::dataset::delete_dataset_image,
            commands::dataset::cancel_llm_caption,
            commands::dataset::auto_tag_image,
            commands::dataset::group_dataset_images,
            commands::dataset::move_dataset_images,
            commands::dataset::rename_dataset_group,
            commands::dataset::remove_dataset_group,
            commands::dataset::set_dataset_group_type,
            commands::dataset::batch_convert_dataset_extensions,
            commands::dataset::batch_rename_dataset_images,
            commands::dataset::list_untagged_image_paths,
            commands::training::start_training,
            commands::training::start_training_from_latest_weights,
            commands::training::get_latest_output_checkpoint,
            commands::training::pause_training,
            commands::training::resume_training,
            commands::training::abort_training,
            commands::training::export_checkpoint,
            commands::training::load_diffusion_pipe_config,
            commands::training::save_diffusion_pipe_config,
            commands::training::start_diffusion_pipe_training,
            commands::system::get_system_stats,
            commands::system::get_active_job,
            commands::config::read_text_file,
            commands::config::write_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub fn run_mock_trainer_from_env() -> bool {
    trainer::run_mock_trainer_from_env()
}
