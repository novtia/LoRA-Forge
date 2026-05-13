mod commands;
mod db;
mod error;
mod hardware;
mod llm;
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
            commands::dataset::list_dataset_entries,
            commands::dataset::list_sample_images,
            commands::dataset::get_dataset_asset,
            commands::dataset::get_dataset_preview_assets,
            commands::dataset::read_caption,
            commands::dataset::write_caption,
            commands::dataset::delete_dataset_image,
            commands::dataset::auto_tag_image,
            commands::dataset::interrogate_image,
            commands::training::start_training,
            commands::training::pause_training,
            commands::training::resume_training,
            commands::training::abort_training,
            commands::training::export_checkpoint,
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
