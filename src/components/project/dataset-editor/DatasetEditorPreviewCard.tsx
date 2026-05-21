import type { Dispatch, SetStateAction } from "react";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Eye,
  ScrollText,
  SidebarOpen,
  StopCircle,
  X,
} from "lucide-react";
import { cancelLlmCaption } from "../../../lib/desktopApi";
import type { DatasetEditorTriggerScope } from "../../../lib/datasetEditorPersistence";
import type { ApiLogEntry, DatasetAsset, DatasetEntry } from "../../../lib/types";
import { useI18n } from "../../../lib/i18n";
import FileAssetImage from "../../FileAssetImage";
import { formatApiLogTime } from "./datasetEditorHelpers";
import type { BatchProgress } from "./datasetEditorTypes";
import { ImageScopePicker } from "./ImageScopePicker";
import type { TriggerScopeFolderOption } from "./TriggerPositionPicker";
import { API_LOG_DRAWER_W, BATCH_FLYOUT_W, PREVIEW_DOCK_PX } from "./layoutConstants";

type Props = {
  asset: DatasetAsset | null;
  imageEntriesLength: number;
  batchTaggingTargetCount: number;
  selectedImageIndex: number;
  previewDockOpen: boolean;
  batchFlyoutOpen: boolean;
  apiLogDrawerOpen: boolean;
  setPreviewDockOpen: (open: boolean) => void;
  setBatchFlyoutOpen: Dispatch<SetStateAction<boolean>>;
  setApiLogDrawerOpen: Dispatch<SetStateAction<boolean>>;
  batchTaggingScope: DatasetEditorTriggerScope;
  setBatchTaggingScope: (scope: DatasetEditorTriggerScope) => void;
  batchTaggingGroupPath: string;
  setBatchTaggingGroupPath: (path: string) => void;
  batchTaggingFolderOptions: TriggerScopeFolderOption[];
  taggingMode: "all" | "range";
  setTaggingMode: (mode: "all" | "range") => void;
  imageRange: string;
  setImageRange: (value: string) => void;
  busy: string | null;
  batchProgress: BatchProgress | null;
  apiLogLines: ApiLogEntry[];
  runBatchTagging: () => Promise<void>;
  refreshApiLogs: () => Promise<void>;
  clearApiLogs: () => Promise<void>;
  previousImage: DatasetEntry | null;
  nextImage: DatasetEntry | null;
  openImage: (relativePath: string) => void;
};

