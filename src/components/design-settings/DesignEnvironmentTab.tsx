import { useState } from "react";
import { Boxes, Cpu, FolderCog, type LucideIcon } from "lucide-react";
import type { TranslateFn } from "../../lib/i18n";
import { RepoManagerPanel } from "../training-env/RepoManagerPanel";
import { EnvironmentInspectorPanel } from "../training-env/EnvironmentInspectorPanel";
import { DesignTrainingEnvTab } from "./DesignTrainingEnvTab";

type EnvSection = "repos" | "inspect" | "paths";

interface DesignEnvironmentTabProps {
  t: TranslateFn;
}

export function DesignEnvironmentTab({ t }: DesignEnvironmentTabProps) {
  const [section, setSection] = useState<EnvSection>("repos");
  const [error, setError] = useState<string | null>(null);

  const navItems: Array<{ id: EnvSection; icon: LucideIcon; label: string; desc: string }> = [
    { id: "repos", icon: Boxes, label: t("env.repos"), desc: t("env.reposDesc") },
    { id: "inspect", icon: Cpu, label: t("env.environment"), desc: t("env.environmentDesc") },
    { id: "paths", icon: FolderCog, label: t("design.trainingEnv"), desc: t("design.trainingEnvDesc") },
  ];

  return (
    <div className="env-settings fade-in-section" style={{ gridColumn: "span 12", animationDelay: "0.15s" }}>
      <div className="env-settings-layout">
        <aside className="env-settings-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`env-settings-nav-item ${active ? "active" : ""}`}
                onClick={() => {
                  setSection(item.id);
                  setError(null);
                }}
              >
                <span className="env-settings-nav-icon">
                  <Icon size={18} />
                </span>
                <span className="env-settings-nav-text">
                  <span className="env-settings-nav-label">{item.label}</span>
                  <span className="env-settings-nav-desc">{item.desc}</span>
                </span>
              </button>
            );
          })}
        </aside>

        <div className="env-settings-content">
          {error ? (
            <div
              style={{
                marginBottom: "0.85rem",
                color: "var(--accent-orange)",
                fontFamily: "var(--font-mono)",
                fontSize: "0.82rem",
              }}
            >
              {error}
            </div>
          ) : null}

          {section === "repos" ? <RepoManagerPanel t={t} onError={setError} /> : null}
          {section === "inspect" ? <EnvironmentInspectorPanel t={t} onError={setError} /> : null}
          {section === "paths" ? <DesignTrainingEnvTab t={t} /> : null}
        </div>
      </div>
    </div>
  );
}
