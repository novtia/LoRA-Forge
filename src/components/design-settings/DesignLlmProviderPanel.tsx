import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Globe, Key, Link2, Plus, RefreshCw, Server, Trash2 } from "lucide-react";
import {
  createLlmProvider,
  deleteLlmProvider,
  deleteLlmProviderModel,
  fetchLlmProviderModels,
  getLlmProvider,
  listLlmProviders,
  setActiveLlmSelection,
  updateLlmProvider,
  addLlmProviderModel,
} from "../../lib/desktopApi";
import type { TranslateFn } from "../../lib/i18n";
import type {
  LlmEndpointKind,
  LlmProvider,
  LlmProviderModelEntry,
  LlmProviderSummary,
  LlmSettings,
} from "../../lib/types";
import { PresetDropdownMenu, type PresetMenuGroup } from "../PresetDropdownMenu";
import { DesignLlmFetchedModelsDialog } from "./DesignLlmFetchedModelsDialog";

const ENDPOINT_KIND_VALUES: readonly LlmEndpointKind[] = [
  "auto",
  "openAi",
  "openRouter",
  "anthropicCompat",
];

function normalizeEndpointKind(value: unknown): LlmEndpointKind {
  return ENDPOINT_KIND_VALUES.includes(value as LlmEndpointKind)
    ? (value as LlmEndpointKind)
    : "auto";
}

function modelLabel(entry: LlmProviderModelEntry): string {
  if (entry.label?.trim()) {
    return `${entry.label} (${entry.modelId})`;
  }
  return entry.modelId;
}

interface DesignLlmProviderPanelProps {
  t: TranslateFn;
  disabled: boolean;
  activeProviderId: string;
  activeModelId: string;
  onEffectiveChange: (patch: Partial<LlmSettings>) => void;
  onFeedback: (message: string | null) => void;
}