export function DatasetEditorPreviewCard({
  asset,
  imageEntriesLength,
  batchTaggingTargetCount,
  selectedImageIndex,
  previewDockOpen,
  batchFlyoutOpen,
  apiLogDrawerOpen,
  setPreviewDockOpen,
  setBatchFlyoutOpen,
  setApiLogDrawerOpen,
  batchTaggingScope,
  setBatchTaggingScope,
  batchTaggingGroupPath,
  setBatchTaggingGroupPath,
  batchTaggingFolderOptions,
  taggingMode,
  setTaggingMode,
  imageRange,
  setImageRange,
  busy,
  batchProgress,
  apiLogLines,
  runBatchTagging,
  refreshApiLogs,
  clearApiLogs,
  previousImage,
  nextImage,
  openImage,
}: Props) {
  const { t } = useI18n();

  return (
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
                  total: imageEntriesLength,
                })
              : asset.name
            : t("dataset.imageCount", { count: imageEntriesLength })}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "row",
          minWidth: 0,
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            position: "relative",
            overflow: "hidden",
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

          {!previewDockOpen ? (
            <button
              type="button"
              className="btn"
              aria-label={t("dataset.previewDockOpen")}
              title={t("dataset.previewDockOpen")}
              style={{
                position: "absolute",
                right: 0,
                top: "50%",
                transform: "translateY(-50%)",
                width: "22px",
                minWidth: "22px",
                padding: "0.55rem 0",
                borderRadius: "6px 0 0 6px",
                zIndex: 12,
                borderRight: "none",
                justifyContent: "center",
                opacity: imageEntriesLength === 0 ? 0.35 : 1,
              }}
              disabled={imageEntriesLength === 0}
              onClick={() => {
                setPreviewDockOpen(true);
                setBatchFlyoutOpen(true);
                setApiLogDrawerOpen(false);
              }}
            >
              <SidebarOpen size={16} aria-hidden />
            </button>
          ) : null}

          {previewDockOpen && batchFlyoutOpen ? (
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                right: PREVIEW_DOCK_PX,
                width: BATCH_FLYOUT_W,
                maxWidth: `calc(100% - ${PREVIEW_DOCK_PX}px - 0.5rem)`,
                backgroundColor: "var(--bg-card, #1e1e1e)",
                borderLeft: "1px solid var(--border-dim)",
                boxShadow: "-10px 0 28px rgba(0, 0, 0, 0.45)",
                display: "flex",
                flexDirection: "column",
                zIndex: 15,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "0.85rem",
                  borderBottom: "1px solid var(--border-dim)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexShrink: 0,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 600 }}>
                  <Bot size={18} /> {t("dataset.batchTagging")}
                </div>
                <button
                  type="button"
                  className="btn"
                  style={{
                    padding: "0.25rem",
                    border: "none",
                    background: "transparent",
                  }}
                  aria-label={t("dataset.batchFlyoutClose")}
                  title={t("dataset.batchFlyoutClose")}
                  onClick={() => setBatchFlyoutOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>

              <div
                style={{
                  padding: "1rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "1.25rem",
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                }}
              >
                <ImageScopePicker
                  disabled={busy !== null}
                  t={t}
                  config={{
                    mode: batchTaggingScope,
                    onChangeMode: setBatchTaggingScope,
                    groupPath: batchTaggingGroupPath,
                    onChangeGroupPath: setBatchTaggingGroupPath,
                    folderOptions: batchTaggingFolderOptions,
                    targetCount: batchTaggingTargetCount,
                    imageEntriesLength,
                    labelKey: "dataset.batchTaggingScope.label",
                    folderMenuAriaKey: "dataset.batchTaggingScope.folderMenuAria",
                    selectionHintKey: "dataset.batchTaggingScope.selectionHint",
                    targetCountKey: "dataset.batchTaggingScope.targetCount",
                  }}
                />

                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <label className="form-label">{t("dataset.taggingMode")}</label>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: 1.35 }}>
                    {t("dataset.taggingModeHint")}
                  </div>
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
                          taggingMode === "all" ? "var(--text-main)" : "var(--text-muted)",
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
                          taggingMode === "range" ? "var(--text-main)" : "var(--text-muted)",
                      }}
                    >
                      {t("dataset.tagRange")}
                    </button>
                  </div>
                </div>

                {taggingMode === "range" ? (
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
                ) : null}

                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    marginTop: taggingMode === "range" ? 0 : "-0.5rem",
                  }}
                >
                  {t("dataset.totalImagesInScope", { total: batchTaggingTargetCount })}
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

              <div style={{ padding: "1rem", borderTop: "1px solid var(--border-dim)", flexShrink: 0 }}>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ flex: 1, justifyContent: "center", padding: "0.75rem" }}
                    disabled={batchTaggingTargetCount === 0 || busy !== null}
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
          ) : null}

          {previewDockOpen && apiLogDrawerOpen ? (
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                right: PREVIEW_DOCK_PX,
                width: API_LOG_DRAWER_W,
                maxWidth: `calc(100% - ${PREVIEW_DOCK_PX}px - 0.5rem)`,
                backgroundColor: "var(--bg-card, #1e1e1e)",
                borderLeft: "1px solid var(--border-dim)",
                boxShadow: "-12px 0 32px rgba(0, 0, 0, 0.5)",
                display: "flex",
                flexDirection: "column",
                zIndex: 16,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "0.65rem 0.75rem",
                  borderBottom: "1px solid var(--border-dim)",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.45rem",
                  flexShrink: 0,
                }}
              >
                <ScrollText size={17} aria-hidden />
                <span style={{ flex: 1, fontWeight: 600, fontSize: "0.85rem" }}>
                  {t("dataset.apiLogTitle")}
                </span>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "0.2rem 0.45rem", fontSize: "0.72rem" }}
                  onClick={() => void refreshApiLogs()}
                >
                  {t("dataset.apiLogRefresh")}
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "0.2rem 0.45rem", fontSize: "0.72rem" }}
                  onClick={() => void clearApiLogs()}
                >
                  {t("dataset.apiLogClear")}
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "0.2rem", border: "none", background: "transparent" }}
                  aria-label={t("dataset.apiLogClose")}
                  title={t("dataset.apiLogClose")}
                  onClick={() => setApiLogDrawerOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                  padding: "0.5rem 0.65rem",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.72rem",
                  lineHeight: 1.45,
                  color: "var(--text-muted)",
                }}
              >
                {apiLogLines.length === 0 ? (
                  <div>{t("dataset.apiLogEmpty")}</div>
                ) : (
                  apiLogLines.map((line, idx) => (
                    <div
                      key={`${line.createdAt}-${idx}-${line.message.slice(0, 24)}`}
                      style={{ marginBottom: "0.35rem", wordBreak: "break-word" }}
                    >
                      <span style={{ color: "var(--accent-acid)", marginRight: "0.35rem" }}>
                        [{formatApiLogTime(line.createdAt)}]
                      </span>
                      <span style={{ marginRight: "0.35rem", opacity: 0.88 }}>{line.source}</span>
                      <span style={{ marginRight: "0.35rem", opacity: 0.72 }}>{line.level}</span>
                      <span style={{ whiteSpace: "pre-wrap" }}>{line.message}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>

        {previewDockOpen ? (
          <div
            style={{
              width: PREVIEW_DOCK_PX,
              flexShrink: 0,
              borderLeft: "1px solid var(--border-dim)",
              backgroundColor: "color-mix(in srgb, var(--bg-card) 94%, transparent)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0.45rem",
              padding: "0.45rem 0",
              zIndex: 18,
            }}
          >
            <button
              type="button"
              className={`btn ${batchFlyoutOpen ? "btn-primary" : ""}`}
              style={{
                padding: "0.35rem",
                width: "2.25rem",
                justifyContent: "center",
              }}
              title={t("dataset.batchTagging")}
              aria-label={t("dataset.batchTagging")}
              aria-pressed={batchFlyoutOpen}
              onClick={() => {
                setApiLogDrawerOpen(false);
                setBatchFlyoutOpen((open) => !open);
              }}
            >
              <Bot size={18} aria-hidden />
            </button>
            <button
              type="button"
              className={`btn ${apiLogDrawerOpen ? "btn-primary" : ""}`}
              style={{
                padding: "0.35rem",
                width: "2.25rem",
                justifyContent: "center",
              }}
              title={t("dataset.apiLogTitle")}
              aria-label={t("dataset.apiLogTitle")}
              aria-pressed={apiLogDrawerOpen}
              onClick={() => {
                setBatchFlyoutOpen(false);
                setApiLogDrawerOpen((open) => !open);
              }}
            >
              <ScrollText size={18} aria-hidden />
            </button>
            <div style={{ flex: 1, minHeight: "0.25rem" }} />
            <button
              type="button"
              className="btn"
              style={{
                padding: "0.25rem",
                width: "2rem",
                justifyContent: "center",
              }}
              title={t("dataset.previewDockCollapse")}
              aria-label={t("dataset.previewDockCollapse")}
              onClick={() => {
                setPreviewDockOpen(false);
                setBatchFlyoutOpen(false);
                setApiLogDrawerOpen(false);
              }}
            >
              <ChevronRight size={18} aria-hidden />
            </button>
          </div>
        ) : null}
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
      <div
        style={{
          marginTop: "0.65rem",
          fontSize: "0.72rem",
          color: "var(--text-muted)",
          lineHeight: 1.4,
          textAlign: "center",
          maxWidth: "28rem",
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        {t("dataset.imageKeyboardNavHint")}
      </div>
    </div>
  );
}
