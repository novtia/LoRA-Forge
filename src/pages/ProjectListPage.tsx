import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Archive } from "lucide-react";
import { ProjectGridCard } from "../components/dashboard/ProjectGridCard";
import { listProjects } from "../lib/desktopApi";
import { useI18n } from "../lib/i18n";

export default function ProjectListPage() {
  const navigate = useNavigate();
  const { t, formatRelativeTime } = useI18n();
  const [projects, setProjects] = useState<Awaited<ReturnType<typeof listProjects>>>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshProjects = useCallback(async () => {
    setProjects(await listProjects());
  }, []);

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
  }, [t]);

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
          <ProjectGridCard
            key={project.id}
            project={project}
            index={index}
            loraModelLabel={t("projectList.loraModel")}
            formatUpdatedAt={formatRelativeTime}
            onProjectsChanged={refreshProjects}
            onError={setError}
          />
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
