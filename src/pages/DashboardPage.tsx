import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Zap,
  Cpu,
  Database,
  HardDrive,
  Activity,
  PlusSquare,
  ArrowRight,
  FolderOpen,
  Archive,
  Image,
  Settings2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  X,
} from "lucide-react";
import {
  createProject,
  getActiveJob,
  getSystemStats,
  listProjects,
  onSystemStats,
  onTrainingLog,
  onTrainingProgress,
  onTrainingState,
} from "../lib/desktopApi";
import {
  formatBytes,
  projectAccent,
} from "../lib/formatters";
import { useI18n } from "../lib/i18n";
import { appendTrainingLog, normalizeActiveJobLogs } from "../lib/trainingLogs";
import { TrainingConsoleLine } from "../components/project/TrainingConsolePanel";
import type { ActiveJobSummary, ProjectRecord, SystemStats } from "../lib/types";

const VISIBLE_COUNT = 2;

function statusIcon(status: ProjectRecord["status"]) {
  if (status === "error" || status === "aborted") {
    return <XCircle size={14} />;
  }
  if (status === "paused" || status === "interrupted") {
    return <AlertTriangle size={14} />;
  }
  return <CheckCircle size={14} />;
}

function statusColor(status: ProjectRecord["status"]) {
  return status === "error" || status === "aborted"
    ? "var(--accent-orange)"
    : status === "paused" || status === "interrupted"
      ? "var(--text-main)"
      : "var(--accent-acid)";
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { t, formatClock, formatRelativeTime: formatRelative, statusLabel } = useI18n();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [activeJob, setActiveJob] = useState<ActiveJobSummary | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshProjects = useCallback(async () => {
    setProjects(await listProjects());
  }, []);

  const refreshActiveJob = useCallback(async () => {
    setActiveJob(normalizeActiveJobLogs(await getActiveJob()));
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [projectData, stats, job] = await Promise.all([
          listProjects(),
          getSystemStats(),
          getActiveJob(),
        ]);
        if (!mounted) return;
        setProjects(projectData);
        setSystemStats(stats);
        setActiveJob(normalizeActiveJobLogs(job));
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : t("errors.loadDashboard"));
        }
      }
    };

    void load();

    let unlistenStats: (() => void) | undefined;
    let unlistenProgress: (() => void) | undefined;
    let unlistenState: (() => void) | undefined;
    let unlistenLog: (() => void) | undefined;

    void onSystemStats((stats) => setSystemStats(stats)).then((fn) => {
      unlistenStats = fn;
    });
    void onTrainingProgress((event) => {
      setActiveJob((current) => {
        if (!current || current.jobId !== event.jobId) return current;
        return {
          ...current,
          status: event.snapshot.status,
          pid: event.snapshot.pid,
          runtimeSeconds: event.snapshot.runtimeSeconds,
          epoch: event.snapshot.epoch,
          epochTotal: event.snapshot.epochTotal,
          step: event.snapshot.step,
          stepTotal: event.snapshot.stepTotal,
          loss: event.snapshot.loss,
          lr: event.snapshot.lr,
          history: [
            ...current.history.slice(-59),
            { step: event.snapshot.step, loss: event.snapshot.loss },
          ],
        };
      });
    }).then((fn) => {
      unlistenProgress = fn;
    });
    void onTrainingLog((event) => {
      setActiveJob((current) => {
        if (!current || current.jobId !== event.jobId) return current;
        return {
          ...current,
          recentLogs: appendTrainingLog(current.recentLogs, event.entry, 40),
        };
      });
    }).then((fn) => {
      unlistenLog = fn;
    });
    void onTrainingState((event) => {
      setActiveJob((current) =>
        current && current.jobId === event.jobId ? { ...current, status: event.status } : current,
      );
      void refreshProjects();
      void refreshActiveJob();
    }).then((fn) => {
      unlistenState = fn;
    });

    return () => {
      mounted = false;
      unlistenStats?.();
      unlistenProgress?.();
      unlistenState?.();
      unlistenLog?.();
    };
  }, [refreshActiveJob, refreshProjects]);

  const handleSelectPath = async () => {
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: t("dashboard.selectProjectLocation"),
      });
      if (selectedPath) {
        setProjectPath(selectedPath as string);
      }
    } catch (dialogError) {
      setError(dialogError instanceof Error ? dialogError.message : t("errors.openDialog"));
    }
  };

  const handleCreateProject = async () => {
    if (!projectName.trim() || !projectPath.trim()) return;

    setCreating(true);
    setError(null);
    try {
      const project = await createProject(projectName.trim(), projectPath.trim());
      setIsModalOpen(false);
      setProjectName("");
      setProjectPath("");
      await refreshProjects();
      navigate(`/project/${project.id}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t("errors.createProject"));
    } finally {
      setCreating(false);
    }
  };

  const datasetTarget = useMemo(
    () => activeJob?.projectId ?? projects[0]?.id ?? null,
    [activeJob?.projectId, projects],
  );

  const stats = systemStats ?? {
    cpuPercent: 0,
    memoryUsedGb: 0,
    memoryTotalGb: 1,
    gpuName: t("dashboard.localDevice"),
    gpuTempC: 0,
    gpuUtilPercent: 0,
    vramUsedGb: 0,
    vramTotalGb: 24,
  };

  return (
    <div className="container page-dashboard page-dashboard-home">
      <div className="bento">
        <div className="card sys-col">
          <div className="card-header">
            <span className="card-title-icon">
              <Cpu size={16} /> {t("dashboard.gpuCore")}
            </span>
            <span style={{ color: "var(--accent-acid)" }}>{stats.gpuName}</span>
          </div>
          <div className="metric-value">
            {Math.round(stats.gpuTempC)}
            <span className="metric-unit">°C</span>
          </div>
          <div className="metric-label">{t("dashboard.tempUtilization")}</div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${stats.gpuUtilPercent}%` }} />
          </div>
        </div>

        <div className="card card-orange sys-col">
          <div className="card-header">
            <span className="card-title-icon">
              <Database size={16} /> {t("dashboard.vramUsage")}
            </span>
            <span>{stats.vramTotalGb.toFixed(0)} GB MAX</span>
          </div>
          <div className="metric-value">
            {stats.vramUsedGb.toFixed(1)}
            <span className="metric-unit">GB</span>
          </div>
          <div className="metric-label">{t("dashboard.allocatedMemory")}</div>
          <div className="progress-track">
            <div
              className="progress-fill fill-orange"
              style={{ width: `${(stats.vramUsedGb / Math.max(stats.vramTotalGb, 1)) * 100}%` }}
            />
          </div>
        </div>

        <div className="card card-white sys-col">
          <div className="card-header">
            <span className="card-title-icon">
              <HardDrive size={16} /> {t("dashboard.sysRam")}
            </span>
            <span>{stats.memoryTotalGb.toFixed(1)} GB MAX</span>
          </div>
          <div className="metric-value">
            {stats.memoryUsedGb.toFixed(1)}
            <span className="metric-unit">GB</span>
          </div>
          <div className="metric-label">{t("dashboard.systemMemory")}</div>
          <div className="progress-track">
            <div
              className="progress-fill fill-white"
              style={{ width: `${(stats.memoryUsedGb / Math.max(stats.memoryTotalGb, 1)) * 100}%` }}
            />
          </div>
        </div>

        <div className="card sys-col">
          <div className="card-header">
            <span className="card-title-icon">
              <Activity size={16} /> {t("dashboard.systemLoad")}
            </span>
            <span style={{ color: "var(--accent-acid)" }}>
              {stats.cpuPercent > 85 ? t("dashboard.hot") : t("dashboard.local")}
            </span>
          </div>
          <div className="metric-value">
            {Math.round(stats.cpuPercent)}
            <span className="metric-unit">%</span>
          </div>
          <div className="metric-label">{t("dashboard.cpuUtilization")}</div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${stats.cpuPercent}%` }} />
          </div>
        </div>

        <div className="section-title">
          <Zap size={20} /> {t("dashboard.activeWorkspace")}
        </div>

        <div className="card active-training card-orange" style={{ padding: "1.5rem" }}>
          {activeJob ? (
            <>
              <div>
                <div className="active-training-header">
                  <div className="status-badge status-badge-orange">
                    <div className="status-dot" /> {statusLabel(activeJob.status)}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-muted)",
                      fontSize: "0.85rem",
                    }}
                  >
                    {t("dashboard.pid")}: {activeJob.pid ?? "N/A"}
                  </div>
                </div>
                <div className="project-name-hero">{activeJob.checkpointName}</div>
                <div className="project-meta">
                  <div className="meta-item">
                    <span className="meta-label">{t("dashboard.epoch")}</span>
                    <span className="meta-val" style={{ fontSize: "1.25rem", fontWeight: 700 }}>
                      {activeJob.epoch} / {activeJob.epochTotal}
                    </span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">{t("dashboard.steps")}</span>
                    <span
                      className="meta-val"
                      style={{
                        fontSize: "1.25rem",
                        fontWeight: 700,
                        color: "var(--accent-orange)",
                      }}
                    >
                      {activeJob.step.toLocaleString()} / {activeJob.stepTotal.toLocaleString()}
                    </span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">{t("dashboard.loss")}</span>
                    <span className="meta-val" style={{ fontSize: "1.25rem", fontWeight: 700 }}>
                      {activeJob.loss.toFixed(4)}
                    </span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">{t("dashboard.learningRate")}</span>
                    <span className="meta-val" style={{ fontSize: "1.25rem", fontWeight: 700 }}>
                      {activeJob.lr.toExponential(2)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="terminal-block">
                {activeJob.recentLogs.slice(-4).map((log) => (
                  <TrainingConsoleLine
                    key={`${log.seq}-${log.createdAt}`}
                    log={log}
                    formatClock={formatClock}
                    compact
                  />
                ))}
              </div>
            </>
          ) : (
            <div style={{ display: "grid", gap: "1rem" }}>
              <div className="status-badge status-badge-orange">
                <div className="status-dot" /> {t("dashboard.idle")}
              </div>
              <div className="project-name-hero">{t("dashboard.noTrainer")}</div>
              <div className="terminal-block">
                <div className="terminal-line">{t("dashboard.idleHint")}</div>
              </div>
            </div>
          )}
        </div>

        <div className="quick-actions">
          <button className="action-btn primary" onClick={() => setIsModalOpen(true)}>
            <span style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <PlusSquare size={20} /> {t("dashboard.newProject")}
            </span>
            <ArrowRight size={20} />
          </button>
          {datasetTarget ? (
            <Link to={`/project/${datasetTarget}?view=dataset`} className="action-btn">
              <span style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <FolderOpen size={20} /> {t("dashboard.datasetManager")}
              </span>
              <ArrowRight size={20} />
            </Link>
          ) : (
            <button className="action-btn" disabled style={{ opacity: 0.5, cursor: "not-allowed" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <FolderOpen size={20} /> {t("dashboard.datasetManager")}
              </span>
              <ArrowRight size={20} />
            </button>
          )}
          <Link to="/design" state={{ from: "/" }} className="action-btn">
            <span style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <Settings2 size={20} /> {t("dashboard.designLab")}
            </span>
            <ArrowRight size={20} />
          </Link>
          <div className="stat-card">
            <div className="stat-val">
              {projects.filter((project) => project.status === "completed" || project.status === "ready").length}
            </div>
            <div className="stat-lbl">{t("dashboard.completedModels")}</div>
          </div>
        </div>

        <div className="section-title">
          <Archive size={20} /> {t("dashboard.recentForges")}
        </div>

        {projects.slice(0, VISIBLE_COUNT).map((project, index) => (
          <Link key={project.id} to={`/project/${project.id}`} className="project-card-link">
            <div className={`card project-card ${projectAccent(project, index)}`}>
              <div className="card-header">
                <span>{t("dashboard.loraModel")}</span>
                <span>{formatRelative(project.updatedAt)}</span>
              </div>
              <div className="proj-img-placeholder">
                {project.status === "error" || project.status === "aborted" ? (
                  <AlertTriangle size={40} style={{ color: "var(--accent-orange)" }} />
                ) : (
                  <Image size={40} />
                )}
              </div>
              <div className="proj-title">{project.name}</div>
              <div className="proj-tags">
                {project.tags.map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="proj-footer">
                <span>{t("common.size")}: {formatBytes(project.sizeBytes)}</span>
                <span
                  style={{
                    color: statusColor(project.status),
                    display: "flex",
                    alignItems: "center",
                    gap: "0.25rem",
                  }}
                >
                  {statusIcon(project.status)} {statusLabel(project.status)}
                </span>
              </div>
            </div>
          </Link>
        ))}

        {projects.length === 0 ? (
          <div className="card" style={{ gridColumn: "span 12" }}>
            <div className="card-header">
              <span className="card-title-icon">
                <Archive size={18} /> {t("dashboard.localLibrary")}
              </span>
            </div>
            <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              {t("dashboard.noProjects")} {t("dashboard.noProjectsHint")}
            </div>
          </div>
        ) : null}

        {projects.length > VISIBLE_COUNT ? (
          <Link to="/projects" className="project-card-link">
            <div className="card project-card card-more">
              <div className="card-more-inner">
                <div className="card-more-count">+{projects.length - VISIBLE_COUNT}</div>
                <div className="card-more-label">{t("dashboard.moreProjects")}</div>
                <ArrowRight size={18} className="card-more-arrow" />
              </div>
            </div>
          </Link>
        ) : null}
      </div>

      {error ? (
        <div
          style={{
            marginTop: "1rem",
            color: "var(--accent-orange)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {error}
        </div>
      ) : null}

      {isModalOpen ? (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <div className="modal-title">
                <PlusSquare size={24} style={{ color: "var(--accent-acid)" }} />
                {t("dashboard.createProject")}
              </div>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}>
                <X size={24} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">{t("dashboard.projectName")}</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder={t("dashboard.projectNamePlaceholder")}
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">{t("dashboard.projectLocation")}</label>
                <div className="input-with-button">
                  <input
                    type="text"
                    className="form-input"
                    placeholder={t("dashboard.selectFolderPlaceholder")}
                    value={projectPath}
                    readOnly
                  />
                  <button className="btn" onClick={handleSelectPath}>
                    <FolderOpen size={16} /> {t("dashboard.browse")}
                  </button>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setIsModalOpen(false)}>
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void handleCreateProject()}
                disabled={creating || !projectName.trim() || !projectPath.trim()}
                style={{
                  opacity: creating || !projectName.trim() || !projectPath.trim() ? 0.5 : 1,
                  cursor: creating || !projectName.trim() || !projectPath.trim() ? "not-allowed" : "pointer",
                }}
              >
                {creating ? t("dashboard.creating") : t("dashboard.createForge")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
