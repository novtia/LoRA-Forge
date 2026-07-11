/**
 * @file services/mod.rs
 * @description 业务编排层入口：纯 Rust，不依赖 tauri::State / AppHandle，
 *   可被 commands 层和未来测试直接调用。
 */
pub mod caption_service;
pub mod project_service;
