import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  Download,
  MessageSquare,
  Sliders,
  Trash2,
  Upload,
} from "lucide-react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  applyBuiltinPromptSelection,
  BUILTIN_PROMPT_ANIME_SD,
  BUILTIN_PROMPT_EN,
  BUILTIN_PROMPT_FOLLOW_UI,
  BUILTIN_PROMPT_ZH_CN,
  createDefaultLlmSettings,
  DEFAULT_LLM_MAX_TOKENS,
  DEFAULT_LLM_CAPTION_RETRY_MAX,
  getDefaultSystemPrompt,
  inferLlmPromptPresetSelection,
  LLM_CONNECTION_FIELDS,
  LLM_PROMPT_AD_HOC,
  resolveSystemPrompt,
} from "./DesignLlmConfig";
import { loadLlmSettings, readTextFile, saveLlmSettings, writeTextFile } from "../../lib/desktopApi";
import {
  applyLlmPromptPresetToSettings,
  createUserLlmPromptPreset,
  importLlmPromptPresetsFromJson,
  loadCustomLlmPromptPresets,
  mergeImportedLlmPromptPresets,
  saveCustomLlmPromptPresets,
  serializeLlmPromptPresetsForExport,
  type LlmPromptPreset,
} from "../../lib/llmPromptPresets";
import type { SupportedLanguage, TranslateFn } from "../../lib/i18n";
import type { LlmSettings } from "../../lib/types";
import { PresetDropdownMenu, type PresetMenuGroup } from "../PresetDropdownMenu";

interface DesignLlmTabProps {
  language: SupportedLanguage;
  t: TranslateFn;
}

type LlmSection = "connection" | "prompt" | "advanced";

const NAV_ICONS = {
  connection: Activity,
  prompt: MessageSquare,
  advanced: Sliders,
} as const;

