import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FolderTree,
  FolderOpen,
  Eye,
  Image,
  Tags,
  Bot,
  Save,
  Trash,
  ChevronLeft,
  ChevronRight,
  X,
  Settings2,
  PlusCircle,
  MinusCircle,
  Loader2,
  StopCircle,
} from "lucide-react";
import {
  autoTagImage,
  cancelLlmCaption,
  deleteDatasetImage,
  getDatasetAsset,
  listDatasetEntries,
  readCaption,
  writeCaption,
} from "../../lib/desktopApi";
import FileAssetImage from "../FileAssetImage";
import { useI18n } from "../../lib/i18n";
import type { DatasetAsset, DatasetEntry } from "../../lib/types";

interface DatasetEditorProps {
  projectId: string;
}

type BatchProgress = {
  /** 1-based position in batch (currently running) */
  current: number;
  total: number;
  currentName: string;
  relativePath: string;
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return fallback;
}

function isCaptionCancelledError(error: unknown): boolean {
  return /LLM caption cancelled/i.test(getErrorMessage(error, ""));
}

/** 1-based image indices, inclusive; clamped to [1, total]. Returns null if input cannot be interpreted. */
function parseBatchImageRange(raw: string, total: number): { start: number; end: number } | null {
  if (total <= 0) return null;
  const s = raw.trim();
  if (!s) return null;

  const full = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (full) {
    let a = parseInt(full[1], 10);
    let b = parseInt(full[2], 10);
    if (a > b) [a, b] = [b, a];
    const start = Math.max(1, Math.min(a, total));
    const end = Math.max(1, Math.min(b, total));
    return start <= end ? { start, end } : { start: end, end: start };
  }

  const startOpen = s.match(/^(\d+)\s*-\s*$/);
  if (startOpen) {
    const a = Math.max(1, Math.min(parseInt(startOpen[1], 10), total));
    return { start: a, end: total };
  }

  const endOpen = s.match(/^-\s*(\d+)$/);
  if (endOpen) {
    const b = Math.max(1, Math.min(parseInt(endOpen[1], 10), total));
    return { start: 1, end: b };
  }

  const single = s.match(/^(\d+)$/);
  if (single) {
    const i = Math.max(1, Math.min(parseInt(single[1], 10), total));
    return { start: i, end: i };
  }

  return null;
}

/** Returns new caption text, or null if file already has `tw` as the first tag. */
function buildCaptionWithTriggerAtFront(existingTrimmed: string, tw: string): string | null {
  if (!tw) return null;
  if (!existingTrimmed) {
    return tw;
  }
  const first = existingTrimmed.split(/[,，]/)[0]?.trim() ?? "";
  if (first === tw) {
    return null;
  }
  return `${tw}, ${existingTrimmed}`;
}

/**
 * Removes every comma/ideographic-comma–separated segment that exactly equals `tw` (after trim).
 * Returns null if the trigger does not appear as its own tag (file unchanged).
 */
function removeTriggerWordFromCaptionAllSegments(existingTrimmed: string, tw: string): string | null {
  if (!tw || !existingTrimmed) {
    return null;
  }
  const parts = existingTrimmed.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  const filtered = parts.filter((segment) => segment !== tw);
  if (filtered.length === parts.length) {
    return null;
  }
  return filtered.join(", ");
}

