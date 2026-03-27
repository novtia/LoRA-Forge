import { useEffect, useState } from "react";
import { Bot, MessageSquare, Sliders } from "lucide-react";
import { loadLlmSettings, saveLlmSettings } from "../../lib/desktopApi";
import type { SupportedLanguage, TranslateFn } from "../../lib/i18n";
import type { LlmSettings } from "../../lib/types";
import {
  DEFAULT_LLM_MAX_TOKENS,
  LLM_CONNECTION_FIELDS,
  createDefaultLlmSettings,
  getDefaultSystemPrompt,
  resolveSystemPrompt,
} from "./DesignLlmConfig";

interface DesignLlmTabProps {
  language: SupportedLanguage;
  t: TranslateFn;
}

export function DesignLlmTab({ language, t }: DesignLlmTabProps) {
  const defaultSystemPrompt = getDefaultSystemPrompt(language);
  const [settings, setSettings] = useState<LlmSettings>(() => createDefaultLlmSettings(language));
  const [busyState, setBusyState] = useState<"loading" | "saving" | null>("loading");
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setBusyState("loading");
    setFeedback(null);

    void loadLlmSettings()
      .then((loaded) => {
        if (cancelled) return;
        setSettings((current) => ({
          ...current,
          ...loaded,
          systemPrompt: resolveSystemPrompt(loaded.systemPrompt, language),
        }));
      })
      .catch((error) => {
        if (cancelled) return;
        setFeedback(error instanceof Error ? error.message : t("errors.loadLlmSettings"));
      })
      .finally(() => {
        if (!cancelled) {
          setBusyState(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [defaultSystemPrompt, language, t]);

  useEffect(() => {
    setSettings((current) => {
      const nextSystemPrompt = resolveSystemPrompt(current.systemPrompt, language);
      if (nextSystemPrompt === current.systemPrompt) {
        return current;
      }

      return {
        ...current,
        systemPrompt: nextSystemPrompt,
      };
    });
  }, [language]);

  const updateSetting = <K extends keyof LlmSettings>(key: K, value: LlmSettings[K]) => {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
    setFeedback(null);
  };

  const handleSave = async () => {
    try {
      setBusyState("saving");
      setFeedback(null);
      const saved = await saveLlmSettings(settings);
      setSettings((current) => ({
        ...current,
        ...saved,
        systemPrompt: resolveSystemPrompt(saved.systemPrompt, language),
      }));
      setFeedback(t("design.connectionSaved"));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : t("errors.saveLlmSettings"));
    } finally {
      setBusyState(null);
    }
  };

  const saving = busyState === "saving";

  return (
    <>
      <section className="card fade-in-section" style={{ gridColumn: "span 7", animationDelay: "0.2s" }}>
        <div className="card-header">
          <span className="card-title-icon">
            <Bot size={18} /> {t("design.llmSettings")}
          </span>
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            {t("design.apiConfiguration")}
          </span>
        </div>

        <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {LLM_CONNECTION_FIELDS.map((field) => {
            const Icon = field.icon;

            return (
              <div key={field.id} className="form-group">
                <label className="form-label">
                  <Icon
                    size={14}
                    style={{ marginRight: "0.5rem", display: "inline-block", verticalAlign: "middle" }}
                  />
                  {t(field.labelKey)}
                </label>
                <input
                  type={field.inputType}
                  className="form-input"
                  placeholder={field.placeholder}
                  value={settings[field.field]}
                  onChange={(event) => updateSetting(field.field, event.target.value)}
                  disabled={busyState === "loading"}
                />
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  {t(field.descriptionKey)}
                </div>
              </div>
            );
          })}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
            <button type="button" className="btn" onClick={() => void handleSave()} disabled={busyState !== null}>
              {saving ? t("common.saving") : t("design.saveConnection")}
            </button>
          </div>
          {feedback ? (
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "-0.5rem" }}>
              {feedback}
            </div>
          ) : null}
        </div>
      </section>

      <section className="card fade-in-section" style={{ gridColumn: "span 5", animationDelay: "0.3s" }}>
        <div className="card-header">
          <span className="card-title-icon">
            <Sliders size={18} /> {t("design.advancedLlm")}
          </span>
        </div>
        <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
              <MessageSquare size={14} />
              {t("design.systemPrompt")}
            </div>
            <textarea
              className="form-input"
              style={{
                minHeight: "120px",
                resize: "vertical",
                fontFamily: "var(--font-mono)",
                fontSize: "0.8rem",
                padding: "0.75rem",
              }}
              placeholder={t("design.systemPromptPlaceholder")}
              value={settings.systemPrompt}
              onChange={(event) => updateSetting("systemPrompt", event.target.value)}
              disabled={busyState === "loading"}
            />
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {t("design.systemPromptDesc")}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>
                {t("design.temperature")}
              </div>
              <span style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--accent-acid)" }}>
                {settings.temperature.toFixed(1)}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={settings.temperature}
              onChange={(event) => updateSetting("temperature", Number(event.target.value))}
              className="design-range"
              style={{ width: "100%", cursor: "pointer", accentColor: "var(--accent-acid)" }}
              disabled={busyState === "loading"}
            />
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
              {t("design.temperatureDesc")}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>
              {t("design.maxTokens")}
            </div>
            <input
              type="number"
              className="form-input"
              placeholder={String(DEFAULT_LLM_MAX_TOKENS)}
              value={settings.maxTokens}
              onChange={(event) =>
                updateSetting("maxTokens", Math.max(1, Number.parseInt(event.target.value || "0", 10) || 0))
              }
              disabled={busyState === "loading"}
            />
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
              {t("design.maxTokensDesc")}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
