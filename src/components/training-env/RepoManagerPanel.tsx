import { useCallback, useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  Boxes,
  Download,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  addCustomRepo,
  cancelRepoTask,
  deleteRepo,
  downloadRepo,
  listTrainingRepos,
  onRepoTaskLog,
  onRepoTaskState,
  removeCustomRepo,
  updateRepo,
} from "../../lib/desktopApi";
import type { TranslateFn } from "../../lib/i18n";
import type {
  CustomRepoInput,
  RepoTaskKind,
  RepoTaskStatus,
  TrainingRepoStatus,
} from "../../lib/types";
import { AddCustomRepoModal } from "./AddCustomRepoModal";

interface RepoTaskUiState {
  taskId: string;
  kind: RepoTaskKind;
  status: RepoTaskStatus;
  logs: string[];
}

interface RepoManagerPanelProps {
  t: TranslateFn;
  onError: (message: string | null) => void;
}

const MAX_LOG_LINES = 200;

export function RepoManagerPanel({ t, onError }: RepoManagerPanelProps) {
  const [repos, setRepos] = useState<TrainingRepoStatus[]>([]);
  const [tasks, setTasks] = useState<Record<string, RepoTaskUiState>>({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [savingCustom, setSavingCustom] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRepos(await listTrainingRepos());
    } catch (error) {
      onError(error instanceof Error ? error.message : t("errors.loadRepos"));
    }
  }, [onError, t]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void refresh().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    let unlog: (() => void) | undefined;
    let unstate: (() => void) | undefined;

    void onRepoTaskLog((event) => {
      setTasks((current) => {
        const existing = current[event.repoId];
        if (!existing || existing.taskId !== event.taskId) return current;
        return {
          ...current,
          [event.repoId]: {
            ...existing,
            logs: [...existing.logs.slice(-(MAX_LOG_LINES - 1)), event.line],
          },
        };
      });
    }).then((fn) => {
      unlog = fn;
    });

    void onRepoTaskState((event) => {
      setTasks((current) => {
        const existing = current[event.repoId];
        const keepLogs = existing && existing.taskId === event.taskId ? existing.logs : [];
        return {
          ...current,
          [event.repoId]: {
            taskId: event.taskId,
            kind: event.kind,
            status: event.status,
            logs: keepLogs,
          },
        };
      });
      if (event.status === "completed" || event.status === "failed") {
        void refresh();
      }
    }).then((fn) => {
      unstate = fn;
    });

    return () => {
      unlog?.();
      unstate?.();
    };
  }, [refresh]);

  const handleDownload = async (repo: TrainingRepoStatus) => {
    onError(null);
    try {
      const taskId = await downloadRepo(repo.id);
      setTasks((current) => ({
        ...current,
        [repo.id]: { taskId, kind: "download", status: "running", logs: [] },
      }));
    } catch (error) {
      onError(error instanceof Error ? error.message : t("errors.repoTask"));
    }
  };

  const handleUpdate = async (repo: TrainingRepoStatus) => {
    onError(null);
    try {
      const taskId = await updateRepo(repo.id);
      setTasks((current) => ({
        ...current,
        [repo.id]: { taskId, kind: "update", status: "running", logs: [] },
      }));
    } catch (error) {
      onError(error instanceof Error ? error.message : t("errors.repoTask"));
    }
  };

  const handleDelete = async (repo: TrainingRepoStatus) => {
    const confirmed = await ask(t("env.confirmDelete", { name: repo.name }), {
      title: t("env.delete"),
      kind: "warning",
    });
    if (!confirmed) return;
    onError(null);
    setTasks((current) => ({
      ...current,
      [repo.id]: { taskId: "", kind: "delete", status: "running", logs: [] },
    }));
    try {
      await deleteRepo(repo.id);
      setTasks((current) => {
        const next = { ...current };
        delete next[repo.id];
        return next;
      });
      await refresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : t("errors.repoTask"));
      setTasks((current) => ({
        ...current,
        [repo.id]: { taskId: "", kind: "delete", status: "failed", logs: [] },
      }));
    }
  };

  const handleCancel = async (repo: TrainingRepoStatus) => {
    const task = tasks[repo.id];
    if (task?.taskId) {
      try {
        await cancelRepoTask(task.taskId);
      } catch (error) {
        onError(error instanceof Error ? error.message : t("errors.repoTask"));
      }
    }
  };

  const handleRemoveCustom = async (repo: TrainingRepoStatus) => {
    const confirmed = await ask(t("env.confirmRemove", { name: repo.name }), {
      title: t("env.remove"),
      kind: "warning",
    });
    if (!confirmed) return;
    onError(null);
    try {
      setRepos(await removeCustomRepo(repo.id));
    } catch (error) {
      onError(error instanceof Error ? error.message : t("errors.repoTask"));
    }
  };

  const handleAddCustom = async (input: CustomRepoInput) => {
    setSavingCustom(true);
    onError(null);
    try {
      setRepos(await addCustomRepo(input));
      setShowAdd(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : t("errors.repoTask"));
    } finally {
      setSavingCustom(false);
    }
  };

  return (
    <section className="card repo-manager fade-in-section" style={{ gridColumn: "span 12", animationDelay: "0.1s" }}>
      <div className="card-header">
        <span className="card-title-icon">
          <Boxes size={18} /> {t("env.repos")}
        </span>
        <button type="button" className="btn" onClick={() => setShowAdd(true)}>
          <Plus size={16} /> {t("env.addCustom")}
        </button>
      </div>

      <p className="repo-manager-desc">{t("env.reposDesc")}</p>

      <div className="repo-list">
        {loading ? (
          <div className="repo-list-empty">
            <Loader2 size={16} className="lf-icon-spin" /> {t("common.working")}
          </div>
        ) : repos.length === 0 ? (
          <div className="repo-list-empty">{t("env.reposDesc")}</div>
        ) : (
          repos.map((repo) => (
            <RepoRow
              key={repo.id}
              repo={repo}
              task={tasks[repo.id]}
              t={t}
              onDownload={() => void handleDownload(repo)}
              onUpdate={() => void handleUpdate(repo)}
              onDelete={() => void handleDelete(repo)}
              onCancel={() => void handleCancel(repo)}
              onRemoveCustom={() => void handleRemoveCustom(repo)}
            />
          ))
        )}
      </div>

      {showAdd ? (
        <AddCustomRepoModal
          saving={savingCustom}
          t={t}
          onClose={() => setShowAdd(false)}
          onSubmit={handleAddCustom}
          onError={(message) => onError(message)}
        />
      ) : null}
    </section>
  );
}

