/**
 * @file lib.rs
 * @description 入口层：mod 声明 + pub fn run()（委托给 app::run()）+ mock trainer 入口。
 *   所有 Tauri Builder 装配都在 app/mod.rs。
 */

mod app;
mod commands;
mod db;
mod domain;
mod error;
mod hardware;
mod infra;
mod llm;
mod llm_provider_db;
mod models;
mod services;
mod state;
mod trainer;
mod utils;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    app::run();
}

pub fn run_mock_trainer_from_env() -> bool {
    trainer::run_mock_trainer_from_env()
}
