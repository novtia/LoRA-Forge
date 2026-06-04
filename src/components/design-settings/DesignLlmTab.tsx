import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  Brain,
  Download,
  Languages,
  MessageSquare,
  Sliders,
  Trash2,
  Upload,
} from "lucide-react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  applyBuiltinPromptSelection,
  BUILTIN_PROMPT_FOLLOW_UI,
  createDefaultLlmSettings,
  DEFAULT_LLM_MAX_TOKENS,
  DEFAULT_LLM_CAPTION_RETRY_MAX,
  getDefaultSystemPrompt,
  LLM_PROMPT_AD_HOC,
  resolveLlmPromptPresetSelection,
  resolveSystemPrompt,
} from "./DesignLlmConfig";
import { PROMPT_DOCS } from "../../lib/promptDocs";
import { DesignLlmProviderPanel } from "./DesignLlmProviderPanel";
import { loadBaiduTranslateSettings, loadLlmSettings, readTextFile, saveBaiduTranslateSettings, saveLlmSettings, writeTextFile } from "../../lib/desktopApi";
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
import type {
  LlmEndpointKind,
  LlmPriorCaptionMode,
  LlmReasoningEffort,
  LlmSettings,
  BaiduTranslateSettings,
} from "../../lib/types";
import { PresetDropdownMenu, type PresetMenuGroup } from "../PresetDropdownMenu";
import { ToggleRow } from "./DesignSettingsControls";

function createDefaultBaiduTranslateSettings(): BaiduTranslateSettings {
  return { appId: "", secretKey: "" };
}

const ENDPOINT_KIND_VALUES: readonly LlmEndpointKind[] = [
  "auto",
  "openAi",
  "openRouter",
  "anthropicCompat",
];

const REASONING_EFFORT_VALUES: readonly LlmReasoningEffort[] = [
  "default",
  "minimal",
  "low",
  "medium",
  "high",
  "none",
];

const PRIOR_CAPTION_VALUES: readonly LlmPriorCaptionMode[] = [
  "off",
  "injectAsConversation",
  "injectAsAssistant",
  "injectAsUserExample",
];

function normalizeEndpointKind(value: unknown): LlmEndpointKind {
  return ENDPOINT_KIND_VALUES.includes(value as LlmEndpointKind)
    ? (value as LlmEndpointKind)
    : "auto";
}

function normalizeReasoningEffort(value: unknown): LlmReasoningEffort {
  return REASONING_EFFORT_VALUES.includes(value as LlmReasoningEffort)
    ? (value as LlmReasoningEffort)
    : "default";
}

function normalizePriorCaptionMode(value: unknown): LlmPriorCaptionMode {
  return PRIOR_CAPTION_VALUES.includes(value as LlmPriorCaptionMode)
    ? (value as LlmPriorCaptionMode)
    : "injectAsConversation";
}

function normalizeNonNegativeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

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
  const [baiduSettings, setBaiduSettings] = useState<BaiduTranslateSettings>(() => createDefaultBaiduTranslateSettings());
  const [busyState, setBusyState] = useState<"loading" | "saving" | null>("loading");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<LlmSection>("connection");
  const [customPresets, setCustomPresets] = useState<LlmPromptPreset[]>(() => loadCustomLlmPromptPresets());
  const [promptPresetSelection, setPromptPresetSelection] = useState<string>(BUILTIN_PROMPT_FOLLOW_UI);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [savePresetName, setSavePresetName] = useState("");
  const [savePresetError, setSavePresetError] = useState<string | null>(null);
  const [presetMessage, setPresetMessage] = useState<string | null>(null);

  const mergeSavedLlmSettings = (saved: LlmSettings, selectionId: string): LlmSettings => ({
    ...createDefaultLlmSettings(language),
    ...saved,
    systemPrompt: resolveSystemPrompt(saved.systemPrompt, language),
    captionRetryMax:
      typeof saved.captionRetryMax === "number" && !Number.isNaN(saved.captionRetryMax)
        ? Math.min(20, Math.max(0, saved.captionRetryMax))
        : DEFAULT_LLM_CAPTION_RETRY_MAX,
    thinkingEnabled: typeof saved.thinkingEnabled === "boolean" ? saved.thinkingEnabled : false,
    endpointKind: normalizeEndpointKind(saved.endpointKind),
    maxCompletionTokens: normalizeNonNegativeInt(saved.maxCompletionTokens),
    reasoningBudget: normalizeNonNegativeInt(saved.reasoningBudget),
    reasoningEffort: normalizeReasoningEffort(saved.reasoningEffort),
    priorCaptionMode: normalizePriorCaptionMode(saved.priorCaptionMode),
    systemPromptPresetId: selectionId,
    activeProviderId: saved.activeProviderId ?? "",
    textOnlyModelIds: saved.textOnlyModelIds ?? [],
  });

  const persistPromptPresetSettings = async (nextSettings: LlmSettings) => {
    try {
      const saved = await saveLlmSettings(nextSettings);
      setSettings(mergeSavedLlmSettings(saved, nextSettings.systemPromptPresetId ?? LLM_PROMPT_AD_HOC));
    } catch {
      // keep in-memory selection even if background save fails
    }
  };

  const llmPresetMenuGroups = useMemo((): PresetMenuGroup[] => {
    const groups: PresetMenuGroup[] = [
      {
        label: t("design.llmBuiltinPresetsGroup"),
        items: [
          { id: BUILTIN_PROMPT_FOLLOW_UI, label: t("design.llmBuiltinFollowUi") },
          // Auto-discovered from `prompts/*.md`; the label is each file's frontmatter `name`.
          ...PROMPT_DOCS.map((doc) => ({ id: doc.id, label: doc.name })),
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

  const reasoningEffortMenuGroups = useMemo((): PresetMenuGroup[] => [
    {
      items: [
        { id: "default", label: t("design.llmReasoningEffortDefault") },
        { id: "minimal", label: t("design.llmReasoningEffortMinimal") },
        { id: "low", label: t("design.llmReasoningEffortLow") },
        { id: "medium", label: t("design.llmReasoningEffortMedium") },
        { id: "high", label: t("design.llmReasoningEffortHigh") },
        { id: "none", label: t("design.llmReasoningEffortNone") },
      ],
    },
  ], [t]);

  const priorCaptionMenuGroups = useMemo((): PresetMenuGroup[] => [
    {
      items: [
        { id: "injectAsConversation", label: t("design.llmPriorCaptionConversation") },
        { id: "injectAsAssistant", label: t("design.llmPriorCaptionAssistant") },
        { id: "injectAsUserExample", label: t("design.llmPriorCaptionUserExample") },
        { id: "off", label: t("design.llmPriorCaptionOff") },
      ],
    },
  ], [t]);

  useEffect(() => {
    let cancelled = false;

    setBusyState("loading");
    setFeedback(null);

    void Promise.all([loadLlmSettings(), loadBaiduTranslateSettings()])
      .then(([loaded, baiduLoaded]) => {
        if (cancelled) return;
        const lang = languageRef.current;
        const resolvedPrompt = resolveSystemPrompt(loaded.systemPrompt, lang);
        const initialCustom = loadCustomLlmPromptPresets();
        const resolvedSelection = resolveLlmPromptPresetSelection(
          loaded.systemPromptPresetId,
          resolvedPrompt,
          lang,
          initialCustom,
        );
        setCustomPresets(initialCustom);
        const mergedSettings = mergeSavedLlmSettings(
          {
            ...createDefaultLlmSettings(lang),
            ...loaded,
            systemPrompt: resolvedPrompt,
          },
          resolvedSelection,
        );
        setSettings(mergedSettings);
        setBaiduSettings({
          ...createDefaultBaiduTranslateSettings(),
          ...baiduLoaded,
        });
        setPromptPresetSelection(resolvedSelection);
        if (!loaded.systemPromptPresetId?.trim()) {
          void persistPromptPresetSettings(mergedSettings);
        }
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
      if (promptPresetSelection === BUILTIN_PROMPT_FOLLOW_UI) {
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

  const handleSaveConnection = async () => {
    try {
      setBusyState("saving");
      setFeedback(null);
      await saveBaiduTranslateSettings(baiduSettings);
      setFeedback(t("design.connectionSaved"));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : t("errors.saveLlmSettings"));
    } finally {
      setBusyState(null);
    }
  };

  const handleSave = async () => {
    try {
      setBusyState("saving");
      setFeedback(null);
      const payload = { ...settings, systemPromptPresetId: promptPresetSelection };
      const saved = await saveLlmSettings(payload);
      setSettings(mergeSavedLlmSettings(saved, promptPresetSelection));
      setFeedback(t("design.connectionSaved"));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : t("errors.saveLlmSettings"));
    } finally {
      setBusyState(null);
    }
  };

  const handleEffectiveProviderChange = useCallback((patch: Partial<LlmSettings>) => {
    setSettings((current) => ({
      ...current,
      ...patch,
    }));
  }, []);

  const handlePresetSelectChange = (value: string) => {
    setPresetMessage(null);
    if (value === LLM_PROMPT_AD_HOC) {
      setPromptPresetSelection(LLM_PROMPT_AD_HOC);
      setSettings((current) => {
        const next = { ...current, systemPromptPresetId: LLM_PROMPT_AD_HOC };
        void persistPromptPresetSettings(next);
        return next;
      });
      return;
    }
    const builtin = applyBuiltinPromptSelection(value, language);
    if (builtin !== null) {
      setPromptPresetSelection(value);
      setSettings((current) => {
        const next = { ...current, systemPrompt: builtin, systemPromptPresetId: value };
        void persistPromptPresetSettings(next);
        return next;
      });
      return;
    }
    const preset = customPresets.find((p) => p.id === value);
    if (preset) {
      setPromptPresetSelection(value);
      setSettings((current) => {
        const next = applyLlmPromptPresetToSettings(
          { ...current, systemPromptPresetId: value },
          preset,
        );
        void persistPromptPresetSettings(next);
        return next;
      });
    }
  };

  const handleSystemPromptChange = (text: string) => {
    setSettings((current) => ({
      ...current,
      systemPrompt: text,
      systemPromptPresetId: LLM_PROMPT_AD_HOC,
    }));
    setPromptPresetSelection(LLM_PROMPT_AD_HOC);
    setFeedback(null);
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
    setSettings((current) => {
      const next = applyLlmPromptPresetToSettings(
        { ...current, systemPromptPresetId: nextPreset.id },
        nextPreset,
      );
      void persistPromptPresetSettings(next);
      return next;
    });
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
    setSettings((current) => {
      const next = {
        ...current,
        systemPrompt: followPrompt,
        systemPromptPresetId: BUILTIN_PROMPT_FOLLOW_UI,
      };
      void persistPromptPresetSettings(next);
      return next;
    });
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
              <DesignLlmProviderPanel
                t={t}
                disabled={loading}
                activeProviderId={settings.activeProviderId ?? ""}
                activeModelId={settings.modelId}
                onEffectiveChange={handleEffectiveProviderChange}
                onFeedback={setFeedback}
              />

              <div
                style={{
                  marginTop: "1.5rem",
                  paddingTop: "1.25rem",
                  borderTop: "1px solid var(--border-dim)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "1rem",
                }}
              >
                <div className="form-label" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Languages size={16} /> {t("design.baiduTranslateHeading")}
                </div>
                <div className="form-group">
                  <label className="form-label">{t("design.baiduAppId")}</label>
                  <input
                    type="text"
                    className="form-input"
                    autoComplete="off"
                    value={baiduSettings.appId}
                    onChange={(event) =>
                      setBaiduSettings((current) => ({ ...current, appId: event.target.value }))
                    }
                    disabled={loading}
                  />
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                    {t("design.baiduAppIdDesc")}
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">{t("design.baiduSecretKey")}</label>
                  <input
                    type="password"
                    className="form-input"
                    autoComplete="new-password"
                    value={baiduSettings.secretKey}
                    onChange={(event) =>
                      setBaiduSettings((current) => ({ ...current, secretKey: event.target.value }))
                    }
                    disabled={loading}
                  />
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                    {t("design.baiduSecretKeyDesc")}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
                <button type="button" className="btn" onClick={() => void handleSaveConnection()} disabled={busyState !== null}>
                  {saving ? t("common.saving") : t("design.saveBaiduTranslate")}
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

              <ToggleRow
                icon={<Brain size={16} />}
                label={t("design.llmThinking")}
                description={t("design.llmThinkingDesc")}
                checked={settings.thinkingEnabled}
                disabled={loading}
                onToggle={() => updateSetting("thinkingEnabled", !settings.thinkingEnabled)}
              />

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
                  {t("design.llmReasoningEffort")}
                </div>
                <PresetDropdownMenu
                  value={settings.reasoningEffort ?? "default"}
                  onChange={(id) =>
                    updateSetting("reasoningEffort", normalizeReasoningEffort(id))
                  }
                  placeholder={t("design.llmReasoningEffortDefault")}
                  groups={reasoningEffortMenuGroups}
                  disabled={loading}
                  block
                />
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                  {t("design.llmReasoningEffortDesc")}
                </div>
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
                  {t("design.llmReasoningBudget")}
                </div>
                <input
                  type="number"
                  className="form-input"
                  min={0}
                  value={settings.reasoningBudget ?? 0}
                  onChange={(event) =>
                    updateSetting(
                      "reasoningBudget",
                      Math.max(0, Number.parseInt(event.target.value || "0", 10) || 0),
                    )
                  }
                  disabled={loading}
                />
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                  {t("design.llmReasoningBudgetDesc")}
                </div>
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
                  {t("design.llmMaxCompletionTokens")}
                </div>
                <input
                  type="number"
                  className="form-input"
                  min={0}
                  value={settings.maxCompletionTokens ?? 0}
                  onChange={(event) =>
                    updateSetting(
                      "maxCompletionTokens",
                      Math.max(0, Number.parseInt(event.target.value || "0", 10) || 0),
                    )
                  }
                  disabled={loading}
                />
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                  {t("design.llmMaxCompletionTokensDesc")}
                </div>
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
                  {t("design.llmPriorCaptionMode")}
                </div>
                <PresetDropdownMenu
                  value={settings.priorCaptionMode ?? "injectAsConversation"}
                  onChange={(id) =>
                    updateSetting("priorCaptionMode", normalizePriorCaptionMode(id))
                  }
                  placeholder={t("design.llmPriorCaptionConversation")}
                  groups={priorCaptionMenuGroups}
                  disabled={loading}
                  block
                />
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                  {t("design.llmPriorCaptionModeDesc")}
                </div>
                <PriorCaptionStructurePreview
                  mode={settings.priorCaptionMode ?? "injectAsConversation"}
                  t={t}
                />
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

interface PriorCaptionStructurePreviewProps {
  mode: LlmPriorCaptionMode;
  t: TranslateFn;
}

interface PreviewLine {
  /** Conversation role label, e.g. `system` / `user` / `assistant`. */
  role: string;
  /** Inline description of the message content (translation key references handled by caller). */
  content: string;
  /** Highlight color for the role chip. */
  tone: "system" | "user" | "assistant";
}

function PriorCaptionStructurePreview({ mode, t }: PriorCaptionStructurePreviewProps) {
  const lines = buildPreviewLines(mode, t);
  return (
    <div
      style={{
        marginTop: "0.25rem",
        padding: "0.6rem 0.75rem",
        border: "1px solid var(--border-dim)",
        borderRadius: "0.4rem",
        background: "var(--surface-dim, rgba(0,0,0,0.18))",
        fontFamily: "var(--font-mono)",
        fontSize: "0.72rem",
        lineHeight: 1.55,
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
      }}
    >
      <div
        style={{
          fontSize: "0.65rem",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: "0.15rem",
        }}
      >
        {t("design.llmPriorCaptionPreviewHeading")}
      </div>
      {lines.map((line, index) => (
        <div key={index} style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
          <span
            style={{
              minWidth: "5.5rem",
              padding: "0.05rem 0.4rem",
              borderRadius: "0.25rem",
              textAlign: "center",
              fontWeight: 600,
              fontSize: "0.65rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              background:
                line.tone === "system"
                  ? "rgba(140, 140, 140, 0.25)"
                  : line.tone === "assistant"
                    ? "rgba(120, 200, 255, 0.22)"
                    : "rgba(180, 230, 140, 0.22)",
              color: "var(--text)",
            }}
          >
            {line.role}
          </span>
          <span style={{ color: "var(--text)", whiteSpace: "pre-wrap" }}>{line.content}</span>
        </div>
      ))}
    </div>
  );
}

function buildPreviewLines(mode: LlmPriorCaptionMode, t: TranslateFn): PreviewLine[] {
  const system: PreviewLine = {
    role: "system",
    content: t("design.llmPriorCaptionPreviewSystem"),
    tone: "system",
  };
  const userCurrent: PreviewLine = {
    role: "user",
    content: t("design.llmPriorCaptionPreviewUserCurrent"),
    tone: "user",
  };

  switch (mode) {
    case "off":
      return [system, userCurrent];
    case "injectAsConversation":
      return [
        system,
        {
          role: "user",
          content: t("design.llmPriorCaptionPreviewUserPriorTextOnly"),
          tone: "user",
        },
        {
          role: "assistant",
          content: t("design.llmPriorCaptionPreviewAssistantPrior"),
          tone: "assistant",
        },
        userCurrent,
      ];
    case "injectAsAssistant":
      return [
        system,
        {
          role: "assistant",
          content: t("design.llmPriorCaptionPreviewAssistantBare"),
          tone: "assistant",
        },
        userCurrent,
      ];
    case "injectAsUserExample":
      return [
        system,
        {
          role: "user",
          content: t("design.llmPriorCaptionPreviewUserEmbedded"),
          tone: "user",
        },
      ];
    default:
      return [system, userCurrent];
  }
}
