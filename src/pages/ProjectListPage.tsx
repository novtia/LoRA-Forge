import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  Archive,
  Image,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { listProjects } from "../lib/desktopApi";
import { formatBytes, projectAccent } from "../lib/formatters";
import { useI18n } from "../lib/i18n";
import type { ProjectRecord } from "../lib/types";

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

export default function ProjectListPage() {
  const navigate = useNavigate();
  const { t, formatRelativeTime, statusLabel } = useI18n();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void listProjects()
      .then((data) => {
        if (mounted) setProjects(data);
      })
      .catch((loadError) => {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : t("errors.loadProjects"));
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="container page-dashboard">
      <header className="detail-header">
        <div className="header-left">
          <button className="back-btn" onClick={() => navigate(-1)}>
            <ChevronLeft size={18} /> {t("common.back")}
          </button>
          <div className="project-title-group">
            <div className="project-title-main">
              <Archive size={22} /> {t("projectList.title")}
            </div>
            <div className="project-path">{t("projectList.subtitle", { count: projects.length })}</div>
          </div>
        </div>
      </header>

      <div className="bento">
        {projects.map((project, index) => (
          <Link key={project.id} to={`/project/${project.id}`} className="project-card-link">
            <div className={`card project-card ${projectAccent(project, index)}`}>
              <div className="card-header">
                <span>{t("projectList.loraModel")}</span>
                <span>{formatRelativeTime(project.updatedAt)}</span>
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
                <Archive size={18} /> {t("projectList.emptyTitle")}
              </span>
            </div>
            <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              {t("projectList.emptyHint")}
            </div>
          </div>
        ) : null}
      </div>

      {error ? (
        <div style={{ marginTop: "1rem", color: "var(--accent-orange)", fontFamily: "var(--font-mono)" }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
