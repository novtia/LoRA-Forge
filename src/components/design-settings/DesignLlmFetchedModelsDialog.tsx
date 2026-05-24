import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import type { TranslateFn } from "../../lib/i18n";
import type { LlmProviderModelEntry } from "../../lib/types";

interface DesignLlmFetchedModelsDialogProps {
  open: boolean;
  t: TranslateFn;
  modelIds: string[];
  localModels: LlmProviderModelEntry[];
  busyModelId: string | null;
  fetching: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onAdd: (modelId: string) => void | Promise<void>;
  onDelete: (modelId: string) => void | Promise<void>;
}

export function DesignLlmFetchedModelsDialog({
  open,
  t,
  modelIds,
  localModels,
  busyModelId,
  fetching,
  errorMessage,
  onClose,
  onAdd,
  onDelete,
}: DesignLlmFetchedModelsDialogProps) {
  const [filter, setFilter] = useState("");
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const openedAtRef = useRef(0);

  useEffect(() => {
    if (open) {
      openedAtRef.current = Date.now();
      setFilter("");
      setHiddenIds(new Set());
    }
  }, [open, modelIds]);

  const localByModelId = useMemo(() => {
    const map = new Map<string, LlmProviderModelEntry>();
    for (const entry of localModels) {
      map.set(entry.modelId, entry);
    }
    return map;
  }, [localModels]);

  const visibleModelIds = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return modelIds.filter((id) => {
      if (hiddenIds.has(id)) return false;
      if (!needle) return true;
      return id.toLowerCase().includes(needle);
    });
  }, [filter, hiddenIds, modelIds]);

  if (!open) return null;

  const dismissFromList = (modelId: string) => {
    setHiddenIds((current) => {
      const next = new Set(current);
      next.add(modelId);
      return next;
    });
  };

  const tryClose = () => {
    if (fetching || busyModelId) return;
    onClose();
  };

  const handleOverlayPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (Date.now() - openedAtRef.current < 400) return;
    if (event.target === event.currentTarget) {
      event.preventDefault();
      tryClose();
    }
  };

  return createPortal(
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onPointerDown={handleOverlayPointerDown}
    >
      <div
        className="modal-content design-llm-fetched-models-dialog"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !fetching && !busyModelId) {
            event.preventDefault();
            tryClose();
          }
        }}
      >
        <div className="modal-header">
          <div className="modal-title">
            <RefreshCw size={20} style={{ color: "var(--accent-acid)" }} />
            {t("design.llmProviderFetchDialogTitle")}
          </div>
          <button type="button" className="modal-close" onClick={() => tryClose()} disabled={!!busyModelId || fetching}>
            <X size={22} />
          </button>
        </div>

        <div className="modal-body">
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.45 }}>
            {t("design.llmProviderFetchDialogDesc")}
          </div>
          {errorMessage ? (
            <div style={{ fontSize: "0.75rem", color: "var(--accent-orange, #e8a040)", lineHeight: 1.45 }}>
              {errorMessage}
            </div>
          ) : null}
          <input
            type="text"
            className="form-input"
            placeholder={t("design.llmProviderFetchDialogFilter")}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            disabled={fetching}
          />
          <div className="design-llm-fetched-models-list">
            {fetching ? (
              <div className="design-llm-fetched-models-empty">
                <Loader2 size={16} className="lf-icon-spin" aria-hidden />
                {t("design.llmProviderRefreshing")}
              </div>
            ) : errorMessage ? (
              <div className="design-llm-fetched-models-empty">{t("design.llmProviderFetchDialogEmpty")}</div>
            ) : visibleModelIds.length === 0 ? (
              <div className="design-llm-fetched-models-empty">{t("design.llmProviderFetchDialogEmpty")}</div>
            ) : (
              visibleModelIds.map((modelId) => {
                const localEntry = localByModelId.get(modelId);
                const isLocal = Boolean(localEntry);
                const rowBusy = busyModelId === modelId;
                return (
                  <div key={modelId} className="design-llm-fetched-models-row">
                    <span className="design-llm-fetched-models-name" title={modelId}>
                      {modelId}
                    </span>
                    <div className="design-llm-fetched-models-actions">
                      <button
                        type="button"
                        className="btn"
                        disabled={isLocal || rowBusy || fetching}
                        title={isLocal ? t("design.llmProviderFetchAlreadyAdded") : t("design.llmProviderFetchAdd")}
                        onClick={() => void onAdd(modelId)}
                      >
                        {rowBusy && !isLocal ? (
                          <Loader2 size={12} className="lf-icon-spin" aria-hidden />
                        ) : (
                          <Plus size={12} />
                        )}
                        {isLocal ? t("design.llmProviderFetchAdded") : t("design.llmProviderFetchAdd")}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={rowBusy || fetching}
                        title={
                          isLocal
                            ? t("design.llmProviderDeleteModel")
                            : t("design.llmProviderFetchDismiss")
                        }
                        onClick={() => {
                          if (isLocal) {
                            void onDelete(modelId);
                          } else {
                            dismissFromList(modelId);
                          }
                        }}
                      >
                        {rowBusy && isLocal ? (
                          <Loader2 size={12} className="lf-icon-spin" aria-hidden />
                        ) : (
                          <Trash2 size={12} />
                        )}
                        {t("design.llmProviderFetchRemove")}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={() => tryClose()} disabled={!!busyModelId || fetching}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
