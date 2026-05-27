from pathlib import Path

SRC = Path(r"d:\anima\MoyanAgent\src-tauri\src\app\mod.rs")
DST = Path(r"d:\anima\project3\frontend\src-tauri\src\agent_app\mod.rs")

text = SRC.read_text(encoding="utf-8")
text = text.replace("crate::error", "crate::agent_error")
text = text.replace("pub struct AppState", "pub struct AgentAppState")
text = text.replace("impl AppState", "impl AgentAppState")

# Rename remaining AppState references, but avoid touching AgentAppState twice.
text = text.replace("AgentAppState", "___TMP___")
text = text.replace("AppState", "AgentAppState")
text = text.replace("___TMP___", "AgentAppState")

run_marker = "// ─── Run ─"
init_fn = '''// ─── Initialize ──────────────────────────────────────────────────────────────

/**
 * @description Initialize MoyanAgent subsystem (separate DB, sessions, agent runtime).
 */
pub fn initialize(app: &AppHandle) -> AppResult<Arc<AgentAppState>> {
    let db_path = paths::db_path(app)?;
    let pool = db::open_pool(&db_path)?;

    let registry = Arc::new(AgentRegistry::with_builtins());
    let task_store = Arc::new(TaskStore::new());
    let mcp = Arc::new(StaticMcpRegistry::new());
    let provider_engine = Arc::new(ProviderEngine::new());
    let user_context = Arc::new(FsUserContextLoader::new(UserContextConfig::from_env()));

    let tools: Arc<ToolPool> = Arc::new(ToolPool::new());
    tools.register(FileReadTool::new());
    tools.register(crate::ai::agent::tools::edit::FileWriteTool::new());
    tools.register(crate::ai::agent::tools::edit::FileEditTool::new());
    tools.register(crate::ai::agent::tools::bash::BashTool::new());
    tools.register(crate::ai::agent::tools::todo::TodoListTool::new());

    let chat_factory: Arc<dyn ChatRequestFactory> =
        Arc::new(SettingsChatFactory::new(pool.clone(), user_context.clone()));
    let permission_resolver: Arc<dyn agent::PermissionResolver> = Arc::new(
        crate::ai::agent::core::permission::PlanModeResolver::new(agent::AllowAllResolver),
    );
    let query_engine: Arc<dyn agent::QueryEngine> = Arc::new(
        ProviderQueryEngine::new(provider_engine.clone(), permission_resolver),
    );
    let agent_tool = AgentTool::new(
        registry.clone(),
        tools.clone(),
        task_store.clone(),
        query_engine.clone(),
        mcp.clone(),
    )
    .with_chat_factory(chat_factory);
    tools.register(agent_tool);

    Ok(Arc::new(AgentAppState {
        pool,
        generation_abort: Mutex::new(HashMap::new()),
        agent_registry: registry,
        task_store,
        notifications: Arc::new(NotificationQueue::new()),
        engine: provider_engine,
        query_engine,
        user_context,
        mcp,
        tools,
        session_memory: Arc::new(FsSessionMemoryExtractor::new()),
    }))
}
'''

if "pub fn run()" in text:
    start = text.index("pub fn run()")
    # back up to preceding comment block if present
    line_start = text.rfind("\n", 0, start) + 1
    comment_start = text.rfind("\n//", 0, start)
    if comment_start != -1 and comment_start >= line_start - 80:
        start = comment_start + 1
    text = text[:start] + init_fn
else:
    raise SystemExit("run() marker not found")

text = text.replace("#[tauri::command]\nfn ", "#[tauri::command]\npub fn ")
DST.parent.mkdir(parents=True, exist_ok=True)
DST.write_text(text, encoding="utf-8")
print("agent_app prepared")
