/**
 * @file infra/mod.rs
 * @description 基础设施层入口：路径、硬件检测、进程工具、应用状态、DB 仓储。
 */
pub mod db;
pub mod environment;
pub mod hardware;
pub mod paths;
pub mod process;
pub mod state;