export function DesignLlmProviderPanel({
  t,
  disabled,
  activeProviderId,
  activeModelId,
  onEffectiveChange,
  onFeedback,
}: DesignLlmProviderPanelProps) {
  const [providers, setProviders] = useState<LlmProviderSummary[]>([]);
  const [selectedId, setSelectedId] = useState(activeProviderId);
  const [selectedModelId, setSelectedModelId] = useState(activeModelId);
  const [draft, setDraft] = useState<LlmProvider | null>(null);
  const [panelBusy, setPanelBusy] = useState<"loading" | "saving" | "refresh" | null>("loading");
  const [manualModelId, setManualModelId] = useState("");
  const [manualModelLabel, setManualModelLabel] = useState("");
  const [fetchDialogOpen, setFetchDialogOpen] = useState(false);
  const [fetchedModelIds, setFetchedModelIds] = useState<string[]>([]);
  const [fetchDialogFetching, setFetchDialogFetching] = useState(false);
  const [fetchDialogError, setFetchDialogError] = useState<string | null>(null);
  const [fetchDialogBusyModelId, setFetchDialogBusyModelId] = useState<string | null>(null);

  const onEffectiveChangeRef = useRef(onEffectiveChange);
  onEffectiveChangeRef.current = onEffectiveChange;

  const onFeedbackRef = useRef(onFeedback);
  onFeedbackRef.current = onFeedback;

  const initialActiveProviderId = useRef(activeProviderId);
  const initialActiveModelId = useRef(activeModelId);

  const endpointKindMenuGroups = useMemo((): PresetMenuGroup[] => [
    {
      items: [
        { id: "auto", label: t("design.llmEndpointKindAuto") },
        { id: "openAi", label: t("design.llmEndpointKindOpenAi") },
        { id: "openRouter", label: t("design.llmEndpointKindOpenRouter") },
        { id: "anthropicCompat", label: t("design.llmEndpointKindAnthropic") },
      ],
    },
  ], [t]);

  const modelMenuGroups = useMemo((): PresetMenuGroup[] => {
    if (!draft?.models.length) {
      return [{ items: [{ id: "", label: t("design.llmProviderNoModels") }] }];
    }
    return [
      {
        items: draft.models.map((entry) => ({
          id: entry.modelId,
          label: modelLabel(entry),
        })),
      },
    ];
  }, [draft?.models, t]);

  const syncEffectiveFromProvider = useCallback((provider: LlmProvider, modelId: string) => {
    setSelectedModelId(modelId);
    onEffectiveChangeRef.current({
      activeProviderId: provider.id,
      endpointUrl: provider.endpointUrl,
      apiKey: provider.apiKey,
      modelId,
      endpointKind: provider.endpointKind,
    });
  }, []);

  const loadProviderDetail = useCallback(
    async (
      providerId: string,
      preferredModelId?: string,
      options?: { persistActive?: boolean; syncParent?: boolean },
    ) => {
      const persistActive = options?.persistActive ?? true;
      const syncParent = options?.syncParent ?? true;
      const provider = await getLlmProvider(providerId);
      setDraft(provider);
      setSelectedId(provider.id);
      const modelId =
        preferredModelId && provider.models.some((m) => m.modelId === preferredModelId)
          ? preferredModelId
          : provider.models[0]?.modelId ?? "";
      setSelectedModelId(modelId);
      if (persistActive && modelId) {
        await setActiveLlmSelection({ providerId: provider.id, modelId });
      }
      if (syncParent) {
        syncEffectiveFromProvider(provider, modelId);
      }
      return provider;
    },
    [syncEffectiveFromProvider],
  );

  const reloadProviders = useCallback(async () => {
    const list = await listLlmProviders();
    setProviders(list);
    return list;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPanelBusy("loading");

    void (async () => {
      try {
        const list = await reloadProviders();
        if (cancelled) return;
        if (list.length === 0) {
          setDraft(null);
          setSelectedId("");
          return;
        }
        const targetId =
          initialActiveProviderId.current &&
          list.some((p) => p.id === initialActiveProviderId.current)
            ? initialActiveProviderId.current
            : list[0].id;
        await loadProviderDetail(targetId, initialActiveModelId.current, {
          persistActive: false,
          syncParent: true,
        });
      } catch (error) {
        if (!cancelled) {
          onFeedbackRef.current(
            error instanceof Error ? error.message : t("errors.loadLlmSettings"),
          );
        }
      } finally {
        if (!cancelled) {
          setPanelBusy(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Initial load only — remount happens when leaving/re-entering the Connection tab.
  }, [loadProviderDetail, reloadProviders, t]);

  // Recover when the provider list loaded but detail state was lost (e.g. Strict Mode cleanup).
  useEffect(() => {
    if (draft || panelBusy || providers.length === 0) return;
    const targetId =
      selectedId && providers.some((p) => p.id === selectedId) ? selectedId : providers[0].id;
    let cancelled = false;
    void loadProviderDetail(targetId, undefined, { persistActive: false, syncParent: true }).catch(
      (error) => {
        if (!cancelled) {
          onFeedbackRef.current(
            error instanceof Error ? error.message : t("errors.loadLlmSettings"),
          );
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [draft, loadProviderDetail, panelBusy, providers, selectedId, t]);

  const handleSelectProvider = async (providerId: string) => {
    if (providerId === selectedId || panelBusy !== null) return;
    try {
      setPanelBusy("loading");
      onFeedbackRef.current(null);
      await loadProviderDetail(providerId);
    } catch (error) {
      onFeedbackRef.current(error instanceof Error ? error.message : t("errors.loadLlmSettings"));
    } finally {
      setPanelBusy(null);
    }
  };

  const handleCreateProvider = async () => {
    try {
      setPanelBusy("saving");
      onFeedback(null);
      const created = await createLlmProvider({
        name: t("design.llmProviderNewDefaultName"),
        endpointUrl: "https://api.openai.com/v1/chat/completions",
        apiKey: "",
        endpointKind: "auto",
      });
      await reloadProviders();
      await loadProviderDetail(created.id);
      onFeedback(t("design.llmProviderCreated"));
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : t("errors.saveLlmSettings"));
    } finally {
      setPanelBusy(null);
    }
  };

  const handleDeleteProvider = async () => {
    if (!draft) return;
    if (!window.confirm(t("design.llmProviderDeleteConfirm", { name: draft.name }))) {
      return;
    }
    try {
      setPanelBusy("saving");
      onFeedback(null);
      await deleteLlmProvider(draft.id);
      const list = await reloadProviders();
      if (list.length === 0) {
        setDraft(null);
        setSelectedId("");
        onEffectiveChange({
          activeProviderId: "",
          endpointUrl: "",
          apiKey: "",
          modelId: "",
        });
        return;
      }
      await loadProviderDetail(list[0].id);
      onFeedback(t("design.llmProviderDeleted"));
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : t("errors.saveLlmSettings"));
    } finally {
      setPanelBusy(null);
    }
  };

  const handleSaveProvider = async () => {
    if (!draft) return;
    try {
      setPanelBusy("saving");
      onFeedback(null);
      const saved = await updateLlmProvider({
        providerId: draft.id,
        name: draft.name,
        endpointUrl: draft.endpointUrl,
        apiKey: draft.apiKey,
        endpointKind: draft.endpointKind,
      });
      setDraft(saved);
      await reloadProviders();
      const modelId =
        saved.models.find((m) => m.modelId === selectedModelId)?.modelId ??
        saved.models[0]?.modelId ??
        "";
      syncEffectiveFromProvider(saved, modelId);
      onFeedback(t("design.connectionSaved"));
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : t("errors.saveLlmSettings"));
    } finally {
      setPanelBusy(null);
    }
  };

  const handleModelChange = async (modelId: string) => {
    if (!draft || !modelId || modelId === selectedModelId) return;
    setSelectedModelId(modelId);
    syncEffectiveFromProvider(draft, modelId);
    try {
      setPanelBusy("saving");
      onFeedbackRef.current(null);
      await setActiveLlmSelection({ providerId: draft.id, modelId });
    } catch (error) {
      onFeedbackRef.current(error instanceof Error ? error.message : t("errors.saveLlmSettings"));
    } finally {
      setPanelBusy(null);
    }
  };

  const handleOpenFetchDialog = () => {
    if (!draft) return;
    setFetchDialogError(null);
    setFetchedModelIds([]);
    setFetchDialogFetching(true);
    onFeedbackRef.current(null);
    // Defer opening until the click that triggered this handler has finished,
    // otherwise the new overlay can receive the same pointer-up and close immediately.
    window.setTimeout(() => {
      setFetchDialogOpen(true);
      void (async () => {
        try {
          const ids = await fetchLlmProviderModels({
            providerId: draft.id,
            endpointUrl: draft.endpointUrl,
            apiKey: draft.apiKey,
          });
          setFetchedModelIds(ids);
        } catch (error) {
          setFetchDialogError(
            error instanceof Error ? error.message : t("design.llmProviderModelsRefreshFailed"),
          );
        } finally {
          setFetchDialogFetching(false);
        }
      })();
    }, 0);
  };

  const handleFetchDialogAdd = async (modelId: string) => {
    if (!draft) return;
    setFetchDialogBusyModelId(modelId);
    try {
      const updated = await addLlmProviderModel({
        providerId: draft.id,
        modelId,
        source: "fetched",
      });
      setDraft(updated);
      await reloadProviders();
      onFeedbackRef.current(t("design.llmProviderModelAdded"));
    } catch (error) {
      onFeedbackRef.current(error instanceof Error ? error.message : t("errors.saveLlmSettings"));
    } finally {
      setFetchDialogBusyModelId(null);
    }
  };

  const handleFetchDialogDelete = async (modelId: string) => {
    if (!draft) return;
    const entry = draft.models.find((model) => model.modelId === modelId);
    if (!entry) return;
    setFetchDialogBusyModelId(modelId);
    try {
      const updated = await deleteLlmProviderModel({
        providerId: draft.id,
        entryId: entry.id,
      });
      setDraft(updated);
      await reloadProviders();
      const nextModelId =
        updated.models.find((model) => model.modelId === selectedModelId)?.modelId ??
        updated.models[0]?.modelId ??
        "";
      if (nextModelId) {
        await setActiveLlmSelection({ providerId: updated.id, modelId: nextModelId });
      }
      syncEffectiveFromProvider(updated, nextModelId);
    } catch (error) {
      onFeedbackRef.current(error instanceof Error ? error.message : t("errors.saveLlmSettings"));
    } finally {
      setFetchDialogBusyModelId(null);
    }
  };

  const handleAddManualModel = async () => {
    if (!draft) return;
    const modelId = manualModelId.trim();
    if (!modelId) return;
    try {
      setPanelBusy("saving");
      onFeedback(null);
      const updated = await addLlmProviderModel({
        providerId: draft.id,
        modelId,
        label: manualModelLabel.trim() || undefined,
      });
      setDraft(updated);
      await reloadProviders();
      setManualModelId("");
      setManualModelLabel("");
      await setActiveLlmSelection({ providerId: updated.id, modelId });
      syncEffectiveFromProvider(updated, modelId);
      onFeedback(t("design.llmProviderModelAdded"));
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : t("errors.saveLlmSettings"));
    } finally {
      setPanelBusy(null);
    }
  };

  const handleDeleteModel = async (entry: LlmProviderModelEntry) => {
    if (!draft) return;
    try {
      setPanelBusy("saving");
      onFeedback(null);
      const updated = await deleteLlmProviderModel({
        providerId: draft.id,
        entryId: entry.id,
      });
      setDraft(updated);
      await reloadProviders();
      const nextModelId = updated.models[0]?.modelId ?? "";
      if (nextModelId) {
        await setActiveLlmSelection({ providerId: updated.id, modelId: nextModelId });
      }
      syncEffectiveFromProvider(updated, nextModelId);
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : t("errors.saveLlmSettings"));
    } finally {
      setPanelBusy(null);
    }
  };

  const panelDisabled = disabled || panelBusy !== null;

  return (
    <div className="design-llm-provider-panel">
      <div className="design-llm-provider-layout">
        <aside className="design-llm-provider-list">
          <div className="design-llm-provider-list-header">
            <span>{t("design.llmProviderListHeading")}</span>
            <button
              type="button"
              className="btn"
              onClick={() => void handleCreateProvider()}
              disabled={panelDisabled}
              title={t("design.llmProviderCreate")}
            >
              <Plus size={14} />
            </button>
          </div>
          {providers.length === 0 ? (
            <div className="design-llm-provider-empty">{t("design.llmProviderEmpty")}</div>
          ) : (
            providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className={`design-llm-provider-list-item ${selectedId === provider.id ? "active" : ""}`}
                onClick={() => void handleSelectProvider(provider.id)}
                disabled={panelDisabled}
              >
                <Server size={14} />
                <span>{provider.name}</span>
              </button>
            ))
          )}
        </aside>

        <div className="design-llm-provider-detail">
          {panelBusy === "loading" && !draft ? (
            <div className="design-llm-provider-empty">{t("design.llmProviderRefreshing")}</div>
          ) : !draft ? (
            <div className="design-llm-provider-empty">{t("design.llmProviderEmptyHint")}</div>
          ) : (
            <>
              <div className="form-group">
                <label className="form-label">
                  <Server size={14} style={{ marginRight: "0.5rem", verticalAlign: "middle" }} />
                  {t("design.llmProviderName")}
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  disabled={panelDisabled}
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  <Link2 size={14} style={{ marginRight: "0.5rem", verticalAlign: "middle" }} />
                  {t("design.llmUrl")}
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="https://api.openai.com/v1/chat/completions"
                  value={draft.endpointUrl}
                  onChange={(event) => setDraft({ ...draft, endpointUrl: event.target.value })}
                  disabled={panelDisabled}
                />
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  {t("design.llmUrlDesc")}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">
                  <Key size={14} style={{ marginRight: "0.5rem", verticalAlign: "middle" }} />
                  {t("design.llmKey")}
                </label>
                <input
                  type="password"
                  className="form-input"
                  autoComplete="new-password"
                  value={draft.apiKey}
                  onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                  disabled={panelDisabled}
                />
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  {t("design.llmKeyDesc")}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">
                  <Globe size={14} style={{ marginRight: "0.5rem", verticalAlign: "middle" }} />
                  {t("design.llmEndpointKind")}
                </label>
                <PresetDropdownMenu
                  value={draft.endpointKind ?? "auto"}
                  onChange={(id) =>
                    setDraft({ ...draft, endpointKind: normalizeEndpointKind(id) })
                  }
                  placeholder={t("design.llmEndpointKindAuto")}
                  groups={endpointKindMenuGroups}
                  disabled={panelDisabled}
                  block
                />
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  {t("design.llmEndpointKindDesc")}
                </div>
              </div>

              <div
                style={{
                  marginTop: "1rem",
                  paddingTop: "1rem",
                  borderTop: "1px solid var(--border-dim)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem",
                }}
              >
                <div className="form-label">{t("design.llmProviderModelsHeading")}</div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <PresetDropdownMenu
                      value={selectedModelId}
                      onChange={(id) => void handleModelChange(id)}
                      placeholder={t("design.llmModel")}
                      groups={modelMenuGroups}
                      disabled={panelDisabled || draft.models.length === 0}
                      block
                    />
                  </div>
                  <button
                    type="button"
                    className="btn"
        onClick={() => void handleOpenFetchDialog()}
                    disabled={panelDisabled}
                    title={t("design.llmProviderRefreshModels")}
                  >
                    <RefreshCw size={14} />
                    {t("design.llmProviderRefreshModels")}
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  {draft.models.map((entry) => (
                    <div
                      key={entry.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "0.5rem",
                        fontSize: "0.8rem",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      <span>
                        {modelLabel(entry)}
                        <span style={{ color: "var(--text-muted)", marginLeft: "0.5rem" }}>
                          ({entry.source === "fetched" ? t("design.llmProviderModelFetched") : t("design.llmProviderModelManual")})
                        </span>
                      </span>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void handleDeleteModel(entry)}
                        disabled={panelDisabled}
                        title={t("design.llmProviderDeleteModel")}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <div className="form-label">{t("design.llmProviderAddModel")}</div>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <input
                      type="text"
                      className="form-input"
                      style={{ flex: "1 1 12rem" }}
                      placeholder={t("design.llmModel")}
                      value={manualModelId}
                      onChange={(event) => setManualModelId(event.target.value)}
                      disabled={panelDisabled}
                    />
                    <input
                      type="text"
                      className="form-input"
                      style={{ flex: "1 1 10rem" }}
                      placeholder={t("design.llmProviderModelLabelOptional")}
                      value={manualModelLabel}
                      onChange={(event) => setManualModelLabel(event.target.value)}
                      disabled={panelDisabled}
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void handleAddManualModel()}
                      disabled={panelDisabled || !manualModelId.trim()}
                    >
                      {t("design.llmProviderAddModelButton")}
                    </button>
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: "1rem",
                  gap: "0.5rem",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  className="btn"
                  onClick={() => void handleDeleteProvider()}
                  disabled={panelDisabled}
                >
                  <Trash2 size={14} style={{ marginRight: "0.35rem", verticalAlign: "middle" }} />
                  {t("design.llmProviderDelete")}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void handleSaveProvider()}
                  disabled={panelDisabled}
                >
                  {panelBusy === "saving" ? t("common.saving") : t("design.saveConnection")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <DesignLlmFetchedModelsDialog
        open={fetchDialogOpen}
        t={t}
        modelIds={fetchedModelIds}
        localModels={draft?.models ?? []}
        busyModelId={fetchDialogBusyModelId}
        fetching={fetchDialogFetching}
        errorMessage={fetchDialogError}
        onClose={() => {
          if (fetchDialogBusyModelId || fetchDialogFetching) return;
          setFetchDialogOpen(false);
          setFetchDialogError(null);
        }}
        onAdd={handleFetchDialogAdd}
        onDelete={handleFetchDialogDelete}
      />
    </div>
  );
}
