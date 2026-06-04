import { useCallback, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle,
  Image,
  Pencil,
  Trash2,
  XCircle,
} from "lucide-react";
import { DatasetContextMenu } from "../project/dataset-editor/DatasetContextMenu";
import { deleteProject as deleteProjectApi, updateProject } from "../../lib/desktopApi";
import { formatBytes, projectAccent } from "../../lib/formatters";
import { useI18n } from "../../lib/i18n";
import type { ProjectRecord } from "../../lib/types";
import { EditProjectModal } from "./EditProjectModal";

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

type ProjectGridCardProps = {
  project: ProjectRecord;
  index: number;
  loraModelLabel: string;
  formatUpdatedAt: (timestamp: number) => string;
  onProjectsChanged: () => void | Promise<void>;
  onError?: (message: string) => void;
};

export function ProjectGridCard({
  project,
  index,
  loraModelLabel,
  formatUpdatedAt,
  onProjectsChanged,
  onError,
}: ProjectGridCardProps) {
  const navigate = useNavigate();
  const { t, statusLabel } = useI18n();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const openContextMenu = useCallback((event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const handleDelete = async () => {
    setBusy(true);
    setDeleteConfirmOpen(false);
    try {
      await deleteProjectApi(project.id);
      await onProjectsChanged();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : t("errors.deleteProject"));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdit = async (payload: { name: string; rootPath: string }) => {
    setBusy(true);
    try {
      await updateProject(project.id, payload.name, payload.rootPath);
      setEditOpen(false);
      await onProjectsChanged();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : t("errors.updateProject"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        className="project-card-link"
        role="link"
        tabIndex={0}
        onClick={() => navigate(`/project/${project.id}`)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            navigate(`/project/${project.id}`);
          }
        }}
        onContextMenu={openContextMenu}
        style={{ cursor: busy ? "wait" : "pointer" }}
      >
        <div className={`card project-card ${projectAccent(project, index)}`}>
          <div className="card-header">
            <span>{loraModelLabel}</span>
            <span>{formatUpdatedAt(project.updatedAt)}</span>
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
            <span>
              {t("common.size")}: {formatBytes(project.sizeBytes)}
            </span>
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
      </div>

      <DatasetContextMenu
        open={contextMenu !== null}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        items={[
          {
            key: "edit",
            label: t("projectMenu.edit"),
            icon: <Pencil size={14} />,
            onSelect: () => setEditOpen(true),
          },
          {
            key: "delete",
            label: t("projectMenu.delete"),
            icon: <Trash2 size={14} />,
            danger: true,
            onSelect: () => setDeleteConfirmOpen(true),
          },
        ]}
        onClose={() => setContextMenu(null)}
      />

      {editOpen ? (
        <EditProjectModal
          project={project}
          saving={busy}
          onClose={() => setEditOpen(false)}
          onSave={handleSaveEdit}
          onError={onError}
        />
      ) : null}

      {deleteConfirmOpen ? (
        <div className="modal-overlay" onClick={() => setDeleteConfirmOpen(false)}>
          <div
            className="modal-content"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: 420 }}
          >
            <div className="modal-header">
              <div className="modal-title">{t("projectMenu.deleteConfirmTitle")}</div>
            </div>
            <div className="modal-body">
              <p style={{ margin: 0, color: "var(--text-muted)", lineHeight: 1.5 }}>
                {t("projectMenu.deleteConfirmBody", { name: project.name })}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn" type="button" onClick={() => setDeleteConfirmOpen(false)}>
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary"
                type="button"
                style={{ background: "var(--accent-orange)", borderColor: "var(--accent-orange)" }}
                disabled={busy}
                onClick={() => void handleDelete()}
              >
                {t("projectMenu.delete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
