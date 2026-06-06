/**
 * @file state.rs
 * @description Phase 1 重构期间的兼容薄壳：将 `AppState` 等类型从 `infra::state` 重导出，
 * 保持旧 `use crate::state::*` 调用点继续可用。后续阶段会逐步把调用点切到 `crate::infra::state::*`。
 */

#[allow(unused_imports)]
pub use crate::infra::{
    paths::AppPaths,
    state::{AppState, RepoTask, RuntimeJob, RuntimeJobControlMode},
};
