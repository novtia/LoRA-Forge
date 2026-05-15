import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, FileImage, FolderOpen, RefreshCw, SlidersHorizontal } from "lucide-react";
import { listSampleImages } from "../../lib/desktopApi";
import { useI18n } from "../../lib/i18n";
import type { SampleImageEntry, TrainingConfig } from "../../lib/types";
import FileAssetImage from "../FileAssetImage";

interface SampleImageViewerProps {
  projectId: string;
  config: TrainingConfig;
  isTrainingActive: boolean;
}

function getPromptLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function SampleImageViewer({ projectId, config, isTrainingActive }: SampleImageViewerProps) {
  const { t, formatRelativeTime } = useI18n();
  const [entries, setEntries] = useState<SampleImageEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    setBusy(true);
    try {
      const nextEntries = await listSampleImages(projectId);
      setEntries(nextEntries);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("errors.loadDataset"));
    } finally {
      setBusy(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    if (!isTrainingActive) {
      return;
    }
    const interval = window.setInterval(() => {
      void loadEntries();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [isTrainingActive, loadEntries]);

  useEffect(() => {
    if (entries.length === 0) {
      setSelectedPath(null);
      return;
    }
    setSelectedPath((current) =>
      current && entries.some((entry) => entry.relativePath === current) ? current : entries[0].relativePath,
    );
  }, [entries]);

  const selectedIndex = entries.findIndex((entry) => entry.relativePath === selectedPath);
  const selectedImage = selectedIndex >= 0 ? entries[selectedIndex] ?? null : null;
  const previousImage = selectedIndex > 0 ? entries[selectedIndex - 1] : null;
  const nextImage = selectedIndex >= 0 && selectedIndex < entries.length - 1 ? entries[selectedIndex + 1] : null;

  const promptLines = useMemo(() => getPromptLines(config.samplePrompts), [config.samplePrompts]);
  const parameterItems = useMemo(
    () => [
      { key: t("projectDetail.samplePromptCount"), val: String(promptLines.length) },
      { key: t("config.samplePrompts"), val: promptLines[0] ?? "-" },
      { key: t("config.sampleNegativePrompt"), val: config.sampleNegativePrompt.trim() || "-" },
      { key: t("config.sampleSize"), val: `${config.sampleWidth}x${config.sampleHeight}` },
      { key: t("config.sampleSteps"), val: String(config.sampleSteps) },
      { key: t("config.sampleCfgScale"), val: config.sampleCfgScale },
      { key: t("config.sampleSampler"), val: config.sampleSampler },
      { key: t("config.sampleSeed"), val: String(config.sampleSeed) },
      { key: t("config.sampleEveryNSteps"), val: String(config.sampleEveryNSteps || 0) },
      { key: t("config.sampleEveryNEpochs"), val: String(config.sampleEveryNEpochs || 0) },
      {
        key: t("config.sampleAtFirst"),
        val: config.sampleAtFirst ? t("common.true") : t("common.false"),
        plain: true,
      },
    ],
    [config, promptLines, t],
  );

  return (
    <div className="bento bento-detail view-dataset">
      <div className="card" style={{ gridColumn: "span 2", gridRow: "span 3", animationDelay: "0s" }}>
        <div className="card-header">
          <span className="card-title-icon">
            <FolderOpen size={18} /> {t("projectDetail.sampleDirectory")}
          </span>
          <span>{t("dataset.imageCount", { count: entries.length })}</span>
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
            <FolderOpen size={16} /> sample/
          </div>
          {entries.length === 0 ? <div style={{ paddingLeft: "1.5rem" }}>{t("projectDetail.sampleEmpty")}</div> : null}
          {entries.map((entry) => (
            <div
              key={entry.relativePath}
              onClick={() => setSelectedPath(entry.relativePath)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                paddingLeft: `${1.25 + entry.depth * 1.2}rem`,
                cursor: "pointer",
                color: entry.relativePath === selectedImage?.relativePath ? "var(--text-main)" : undefined,
              }}
            >
              <FileImage size={14} />
              {entry.name}
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ gridColumn: "span 6", gridRow: "span 3", animationDelay: "0.04s" }}>
        <div className="card-header">
          <span className="card-title-icon">
            <Eye size={18} /> {t("projectDetail.samplePreview")}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span>
              {selectedImage
                ? t("dataset.imageCounter", {
                    name: selectedImage.name,
                    current: selectedIndex + 1,
                    total: entries.length,
                  })
                : t("dataset.imageCount", { count: entries.length })}
            </span>
            <button
              type="button"
              className="btn"
              style={{ padding: "0.4rem 0.8rem" }}
              onClick={() => void loadEntries()}
              disabled={busy}
            >
              <RefreshCw size={16} /> {t("projectDetail.sampleRefresh")}
            </button>
          </div>
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
            filePath={selectedImage?.filePath}
            alt={selectedImage?.name ?? t("projectDetail.samplePreviewPlaceholder")}
            fit="contain"
            placeholderIconSize={64}
            showOverlay
            style={{
              width: "100%",
              height: "100%",
              border: "1px solid var(--border-dim)",
            }}
          />
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
            onClick={() => previousImage && setSelectedPath(previousImage.relativePath)}
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
            onClick={() => nextImage && setSelectedPath(nextImage.relativePath)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="card" style={{ gridColumn: "span 4", gridRow: "span 3", animationDelay: "0.08s" }}>
        <div className="card-header">
          <span className="card-title-icon">
            <SlidersHorizontal size={18} /> {t("projectDetail.sampleParameters")}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", flex: 1, minHeight: 0 }}>
          <div className="config-list" style={{ maxHeight: "100%", overflowY: "auto" }}>
            <div className="config-item">
              <span className="key">{t("projectDetail.sampleFile")}</span>
              <span className="val">{selectedImage?.name ?? "-"}</span>
            </div>
            <div className="config-item">
              <span className="key">{t("projectDetail.sampleUpdatedAt")}</span>
              <span className="val">
                {selectedImage ? formatRelativeTime(selectedImage.modifiedAt * 1000) : "-"}
              </span>
            </div>
            {parameterItems.map((item) => (
              <div key={item.key} className="config-item">
                <span className="key">{item.key}</span>
                <span className="val" style={item.plain ? { color: "var(--text-main)" } : undefined}>
                  {item.val}
                </span>
              </div>
            ))}
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