interface RepoRowProps {
  repo: TrainingRepoStatus;
  task?: RepoTaskUiState;
  t: TranslateFn;
  onDownload: () => void;
  onUpdate: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onRemoveCustom: () => void;
}

function RepoRow({ repo, task, t, onDownload, onUpdate, onDelete, onCancel, onRemoveCustom }: RepoRowProps) {
  const running = task?.status === "running";
  const busyLabel =
    task?.kind === "download"
      ? t("env.downloading")
      : task?.kind === "update"
        ? t("env.updating")
        : t("env.deleting");
  const branch = repo.installed ? repo.currentBranch ?? "-" : "-";
  const commit = repo.installed ? repo.currentCommit ?? "-" : "-";

  return (
    <article className={`repo-card${repo.installed ? " repo-card-installed" : ""}`}>
      <div className="repo-card-layout">
        <div className="repo-card-body">
          <header className="repo-card-head">
            <h3 className="repo-card-title">{repo.name}</h3>
            <div className="repo-card-badges">
              <span className="status-badge repo-card-badge-target">
                {repo.target === "wsl" ? t("env.targetWsl") : t("env.targetWindows")}
              </span>
              <span className="status-badge">
                {repo.isCustom ? t("env.custom") : t("env.curated")}
              </span>
              {repo.installed ? (
                <span className="status-badge status-badge-acid">
                  <span className="status-dot" /> {t("env.installed")}
                </span>
              ) : (
                <span className="status-badge repo-card-badge-muted">{t("env.notInstalled")}</span>
              )}
            </div>
          </header>

          {repo.description ? <p className="repo-card-desc">{repo.description}</p> : null}

          <dl className="repo-card-meta">
            <div className="repo-meta-line">
              <dt>{t("env.gitUrl")}</dt>
              <dd title={repo.gitUrl}>{repo.gitUrl}</dd>
            </div>
            <div className="repo-meta-strip">
              <div className="repo-meta-segment">
                <dt>{t("env.target")}</dt>
                <dd>{repo.target === "wsl" ? t("env.targetWsl") : t("env.targetWindows")}</dd>
              </div>
              <div className="repo-meta-segment">
                <dt>{t("env.branch")}</dt>
                <dd>
                  <GitBranch size={12} aria-hidden /> {branch}
                </dd>
              </div>
              <div className="repo-meta-segment">
                <dt>{t("env.commit")}</dt>
                <dd title={commit}>{commit}</dd>
              </div>
            </div>
            <div className="repo-meta-line">
              <dt>{t("env.installPath")}</dt>
              <dd title={repo.installPath || undefined}>{repo.installPath || "-"}</dd>
            </div>
          </dl>
        </div>

        <div className="repo-card-actions">
          {running ? (
            <>
              <span className="repo-card-busy">
                <Loader2 size={14} className="lf-icon-spin" /> {busyLabel}
              </span>
              {task?.taskId ? (
                <button type="button" className="btn" onClick={onCancel}>
                  <XCircle size={16} /> {t("env.cancel")}
                </button>
              ) : null}
            </>
          ) : (
            <>
              {repo.installed ? (
                <button type="button" className="btn" onClick={onUpdate}>
                  <RefreshCw size={16} /> {t("env.update")}
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={onDownload}>
                  <Download size={16} /> {t("env.download")}
                </button>
              )}
              {repo.installed ? (
                <button type="button" className="btn" onClick={onDelete}>
                  <Trash2 size={16} /> {t("env.delete")}
                </button>
              ) : null}
              {repo.isCustom ? (
                <button type="button" className="btn" onClick={onRemoveCustom}>
                  <XCircle size={16} /> {t("env.remove")}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>

      {task && (task.logs.length > 0 || task.status === "failed") ? (
        <div
          className={`terminal-block repo-card-log${task.status === "failed" ? " repo-card-log-failed" : ""}`}
        >
          {task.logs.length > 0 ? (
            task.logs.map((line, index) => (
              <div className="terminal-line" key={`${index}-${line.slice(0, 12)}`}>
                {line}
              </div>
            ))
          ) : (
            <div className="terminal-line repo-card-log-error">{t("env.taskFailed")}</div>
          )}
        </div>
      ) : null}
    </article>
  );
}
