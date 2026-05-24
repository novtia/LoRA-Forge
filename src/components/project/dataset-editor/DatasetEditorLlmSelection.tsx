import { useCallback, useEffect, useMemo, useState } from "react";
import { Server } from "lucide-react";
import { PresetDropdownMenu, type PresetMenuGroup } from "../../PresetDropdownMenu";
import {
  listLlmProviders,
  loadLlmSettings,
  setActiveLlmSelection,
} from "../../../lib/desktopApi";
import { useI18n } from "../../../lib/i18n";
import type { LlmProviderModelEntry, LlmProviderSummary } from "../../../lib/types";

function modelLabel(entry: LlmProviderModelEntry): string {
  if (entry.label?.trim()) {
    return `${entry.label} (${entry.modelId})`;
  }
  return entry.modelId;
}

interface DatasetEditorLlmSelectionProps {
  disabled: boolean;
}

export function DatasetEditorLlmSelection({ disabled }: DatasetEditorLlmSelectionProps) {
  const { t } = useI18n();
  const [providers, setProviders] = useState<LlmProviderSummary[]>([]);
  const [activeProviderId, setActiveProviderId] = useState("");
  const [activeModelId, setActiveModelId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, settings] = await Promise.all([listLlmProviders(), loadLlmSettings()]);
      setProviders(list);
      const providerId =
        settings.activeProviderId && list.some((p) => p.id === settings.activeProviderId)
          ? settings.activeProviderId
          : list[0]?.id ?? "";
      setActiveProviderId(providerId);
      setActiveModelId(settings.modelId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.loadLlmSettings"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const activeProvider = useMemo(
    () => providers.find((p) => p.id === activeProviderId) ?? null,
    [activeProviderId, providers],
  );

  const providerMenuGroups = useMemo((): PresetMenuGroup[] => {
    if (providers.length === 0) {
      return [{ items: [{ id: "", label: t("dataset.llmNoProvider") }] }];
    }
    return [
      {
        items: providers.map((p) => ({ id: p.id, label: p.name })),
      },
    ];
  }, [providers, t]);

  const modelMenuGroups = useMemo((): PresetMenuGroup[] => {
    if (!activeProvider?.models.length) {
      return [{ items: [{ id: "", label: t("dataset.llmNoModel") }] }];
    }
    return [
      {
        items: activeProvider.models.map((entry) => ({
          id: entry.modelId,
          label: modelLabel(entry),
        })),
      },
    ];
  }, [activeProvider?.models, t]);

  const persistSelection = async (providerId: string, modelId: string) => {
    setSaving(true);
    setError(null);
    try {
      await setActiveLlmSelection({ providerId, modelId });
      setActiveProviderId(providerId);
      setActiveModelId(modelId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.saveLlmSettings"));
    } finally {
      setSaving(false);
    }
  };

  const handleProviderChange = async (providerId: string) => {
    if (!providerId || providerId === activeProviderId || saving) return;
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return;
    const nextModelId =
      provider.models.find((m) => m.modelId === activeModelId)?.modelId ??
      provider.models[0]?.modelId ??
      "";
    await persistSelection(providerId, nextModelId);
  };

  const handleModelChange = async (modelId: string) => {
    if (!modelId || !activeProviderId || modelId === activeModelId || saving) return;
    await persistSelection(activeProviderId, modelId);
  };

  const pickerDisabled = disabled || loading || saving || providers.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <label className="form-label" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <Server size={14} aria-hidden />
        {t("dataset.llmSelectionHeading")}
      </label>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 8rem", minWidth: "7rem" }}>
          <PresetDropdownMenu
            value={activeProviderId}
            onChange={(id) => void handleProviderChange(id)}
            placeholder={t("dataset.llmProvider")}
            groups={providerMenuGroups}
            disabled={pickerDisabled}
            block
          />
        </div>
        <div style={{ flex: "1 1 10rem", minWidth: "8rem" }}>
          <PresetDropdownMenu
            value={activeModelId}
            onChange={(id) => void handleModelChange(id)}
            placeholder={t("dataset.llmModel")}
            groups={modelMenuGroups}
            disabled={pickerDisabled || !activeProvider?.models.length}
            block
          />
        </div>
      </div>
      <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: 1.35 }}>
        {loading
          ? t("dataset.llmSelectionLoading")
          : providers.length === 0
            ? t("dataset.llmSelectionEmptyHint")
            : t("dataset.llmSelectionHint")}
      </div>
      {error ? (
        <div style={{ fontSize: "0.72rem", color: "var(--accent-orange)", lineHeight: 1.35 }}>{error}</div>
      ) : null}
    </div>
  );
}