export function DesignLlmTab({ language, t }: DesignLlmTabProps) {
  const languageRef = useRef(language);
  languageRef.current = language;

  const [settings, setSettings] = useState<LlmSettings>(() => createDefaultLlmSettings(language));
  const [busyState, setBusyState] = useState<"loading" | "saving" | null>("loading");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<LlmSection>("connection");
  const [customPresets, setCustomPresets] = useState<LlmPromptPreset[]>(() => loadCustomLlmPromptPresets());
  const [promptPresetSelection, setPromptPresetSelection] = useState<string>(BUILTIN_PROMPT_FOLLOW_UI);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [savePresetName, setSavePresetName] = useState("");
  const [savePresetError, setSavePresetError] = useState<string | null>(null);
  const [presetMessage, setPresetMessage] = useState<string | null>(null);

  const llmPresetMenuGroups = useMemo((): PresetMenuGroup[] => {
    const groups: PresetMenuGroup[] = [
      {
        label: t("design.llmBuiltinPresetsGroup"),
        items: [
          { id: BUILTIN_PROMPT_FOLLOW_UI, label: t("design.llmBuiltinFollowUi") },
          { id: BUILTIN_PROMPT_EN, label: t("design.llmBuiltinEnglish") },
          { id: BUILTIN_PROMPT_ZH_CN, label: t("design.llmBuiltinZhCn") },
          { id: BUILTIN_PROMPT_ANIME_SD, label: t("design.llmBuiltinAnimeSd") },
        ],
      },
    ];
    if (customPresets.length > 0) {
      groups.push({
        label: t("design.llmCustomPresets"),
        items: customPresets.map((p) => ({ id: p.id, label: p.name })),
      });
    }
    groups.push({
      items: [{ id: LLM_PROMPT_AD_HOC, label: t("design.llmPromptAdHoc") }],
    });
    return groups;
  }, [customPresets, t]);

  useEffect(() => {
    let cancelled = false;

    setBusyState("loading");
    setFeedback(null);

    void loadLlmSettings()
      .then((loaded) => {
        if (cancelled) return;
        const lang = languageRef.current;
        const resolvedPrompt = resolveSystemPrompt(loaded.systemPrompt, lang);
        const initialCustom = loadCustomLlmPromptPresets();
        setCustomPresets(initialCustom);
        setSettings({
          ...createDefaultLlmSettings(lang),
          ...loaded,
          systemPrompt: resolvedPrompt,
          captionRetryMax:
            typeof loaded.captionRetryMax === "number" && !Number.isNaN(loaded.captionRetryMax)
              ? Math.min(20, Math.max(0, loaded.captionRetryMax))
              : DEFAULT_LLM_CAPTION_RETRY_MAX,
        });
        setPromptPresetSelection(inferLlmPromptPresetSelection(resolvedPrompt, lang, initialCustom));
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
  }, [t]);

  useEffect(() => {
    setSettings((current) => {
      if (
        promptPresetSelection === BUILTIN_PROMPT_FOLLOW_UI ||
        promptPresetSelection === BUILTIN_PROMPT_EN ||
        promptPresetSelection === BUILTIN_PROMPT_ZH_CN
      ) {
        const next = applyBuiltinPromptSelection(promptPresetSelection, language);
        if (next !== null && next !== current.systemPrompt) {
          return { ...current, systemPrompt: next };
        }
      }
      return current;
    });
  }, [language, promptPresetSelection]);

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
        captionRetryMax:
          typeof saved.captionRetryMax === "number" && !Number.isNaN(saved.captionRetryMax)
            ? Math.min(20, Math.max(0, saved.captionRetryMax))
            : DEFAULT_LLM_CAPTION_RETRY_MAX,
      }));
      setFeedback(t("design.connectionSaved"));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : t("errors.saveLlmSettings"));
    } finally {
      setBusyState(null);
    }
  };

  const handlePresetSelectChange = (value: string) => {
    setPresetMessage(null);
    if (value === LLM_PROMPT_AD_HOC) {
      setPromptPresetSelection(LLM_PROMPT_AD_HOC);
      return;
    }
    const builtin = applyBuiltinPromptSelection(value, language);
    if (builtin !== null) {
      setPromptPresetSelection(value);
      setSettings((current) => ({ ...current, systemPrompt: builtin }));
      return;
    }
    const preset = customPresets.find((p) => p.id === value);
    if (preset) {
      setPromptPresetSelection(value);
      setSettings((current) => applyLlmPromptPresetToSettings(current, preset));
    }
  };

  const handleSystemPromptChange = (text: string) => {
    updateSetting("systemPrompt", text);
    setPromptPresetSelection(LLM_PROMPT_AD_HOC);
    setPresetMessage(null);
  };

  const confirmSaveNewPreset = () => {
    const name = savePresetName.trim();
    if (!name) {
      setSavePresetError(t("config.presetNameRequired"));
      return;
    }
    setSavePresetError(null);
    const nextPreset = createUserLlmPromptPreset(name, {
      systemPrompt: settings.systemPrompt,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
    });
    const nextList = [...customPresets, nextPreset];
    setCustomPresets(nextList);
    saveCustomLlmPromptPresets(nextList);
    setPromptPresetSelection(nextPreset.id);
    setSavePresetOpen(false);
    setSavePresetName("");
    setPresetMessage(t("design.llmPresetSaved"));
  };

  const handleDeleteSelectedCustomPreset = () => {
    const preset = customPresets.find((p) => p.id === promptPresetSelection);
    if (!preset) return;
    const nextList = customPresets.filter((p) => p.id !== preset.id);
    setCustomPresets(nextList);
    saveCustomLlmPromptPresets(nextList);
    const followPrompt = getDefaultSystemPrompt(language);
    setPromptPresetSelection(BUILTIN_PROMPT_FOLLOW_UI);
    setSettings((current) => ({ ...current, systemPrompt: followPrompt }));
    setPresetMessage(t("design.llmPresetDeleted"));
  };

  const handleExportPresets = async () => {
    try {
      setPresetMessage(null);
      const savePath = await saveDialog({
        title: t("design.llmExportPresets"),
        defaultPath: t("design.llmPresetExportFilename"),
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!savePath) return;
      await writeTextFile(savePath as string, serializeLlmPromptPresetsForExport(customPresets));
      setPresetMessage(t("design.llmPresetExportDone"));
    } catch {
      // cancelled or write failed
    }
  };

  const handleImportPresets = async () => {
    try {
      setPresetMessage(null);
      const filePath = await openDialog({
        title: t("design.llmImportPresets"),
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!filePath) return;
      const text = await readTextFile(filePath as string);
      const imported = importLlmPromptPresetsFromJson(text);
      const merged = mergeImportedLlmPromptPresets(customPresets, imported);
      setCustomPresets(merged);
      saveCustomLlmPromptPresets(merged);
      setPresetMessage(t("design.llmPresetImportDone", { count: imported.length }));
    } catch {
      setPresetMessage(t("errors.llmPromptPresetImport"));
    }
  };

  const saving = busyState === "saving";
  const loading = busyState === "loading";
  const selectedCustomPreset = customPresets.find((p) => p.id === promptPresetSelection);

  const navItems: Array<{ id: LlmSection; labelKey: string }> = [
    { id: "connection", labelKey: "design.llmSectionConnection" },
    { id: "prompt", labelKey: "design.llmSectionPrompt" },
    { id: "advanced", labelKey: "design.llmSectionAdvanced" },
  ];

  return (
    <div className="design-llm-shell fade-in-section" style={{ gridColumn: "1 / -1", animationDelay: "0.2s" }}>
      <aside className="design-llm-nav">
        <div className="design-llm-nav-title">
          <Bot size={18} /> {t("design.llmSettings")}
        </div>
        {navItems.map((item) => {
          const Icon = NAV_ICONS[item.id];
          return (
            <button
              key={item.id}
              type="button"
              className={`design-llm-nav-item ${activeSection === item.id ? "active" : ""}`}
              onClick={() => setActiveSection(item.id)}
            >
              <Icon size={16} /> {t(item.labelKey)}
            </button>
          );
        })}
      </aside>

      <div className="design-llm-pane card">
        {activeSection === "connection" && (
          <>
            <div className="card-header">
              <span className="card-title-icon">
                <Activity size={18} /> {t("design.apiConfiguration")}
              </span>
            </div>
            <div className="design-llm-pane-body">
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
                      disabled={loading}
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
          </>
        )}

        {activeSection === "prompt" && (
          <>
            <div className="card-header">
              <span className="card-title-icon">
                <MessageSquare size={18} /> {t("design.systemPrompt")}
              </span>
            </div>
            <div className="design-llm-pane-body">
              <div className="form-group design-llm-preset-row">
                <label className="form-label">{t("design.llmPromptPresetSelect")}</label>
                <PresetDropdownMenu
                  value={promptPresetSelection}
                  onChange={(id) => handlePresetSelectChange(id)}
                  placeholder={t("design.llmPromptPresetSelect")}
                  groups={llmPresetMenuGroups}
                  disabled={loading}
                  block
                />
              </div>

              <div className="design-llm-preset-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setSavePresetError(null);
                    setSavePresetName("");
                    setSavePresetOpen((open) => !open);
                  }}
                  disabled={loading}
                >
                  {t("design.llmSaveAsPreset")}
                </button>
                {selectedCustomPreset ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => handleDeleteSelectedCustomPreset()}
                    disabled={loading}
                  >
                    <Trash2 size={14} style={{ marginRight: "0.35rem", verticalAlign: "middle" }} />
                    {t("design.llmDeletePreset")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn"
                  onClick={() => void handleImportPresets()}
                  disabled={loading}
                >
                  <Upload size={14} style={{ marginRight: "0.35rem", verticalAlign: "middle" }} />
                  {t("design.llmImportPresets")}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void handleExportPresets()}
                  disabled={loading || customPresets.length === 0}
                >
                  <Download size={14} style={{ marginRight: "0.35rem", verticalAlign: "middle" }} />
                  {t("design.llmExportPresets")}
                </button>
              </div>

              {savePresetOpen ? (
                <div className="design-llm-save-preset-box">
                  <label className="form-label">{t("design.llmPresetName")}</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder={t("design.llmPresetNamePlaceholder")}
                    value={savePresetName}
                    onChange={(event) => setSavePresetName(event.target.value)}
                  />
                  {savePresetError ? (
                    <div style={{ fontSize: "0.75rem", color: "var(--accent-warn, #c98a36)", marginTop: "0.35rem" }}>
                      {savePresetError}
                    </div>
                  ) : null}
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setSavePresetOpen(false);
                        setSavePresetError(null);
                        setSavePresetName("");
                      }}
                    >
                      {t("common.cancel")}
                    </button>
                    <button type="button" className="btn" onClick={() => confirmSaveNewPreset()}>
                      {t("common.save")}
                    </button>
                  </div>
                </div>
              ) : null}

              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <textarea
                  className="form-input design-llm-prompt-textarea"
                  style={{
                    resize: "vertical",
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.8rem",
                    padding: "0.75rem",
                  }}
                  placeholder={t("design.systemPromptPlaceholder")}
                  value={settings.systemPrompt}
                  onChange={(event) => handleSystemPromptChange(event.target.value)}
                  disabled={loading}
                />
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {t("design.systemPromptDesc")}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.5rem" }}>
                <button type="button" className="btn" onClick={() => void handleSave()} disabled={busyState !== null}>
                  {saving ? t("common.saving") : t("design.saveConnection")}
                </button>
              </div>
              {presetMessage ? (
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{presetMessage}</div>
              ) : null}
            </div>
          </>
        )}

        {activeSection === "advanced" && (
          <>
            <div className="card-header">
              <span className="card-title-icon">
                <Sliders size={18} /> {t("design.advancedLlm")}
              </span>
            </div>
            <div className="design-llm-pane-body">
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: "bold",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--text-muted)",
                    }}
                  >
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
                  disabled={loading}
                />
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{t("design.temperatureDesc")}</div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: "bold",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--text-muted)",
                  }}
                >
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
                  disabled={loading}
                />
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{t("design.maxTokensDesc")}</div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: "bold",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--text-muted)",
                  }}
                >
                  {t("design.llmCaptionRetryMax")}
                </div>
                <input
                  type="number"
                  className="form-input"
                  min={0}
                  max={20}
                  placeholder={String(DEFAULT_LLM_CAPTION_RETRY_MAX)}
                  value={settings.captionRetryMax}
                  onChange={(event) =>
                    updateSetting(
                      "captionRetryMax",
                      Math.min(20, Math.max(0, Number.parseInt(event.target.value || "0", 10) || 0)),
                    )
                  }
                  disabled={loading}
                />
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{t("design.llmCaptionRetryMaxDesc")}</div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
                <button type="button" className="btn" onClick={() => void handleSave()} disabled={busyState !== null}>
                  {saving ? t("common.saving") : t("design.saveConnection")}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
