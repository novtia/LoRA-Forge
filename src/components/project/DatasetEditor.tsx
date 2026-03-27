import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FolderTree,
  FolderOpen,
  Folder,
  Eye,
  Image,
  Tags,
  Bot,
  Wand2,
  Save,
  Trash,
  ChevronLeft,
  ChevronRight,
  X,
  Settings2,
} from "lucide-react";
import {
  autoTagImage,
  deleteDatasetImage,
  getDatasetAsset,
  interrogateImage,
  listDatasetEntries,
  writeCaption,
} from "../../lib/desktopApi";
import FileAssetImage from "../FileAssetImage";
import { useI18n } from "../../lib/i18n";
import type { DatasetAsset, DatasetEntry } from "../../lib/types";

interface DatasetEditorProps {
  projectId: string;
}

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

  const applyGeneratedCaption = async (mode: "llm" | "wd14") => {
    if (!asset) return;
    setBusy(mode);
    setError(null);
    try {
      const nextCaption =
        mode === "llm"
          ? await autoTagImage(projectId, asset.relativePath)
          : await interrogateImage(projectId, asset.relativePath);
      setCaption(nextCaption);
    } catch (captionError) {
      setError(getErrorMessage(captionError, t("errors.generateCaption")));
    } finally {
      setBusy(null);
    }
  };

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
          {imageEntries.map((entry) => (
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
                cursor: "pointer",
                color: entry.relativePath === asset?.relativePath ? "var(--text-main)" : undefined,
              }}
            >
              <Image size={14} />
              {entry.name}
            </div>
          ))}
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
                  style={{ padding: "0.25rem", border: "none", background: "transparent" }} 
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
                      onChange={(e) => setImageRange(e.target.value)}
                    />
                  </div>
                )}
                
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: taggingMode === "range" ? 0 : "-0.5rem" }}>
                  {t("dataset.totalImages", { total: imageEntries.length })}
                </div>
              </div>
              
              <div style={{ padding: "1rem", borderTop: "1px solid var(--border-dim)" }}>
                <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", padding: "0.75rem" }}>
                  <Bot size={18} style={{ marginRight: "0.5rem" }}/> {t("dataset.startBatchTagging")}
                </button>
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
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              className="btn btn-primary"
              style={{ flex: 1, justifyContent: "center", padding: "0.75rem" }}
              disabled={!asset || busy !== null}
              onClick={() => void applyGeneratedCaption("llm")}
            >
              <Bot size={18} /> {busy === "llm" ? t("dataset.running") : t("dataset.autoTag")}
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
          <button
            className="btn"
            style={{ justifyContent: "center", padding: "0.75rem" }}
            disabled={!asset || busy !== null}
            onClick={() => void applyGeneratedCaption("wd14")}
          >
            <Wand2 size={18} /> {busy === "wd14" ? t("dataset.running") : t("dataset.interrogateWd14")}
          </button>
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
