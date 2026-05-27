import { useState, useEffect, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { SessionItem } from "./SessionItem";
import { ProjectConfigModal } from "./ProjectConfigModal";
import { useSession } from "../../store/session";
import { useProject } from "../../store/project";
import type { Project, SessionSummary } from "../../types";
import { openContextMenu } from "../context-menu";
import { toast } from "../ui";

interface SidebarProps {
  onOpenSearch: () => void;
}

export function Sidebar({ onOpenSearch }: SidebarProps) {
  const { t } = useTranslation();
  const sessions = useSession((s) => s.sessions);
  const projects = useProject((s) => s.projects);
  const refreshProjects = useProject((s) => s.refreshList);

  return (
    <aside className="side">
      <div className="side-top">
        <nav className="side-nav">
          <button type="button" className="side-nav-item" onClick={onOpenSearch}>
            <SearchIcon />
            <span>{t("sidebar.search")}</span>
          </button>
          <button type="button" className="side-nav-item" disabled>
            <SkillsIcon />
            <span>{t("sidebar.skills")}</span>
          </button>
          <button type="button" className="side-nav-item" disabled>
            <PluginIcon />
            <span>{t("sidebar.plugins")}</span>
          </button>
          <button type="button" className="side-nav-item" disabled>
            <ClockIcon />
            <span>{t("sidebar.automations")}</span>
          </button>
        </nav>

        <div className="side-section">
          <div className="side-section-scroll">
            <div className="side-project-section">
              <div className="side-section-header side-section-header--sticky">
                <span className="side-section-title-text">{t("sidebar.project")}</span>
                <button
                  type="button"
                  className="side-icon-btn"
                  title="刷新训练项目"
                  onClick={() => {
                    refreshProjects().catch(console.warn);
                  }}
                >
                  <RefreshIcon />
                </button>
              </div>

              {projects.length === 0 ? (
                <div className="side-empty side-empty--hint">
                  暂无训练项目。请先在主窗口创建 LoRA 训练项目，然后点击刷新。
                </div>
              ) : (
                projects.map((project) => (
                  <ProjectItem
                    key={project.id}
                    project={project}
                    sessions={sessions.filter((s) => s.project_id === project.id)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

const PROJECT_EXPANDED_KEY = "atelier.sidebar.projectExpanded";

function readProjectExpandedMap(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(PROJECT_EXPANDED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeProjectExpanded(projectId: string, expanded: boolean) {
  const next = { ...readProjectExpandedMap(), [projectId]: expanded };
  window.localStorage.setItem(PROJECT_EXPANDED_KEY, JSON.stringify(next));
}

interface ProjectItemProps {
  project: Project;
  sessions: SessionSummary[];
}

function ProjectItem({ project, sessions }: ProjectItemProps) {
  const { t } = useTranslation();
  const exportProjects = useProject((s) => s.exportProjects);
  const createNew = useSession((s) => s.createNew);
  const activeId = useSession((s) => s.activeId);
  const [configOpen, setConfigOpen] = useState(false);
  const [expanded, setExpanded] = useState(
    () => readProjectExpandedMap()[project.id] ?? true,
  );

  useEffect(() => {
    if (!sessions.some((s) => s.id === activeId)) return;
    setExpanded(true);
    writeProjectExpanded(project.id, true);
  }, [activeId, project.id, sessions]);

  const toggleExpanded = () => {
    setExpanded((current) => {
      const next = !current;
      writeProjectExpanded(project.id, next);
      return next;
    });
  };

  const handleNewSession = async (e: ReactMouseEvent) => {
    e.stopPropagation();
    try {
      await createNew(project.id);
      setExpanded(true);
      writeProjectExpanded(project.id, true);
    } catch (err) {
      toast.error("无法创建会话", { description: String(err) });
    }
  };

  const handleExportProject = async () => {
    const destPath = await saveDialog({
      title: "导出项目归档",
      defaultPath: `${project.name}.atelier`,
      filters: [{ name: "Atelier 归档", extensions: ["atelier"] }],
    });
    if (!destPath) return;
    try {
      await exportProjects([project.id], destPath as string);
      toast.success("导出成功", { description: destPath as string });
    } catch (err) {
      toast.error("导出失败", { description: String(err) });
    }
  };

  const openProjectMenu = (e: ReactMouseEvent) => {
    e.stopPropagation();
    openContextMenu(e, [
      {
        id: "project-settings",
        label: "项目设置",
        onSelect: () => setConfigOpen(true),
      },
      {
        id: "project-export",
        label: "导出项目",
        onSelect: handleExportProject,
      },
    ]);
  };

  return (
    <>
      <div className="project-item">
        <div
          className="project-item-header"
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-label={expanded ? t("sidebar.collapseProject") : t("sidebar.expandProject")}
          title={expanded ? t("sidebar.collapseProject") : t("sidebar.expandProject")}
          onClick={toggleExpanded}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleExpanded();
            }
          }}
          onContextMenu={openProjectMenu}
        >
          <span className="project-item-folder-icon">
            <FolderIcon />
          </span>
          <span className="project-item-name" title={project.name}>
            {project.name}
          </span>
          <div className="project-item-trailing">
            {!expanded && sessions.length > 0 && (
              <span className="project-item-count">{sessions.length}</span>
            )}
            <div className="project-item-actions">
              <button
                type="button"
                className="side-icon-btn"
                title="在此项目中新建会话"
                onClick={handleNewSession}
              >
                <NewChatIcon />
              </button>
              <button
                type="button"
                className="side-icon-btn"
                title="项目选项"
                onClick={openProjectMenu}
              >
                <DotsIcon />
              </button>
            </div>
          </div>
        </div>

        <div
          className={`project-sessions-wrap${expanded ? " is-expanded" : ""}`}
          aria-hidden={!expanded}
        >
          <div className="project-sessions-inner">
            <div className="project-sessions">
              {sessions.length === 0 ? (
                <div className="project-sessions-empty">{t("sidebar.noProjectSessions")}</div>
              ) : (
                sessions.map((s) => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    isActive={activeId === s.id}
                    className="chat-item--nested"
                    projectId={project.id}
                    onOpenProjectConfig={() => setConfigOpen(true)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
      {configOpen && (
        <ProjectConfigModal project={project} onClose={() => setConfigOpen(false)} />
      )}
    </>
  );
}

function NewChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
function SkillsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 3 7l9 5 9-5-9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </svg>
  );
}
function PluginIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}
function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}
function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="19" r="1" fill="currentColor" />
    </svg>
  );
}
