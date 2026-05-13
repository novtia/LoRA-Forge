import { useEffect, useState } from "react";
import { FolderOpen, TerminalSquare } from "lucide-react";
import { loadTrainingEnv, saveTrainingEnv } from "../../lib/desktopApi";
import type { TranslateFn } from "../../lib/i18n";
import type { TrainingEnvSettings } from "../../lib/types";

interface DesignTrainingEnvTabProps {
  t: TranslateFn;
}

export function DesignTrainingEnvTab({ t }: DesignTrainingEnvTabProps) {
  const [settings, setSettings] = useState<TrainingEnvSettings>({
    sdScriptsPath: "",
    pythonExecutable: "",
  });
  const [busyState, setBusyState] = useState<"loading" | "saving" | null>("loading");
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBusyState("loading");
    setFeedback(null);

    void loadTrainingEnv()
      .then((loaded) => {
        if (!cancelled) setSettings(loaded);
      })
      .catch((error) => {
        if (!cancelled) setFeedback(error instanceof Error ? error.message : t("errors.loadTrainingEnv"));
      })
      .finally(() => {
        if (!cancelled) setBusyState(null);
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  const updateSetting = <K extends keyof TrainingEnvSettings>(key: K, value: TrainingEnvSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setFeedback(null);
  };

  const handleSave = async () => {
    try {
      setBusyState("saving");
      setFeedback(null);
      const saved = await saveTrainingEnv(settings);
      setSettings(saved);
      setFeedback(t("design.trainingEnvSaved"));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : t("errors.saveTrainingEnv"));
    } finally {
      setBusyState(null);
    }
  };

  const saving = busyState === "saving";

  return (
    <section className="card fade-in-section" style={{ gridColumn: "span 12", animationDelay: "0.2s" }}>
      <div className="card-header">
        <span className="card-title-icon">
          <TerminalSquare size={18} /> {t("design.trainingEnv")}
        </span>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {t("design.trainingEnvDesc")}
        </span>
      </div>

      <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <div className="form-group">
          <label className="form-label">
            <FolderOpen
              size={14}
              style={{ marginRight: "0.5rem", display: "inline-block", verticalAlign: "middle" }}
            />
            {t("config.sdScriptsPath")}
          </label>
          <input
            type="text"
            className="form-input"
            placeholder={t("config.sdScriptsPathPlaceholder")}
            value={settings.sdScriptsPath}
            onChange={(event) => updateSetting("sdScriptsPath", event.target.value)}
            disabled={busyState === "loading"}
          />
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
            {t("design.sdScriptsPathDesc")}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">
            <TerminalSquare
              size={14}
              style={{ marginRight: "0.5rem", display: "inline-block", verticalAlign: "middle" }}
            />
            {t("config.pythonExecutable")}
          </label>
          <input
            type="text"
            className="form-input"
            placeholder={t("config.pythonExecutablePlaceholder")}
            value={settings.pythonExecutable}
            onChange={(event) => updateSetting("pythonExecutable", event.target.value)}
            disabled={busyState === "loading"}
          />
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
            {t("design.pythonExecutableDesc")}
          </div>
        </div>

        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.75rem",
            color: "var(--text-muted)",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <TerminalSquare size={14} />
          {t("config.runtimeHint")}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.5rem" }}>
          <button type="button" className="btn" onClick={() => void handleSave()} disabled={busyState !== null}>
            {saving ? t("common.saving") : t("design.saveTrainingEnv")}
          </button>
        </div>
        {feedback ? (
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "-0.5rem" }}>
            {feedback}
          </div>
        ) : null}
      </div>
    </section>
  );
}