export default function DatasetEditor({ projectId }: DatasetEditorProps) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<DatasetEntry[]>([]);
  const [asset, setAsset] = useState<DatasetAsset | null>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(-1);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBatchPanel, setShowBatchPanel] = useState(false);
  const [taggingMode, setTaggingMode] = useState<"all" | "range">("all");
  const [imageRange, setImageRange] = useState("");
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [triggerWord, setTriggerWord] = useState("");
  /** Optional text sent to the LLM with the image to reduce mis-tags. */
  const [llmUserHint, setLlmUserHint] = useState("");
  const assetRequestIdRef = useRef(0);

  const loadEntries = useCallback(async () => {
    const datasetEntries = await listDatasetEntries(projectId);
    setEntries(datasetEntries);
    return datasetEntries;
  }, [projectId]);

  const loadAsset = useCallback(
    async (relativePath: string) => {
      const requestId = ++assetRequestIdRef.current;
      const nextAsset = await getDatasetAsset(projectId, relativePath);
      if (requestId !== assetRequestIdRef.current) {
        return nextAsset;
      }
      setAsset(nextAsset);
      setCaption(nextAsset?.caption ?? "");
      setError(null);
      return nextAsset;
    },
    [projectId],
  );

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        await loadEntries();
      } catch (loadError) {
        if (mounted) {
          setError(getErrorMessage(loadError, t("errors.loadDataset")));
        }
      }
    };
    void load();
    return () => {
      mounted = false;
      assetRequestIdRef.current += 1;
    };
  }, [loadEntries]);

  const imageEntries = useMemo(
    () => entries.filter((entry) => entry.kind === "image"),
    [entries],
  );

  const openImage = useCallback((relativePath: string) => {
    setSelectedImageIndex((currentIndex) => {
      const nextIndex = imageEntries.findIndex((entry) => entry.relativePath === relativePath);
      return nextIndex >= 0 ? nextIndex : currentIndex;
    });
  }, [imageEntries]);

  useEffect(() => {
    if (imageEntries.length === 0) {
      assetRequestIdRef.current += 1;
      setSelectedImageIndex(-1);
      setAsset(null);
      setCaption("");
      return;
    }

    setSelectedImageIndex((currentIndex) => {
      if (currentIndex < 0) {
        return 0;
      }
      return Math.min(currentIndex, imageEntries.length - 1);
    });
  }, [imageEntries]);

  const currentImage = selectedImageIndex >= 0 ? imageEntries[selectedImageIndex] ?? null : null;

  const batchRangeHighlight = useMemo(() => {
    if (!showBatchPanel || taggingMode !== "range") return null;
    return parseBatchImageRange(imageRange, imageEntries.length);
  }, [showBatchPanel, taggingMode, imageRange, imageEntries.length]);

  const previousImage = selectedImageIndex > 0 ? imageEntries[selectedImageIndex - 1] : null;
  const nextImage =
    selectedImageIndex >= 0 && selectedImageIndex < imageEntries.length - 1
      ? imageEntries[selectedImageIndex + 1]
      : null;
  useEffect(() => {
    if (!currentImage) {
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const nextAsset = await loadAsset(currentImage.relativePath);
        if (!cancelled && nextAsset) {
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(getErrorMessage(loadError, t("errors.loadImage")));
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [currentImage, loadAsset]);

  const handleSave = async () => {
    if (!asset || !currentImage) return;
    setBusy("save");
    setError(null);
    try {
      await writeCaption(projectId, asset.relativePath, caption);
      await loadAsset(currentImage.relativePath);
    } catch (saveError) {
      setError(getErrorMessage(saveError, t("errors.saveCaption")));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!asset) return;
    setBusy("delete");
    setError(null);
    try {
      const deletedIndex = imageEntries.findIndex((entry) => entry.relativePath === asset.relativePath);
      const nextEntries = await deleteDatasetImage(projectId, asset.relativePath);
      setEntries(nextEntries);
      const nextImageEntries = nextEntries.filter((entry) => entry.kind === "image");
      if (nextImageEntries.length === 0) {
        assetRequestIdRef.current += 1;
        setAsset(null);
        setSelectedImageIndex(-1);
        setCaption("");
        return;
      }

      setSelectedImageIndex(deletedIndex < 0 ? 0 : Math.min(deletedIndex, nextImageEntries.length - 1));
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, t("errors.deleteImage")));
    } finally {
      setBusy(null);
    }
  };

  const applyGeneratedCaption = async () => {
    if (!asset) return;
    setBusy("llm");
    setError(null);
    const hint = llmUserHint.trim();
    try {
      const nextCaption = await autoTagImage(
        projectId,
        asset.relativePath,
        hint.length > 0 ? hint : undefined,
      );
      setCaption(nextCaption);
      try {
        await writeCaption(projectId, asset.relativePath, nextCaption);
        await loadAsset(asset.relativePath);
      } catch (saveError) {
        setError(getErrorMessage(saveError, t("errors.saveCaption")));
      }
    } catch (captionError) {
      if (!isCaptionCancelledError(captionError)) {
        setError(getErrorMessage(captionError, t("errors.generateCaption")));
      }
    } finally {
      setBusy(null);
    }
  };

  const runBatchTagging = useCallback(async () => {
    if (imageEntries.length === 0 || busy !== null) return;

    let targets: DatasetEntry[];
    if (taggingMode === "all") {
      targets = imageEntries;
    } else {
      const range = parseBatchImageRange(imageRange, imageEntries.length);
      if (!range) {
        setError(t("dataset.batchInvalidRange"));
        return;
      }
      targets = imageEntries.slice(range.start - 1, range.end);
    }

    if (targets.length === 0) {
      return;
    }

    setBusy("batch-llm");
    setError(null);
    setBatchProgress(null);

    let ok = 0;
    let fail = 0;
    let lastErr = "";
    let userCancelled = false;

    try {
      for (let i = 0; i < targets.length; i++) {
        const entry = targets[i];
        setBatchProgress({
          current: i + 1,
          total: targets.length,
          currentName: entry.name,
          relativePath: entry.relativePath,
        });

        try {
          const hint = llmUserHint.trim();
          const nextCaption = await autoTagImage(
            projectId,
            entry.relativePath,
            hint.length > 0 ? hint : undefined,
          );
          await writeCaption(projectId, entry.relativePath, nextCaption);
          ok++;
          if (currentImage?.relativePath === entry.relativePath) {
            await loadAsset(entry.relativePath);
          }
        } catch (itemError) {
          if (isCaptionCancelledError(itemError)) {
            userCancelled = true;
            break;
          }
          fail++;
          lastErr = getErrorMessage(itemError, t("errors.generateCaption"));
        }
      }

      if (userCancelled) {
        setError(ok > 0 ? t("dataset.batchTaggingStoppedWithOk", { ok }) : t("dataset.batchTaggingStopped"));
      } else if (fail > 0) {
        const summary = t("dataset.batchTaggingSummary", { ok, fail });
        setError(lastErr ? `${summary} ${lastErr}` : summary);
      }
    } finally {
      setBatchProgress(null);
      setBusy(null);
    }
  }, [
    busy,
    currentImage?.relativePath,
    imageEntries,
    imageRange,
    loadAsset,
    projectId,
    taggingMode,
    t,
    llmUserHint,
  ]);

  const applyTriggerWordToAll = useCallback(async () => {
    const tw = triggerWord.trim();
    if (!tw) {
      setError(t("dataset.triggerWordEmpty"));
      return;
    }
    if (imageEntries.length === 0 || busy !== null) {
      return;
    }

    setBusy("trigger-all");
    setError(null);
    try {
      for (const entry of imageEntries) {
        const raw = await readCaption(projectId, entry.relativePath);
        const trimmed = raw.trim();
        const next = buildCaptionWithTriggerAtFront(trimmed, tw);
        if (next !== null) {
          await writeCaption(projectId, entry.relativePath, next);
        }
      }
      if (currentImage) {
        await loadAsset(currentImage.relativePath);
      }
    } catch (e) {
      setError(getErrorMessage(e, t("errors.applyTriggerWord")));
    } finally {
      setBusy(null);
    }
  }, [busy, currentImage, imageEntries, loadAsset, projectId, t, triggerWord]);

  const removeTriggerWordFromAll = useCallback(async () => {
    const tw = triggerWord.trim();
    if (!tw) {
      setError(t("dataset.triggerWordEmpty"));
      return;
    }
    if (imageEntries.length === 0 || busy !== null) {
      return;
    }

    setBusy("trigger-remove");
    setError(null);
    try {
      for (const entry of imageEntries) {
        const raw = await readCaption(projectId, entry.relativePath);
        const trimmed = raw.trim();
        const next = removeTriggerWordFromCaptionAllSegments(trimmed, tw);
        if (next !== null) {
          await writeCaption(projectId, entry.relativePath, next);
        }
      }
      if (currentImage) {
        await loadAsset(currentImage.relativePath);
      }
    } catch (e) {
      setError(getErrorMessage(e, t("errors.removeTriggerWord")));
    } finally {
      setBusy(null);
    }
  }, [busy, currentImage, imageEntries, loadAsset, projectId, t, triggerWord]);

  return (
    <div className="bento bento-detail view-dataset">
      <div className="card" style={{ gridColumn: "span 3", gridRow: "span 3", animationDelay: "0s" }}>
        <div className="card-header">
          <span className="card-title-icon">
            <FolderTree size={18} /> {t("dataset.fileSystem")}
          </span>
        </div>
        <div
          className="dataset-tree"
          style={{
            flex: 1,
            overflowY: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: "0.85rem",
            color: "var(--text-muted)",
            display: "flex",
            flexDirection: "column",
            gap: "0.45rem",
          }}
        >
          <div
            style={{
              color: "var(--accent-acid)",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <FolderOpen size={16} /> dataset/
          </div>
          {imageEntries.length === 0 ? (
            <div style={{ paddingLeft: "1.5rem" }}>{t("dataset.empty")}</div>
          ) : null}
          {imageEntries.map((entry, imageIndex) => {
            const oneBased = imageIndex + 1;
            const inBatchRange =
              batchRangeHighlight !== null &&
              oneBased >= batchRangeHighlight.start &&
              oneBased <= batchRangeHighlight.end;
            const isSelected = entry.relativePath === asset?.relativePath;
            const isBatchWorking =
              busy === "batch-llm" &&
              batchProgress !== null &&
              entry.relativePath === batchProgress.relativePath;
            return (
              <div
                key={entry.relativePath}
                onClick={() => {
                  void openImage(entry.relativePath);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  paddingLeft: `${1.25 + entry.depth * 1.2}rem`,
                  paddingRight: "0.35rem",
                  marginRight: "0.25rem",
                  borderRadius: "4px",
                  cursor: "pointer",
                  color: isSelected ? "var(--text-main)" : undefined,
                  backgroundColor: isBatchWorking
                    ? "color-mix(in srgb, var(--accent-orange) 22%, transparent)"
                    : inBatchRange
                      ? "color-mix(in srgb, var(--accent-acid) 20%, transparent)"
                      : undefined,
                  boxShadow: isBatchWorking
                    ? "inset 3px 0 0 var(--accent-orange)"
                    : inBatchRange
                      ? "inset 3px 0 0 var(--accent-acid)"
                      : undefined,
                }}
              >
                <Image size={14} />
                {entry.name}
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="card"
        style={{
          gridColumn: "span 6",
          gridRow: "span 3",
          animationDelay: "0.04s",
        }}
      >
        <div className="card-header">
          <span className="card-title-icon">
            <Eye size={18} /> {t("dataset.imagePreview")}
          </span>
          <span>
            {asset
              ? selectedImageIndex >= 0
                ? t("dataset.imageCounter", {
                    name: asset.name,
                    current: selectedImageIndex + 1,
                    total: imageEntries.length,
                  })
                : asset.name
              : t("dataset.imageCount", { count: imageEntries.length })}
          </span>
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            position: "relative",
            overflow: "visible",
          }}
        >
          <FileAssetImage
            filePath={asset?.filePath}
            alt={asset?.name ?? t("dataset.datasetPreviewAlt")}
            fit="contain"
            placeholderIconSize={64}
            showOverlay
            style={{
              width: "100%",
              height: "100%",
              border: "1px solid var(--border-dim)",
            }}
          />

          {showBatchPanel && (
            <div
              style={{
                position: "absolute",
                top: "0.75rem",
                right: 0,
                width: "320px",
                maxWidth: "calc(100% - 1rem)",
                backgroundColor: "var(--bg-card, #1e1e1e)",
                border: "1px solid var(--border-dim)",
                borderRadius: "8px",
                boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
                display: "flex",
                flexDirection: "column",
                zIndex: 10,
              }}
            >
              <div style={{ padding: "1rem", borderBottom: "1px solid var(--border-dim)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 600 }}>
                  <Bot size={18} /> {t("dataset.batchTagging")}
                </div>
                <button 
                  className="btn" 
                  style={{ padding: "0.25rem", border: "none", background: "transparent", opacity: busy === "batch-llm" ? 0.35 : 1 }} 
                  disabled={busy === "batch-llm"}
                  onClick={() => setShowBatchPanel(false)}
                >
                  <X size={16} />
                </button>
              </div>
              
              <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <label className="form-label">{t("dataset.taggingMode")}</label>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "0.5rem",
                    }}
                  >
                    <button
                      type="button"
                      className="btn"
                      aria-pressed={taggingMode === "all"}
                      disabled={busy !== null}
                      onClick={() => setTaggingMode("all")}
                      style={{
                        justifyContent: "center",
                        padding: "0.75rem",
                        borderColor:
                          taggingMode === "all" ? "var(--accent-acid)" : "var(--border-dim)",
                        background:
                          taggingMode === "all"
                            ? "color-mix(in srgb, var(--accent-acid) 14%, transparent)"
                            : "transparent",
                        color:
                          taggingMode === "all"
                            ? "var(--text-main)"
                            : "var(--text-muted)",
                      }}
                    >
                      {t("dataset.tagAll")}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      aria-pressed={taggingMode === "range"}
                      disabled={busy !== null}
                      onClick={() => setTaggingMode("range")}
                      style={{
                        justifyContent: "center",
                        padding: "0.75rem",
                        borderColor:
                          taggingMode === "range" ? "var(--accent-acid)" : "var(--border-dim)",
                        background:
                          taggingMode === "range"
                            ? "color-mix(in srgb, var(--accent-acid) 14%, transparent)"
                            : "transparent",
                        color:
                          taggingMode === "range"
                            ? "var(--text-main)"
                            : "var(--text-muted)",
                      }}
                    >
                      {t("dataset.tagRange")}
                    </button>
                  </div>
                </div>
                
                {taggingMode === "range" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <label className="form-label">{t("dataset.imageRange")}</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder="1-100" 
                      value={imageRange}
                      disabled={busy !== null}
                      onChange={(e) => setImageRange(e.target.value)}
                    />
                  </div>
                )}
                
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: taggingMode === "range" ? 0 : "-0.5rem" }}>
                  {t("dataset.totalImages", { total: imageEntries.length })}
                </div>

                {batchProgress ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-main)", fontWeight: 500 }}>
                      {t("dataset.batchTaggingProgress", {
                        current: batchProgress.current,
                        total: batchProgress.total,
                      })}
                    </div>
                    <div
                      style={{
                        height: "6px",
                        borderRadius: "3px",
                        backgroundColor: "color-mix(in srgb, var(--text-muted) 28%, transparent)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${
                            batchProgress.total > 0
                              ? (batchProgress.current / batchProgress.total) * 100
                              : 0
                          }%`,
                          backgroundColor: "var(--accent-acid)",
                          transition: "width 0.2s ease-out",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        fontSize: "0.72rem",
                        color: "var(--text-muted)",
                        wordBreak: "break-all",
                        lineHeight: 1.35,
                      }}
                    >
                      {t("dataset.batchTaggingCurrent", { name: batchProgress.currentName })}
                    </div>
                  </div>
                ) : null}
              </div>
              
              <div style={{ padding: "1rem", borderTop: "1px solid var(--border-dim)" }}>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ flex: 1, justifyContent: "center", padding: "0.75rem" }}
                    disabled={
                      imageEntries.length === 0 || (busy !== null && busy !== "batch-llm")
                    }
                    onClick={() => void runBatchTagging()}
                  >
                    <Bot size={18} style={{ marginRight: "0.5rem" }} />{" "}
                    {busy === "batch-llm" ? t("dataset.batchTaggingRunning") : t("dataset.startBatchTagging")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{
                      justifyContent: "center",
                      padding: "0 0.85rem",
                      flexShrink: 0,
                      minWidth: "3rem",
                    }}
                    title={t("dataset.stopLlmCaption")}
                    aria-label={t("dataset.stopLlmCaption")}
                    disabled={busy !== "batch-llm"}
                    onClick={() => {
                      void cancelLlmCaption();
                    }}
                  >
                    <StopCircle size={20} aria-hidden />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "1rem",
            marginTop: "1rem",
          }}
        >
          <button
            type="button"
            className="btn"
            style={{ padding: "0.5rem 1rem" }}
            disabled={!previousImage}
            aria-label={t("dataset.prevImage")}
            title={t("dataset.prevImage")}
            onClick={() => {
              if (previousImage) {
                void openImage(previousImage.relativePath);
              }
            }}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="btn"
            style={{ padding: "0.5rem 1rem" }}
            disabled={!nextImage}
            aria-label={t("dataset.nextImage")}
            title={t("dataset.nextImage")}
            onClick={() => {
              if (nextImage) {
                void openImage(nextImage.relativePath);
              }
            }}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="card" style={{ gridColumn: "span 3", gridRow: "span 3", animationDelay: "0.08s" }}>
        <div className="card-header">
          <span className="card-title-icon">
            <Tags size={18} /> {t("dataset.captionsAndTags")}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            flex: 1,
          }}
        >
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
            <button
              className="btn btn-primary"
              style={{ flex: 1, justifyContent: "center", padding: "0.75rem" }}
              disabled={!asset || (busy !== null && busy !== "llm")}
              onClick={() => void applyGeneratedCaption()}
            >
              <Bot size={18} /> {busy === "llm" ? t("dataset.running") : t("dataset.autoTag")}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              style={{ justifyContent: "center", padding: "0 0.85rem", flexShrink: 0, minWidth: "3rem" }}
              title={t("dataset.stopLlmCaption")}
              aria-label={t("dataset.stopLlmCaption")}
              disabled={busy !== "llm"}
              onClick={() => {
                void cancelLlmCaption();
              }}
            >
              <StopCircle size={20} aria-hidden />
            </button>
            <button
              className={`btn ${showBatchPanel ? "btn-primary" : ""}`}
              style={{ padding: "0.75rem", justifyContent: "center", width: "3rem" }}
              title={t("dataset.batchTaggingSettings")}
              onClick={() => setShowBatchPanel(!showBatchPanel)}
            >
              <Settings2 size={18} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label className="form-label">{t("dataset.llmUserHintLabel")}</label>
            <textarea
              className="form-input"
              style={{ minHeight: "4.5rem", resize: "vertical" }}
              placeholder={t("dataset.llmUserHintPlaceholder")}
              value={llmUserHint}
              disabled={busy !== null}
              onChange={(e) => setLlmUserHint(e.target.value)}
              spellCheck
            />
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: 1.35 }}>
              {t("dataset.llmUserHintDesc")}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label className="form-label">{t("dataset.triggerWord")}</label>
            <div style={{ display: "flex", alignItems: "stretch", gap: "0.5rem" }}>
              <input
                type="text"
                className="form-input"
                style={{ flex: 1, minWidth: 0 }}
                placeholder={t("dataset.triggerWordPlaceholder")}
                value={triggerWord}
                disabled={busy !== null}
                onChange={(e) => setTriggerWord(e.target.value)}
                autoComplete="off"
              />
              <button
                type="button"
                className="btn btn-primary"
                style={{
                  justifyContent: "center",
                  padding: "0 0.65rem",
                  flexShrink: 0,
                  alignSelf: "stretch",
                  minWidth: "2.75rem",
                }}
                aria-label={t("dataset.applyTriggerWordAll")}
                title={t("dataset.applyTriggerWordAll")}
                disabled={imageEntries.length === 0 || busy !== null || !triggerWord.trim()}
                onClick={() => void applyTriggerWordToAll()}
              >
                {busy === "trigger-all" ? (
                  <Loader2 size={18} className="lf-icon-spin" aria-hidden />
                ) : (
                  <PlusCircle size={18} aria-hidden />
                )}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                style={{
                  justifyContent: "center",
                  padding: "0 0.65rem",
                  flexShrink: 0,
                  alignSelf: "stretch",
                  minWidth: "2.75rem",
                }}
                aria-label={t("dataset.removeTriggerWordAll")}
                title={t("dataset.removeTriggerWordAll")}
                disabled={imageEntries.length === 0 || busy !== null || !triggerWord.trim()}
                onClick={() => void removeTriggerWordFromAll()}
              >
                {busy === "trigger-remove" ? (
                  <Loader2 size={18} className="lf-icon-spin" aria-hidden />
                ) : (
                  <MinusCircle size={18} aria-hidden />
                )}
              </button>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label className="form-label" style={{ marginTop: "0.5rem" }}>
              {t("dataset.rawTagText")}
            </label>
            <textarea
              className="form-input"
              style={{
                flex: 1,
                resize: "none",
                fontFamily: "var(--font-mono)",
                fontSize: "0.85rem",
                lineHeight: 1.5,
                padding: "1rem",
              }}
              placeholder={t("dataset.rawTagPlaceholder")}
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              className="btn btn-primary"
              style={{ flex: 1, justifyContent: "center", padding: "0.5rem" }}
              disabled={!asset || busy !== null}
              onClick={() => void handleSave()}
            >
              <Save size={16} /> {busy === "save" ? t("dataset.saving") : t("dataset.save")}
            </button>
            <button
              className="btn btn-danger"
              style={{ justifyContent: "center", padding: "0.5rem", marginLeft: 0 }}
              disabled={!asset || busy !== null}
              aria-label={t("dataset.delete")}
              title={t("dataset.delete")}
              onClick={() => void handleDelete()}
            >
              <Trash size={16} />
            </button>
          </div>
          {error ? (
            <div style={{ color: "var(--accent-orange)", fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
