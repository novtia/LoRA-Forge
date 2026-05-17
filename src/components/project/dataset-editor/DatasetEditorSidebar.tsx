import type { MouseEvent as ReactMouseEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Image,
} from "lucide-react";
import { useI18n } from "../../../lib/i18n";
import type { DatasetEntry } from "../../../lib/types";
import type { DatasetTreeNode } from "./datasetTree";
import type { BatchProgress } from "./datasetEditorTypes";

type Props = {
  busy: string | null;
  imageEntries: DatasetEntry[];
  datasetTree: DatasetTreeNode[];
  visibleTreeRows: DatasetTreeNode[];
  expandedDirs: Set<string>;
  selectedImagePaths: Set<string>;
  assetRelativePath: string | undefined;
  batchRangeHighlight: { start: number; end: number } | null;
  batchProgress: BatchProgress | null;
  onToolbarCreateGroup: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onToggleDirectory: (path: string) => void;
  onImageRowClick: (relativePath: string, ev: ReactMouseEvent) => void;
  onImageRowContextMenu: (ev: ReactMouseEvent, relativePath: string) => void;
  onDirectoryRowContextMenu: (ev: ReactMouseEvent, relativePath: string) => void;
  onBackgroundContextMenu: (ev: ReactMouseEvent) => void;
};

export function DatasetEditorSidebar({
  busy,
  imageEntries,
  datasetTree,
  visibleTreeRows,
  expandedDirs,
  selectedImagePaths,
  assetRelativePath,
  batchRangeHighlight,
  batchProgress,
  onToolbarCreateGroup,
  onExpandAll,
  onCollapseAll,
  onToggleDirectory,
  onImageRowClick,
  onImageRowContextMenu,
  onDirectoryRowContextMenu,
  onBackgroundContextMenu,
}: Props) {
  const { t } = useI18n();

  return (
    <div className="card" style={{ gridColumn: "span 2", gridRow: "span 3", animationDelay: "0s" }}>
      <div className="card-header" style={{ flexWrap: "wrap", gap: "0.4rem" }}>
        <span className="card-title-icon">
          <FolderTree size={18} /> {t("dataset.fileSystem")}
        </span>
        <span
          style={{
            fontSize: "0.7rem",
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {selectedImagePaths.size > 0
            ? t("dataset.selectionCount", { count: selectedImagePaths.size })
            : t("dataset.imageCount", { count: imageEntries.length })}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.3rem",
          padding: "0 0.25rem 0.4rem",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className="btn"
          style={{ padding: "0.2rem 0.45rem", fontSize: "0.72rem" }}
          title={t("dataset.groupCreate")}
          aria-label={t("dataset.groupCreate")}
          disabled={busy !== null || selectedImagePaths.size === 0}
          onClick={onToolbarCreateGroup}
        >
          <FolderPlus size={13} aria-hidden style={{ marginRight: "0.3rem" }} />
          {t("dataset.groupCreate")}
        </button>
        <button
          type="button"
          className="btn"
          style={{ padding: "0.2rem 0.45rem", fontSize: "0.72rem" }}
          title={t("dataset.treeExpandAll")}
          aria-label={t("dataset.treeExpandAll")}
          disabled={datasetTree.length === 0}
          onClick={onExpandAll}
        >
          <ChevronDown size={13} aria-hidden />
        </button>
        <button
          type="button"
          className="btn"
          style={{ padding: "0.2rem 0.45rem", fontSize: "0.72rem" }}
          title={t("dataset.treeCollapseAll")}
          aria-label={t("dataset.treeCollapseAll")}
          disabled={expandedDirs.size === 0}
          onClick={onCollapseAll}
        >
          <ChevronRight size={13} aria-hidden />
        </button>
      </div>

      <div
        className="dataset-tree"
        onContextMenu={(ev) => {
          if (ev.target === ev.currentTarget) {
            ev.preventDefault();
            onBackgroundContextMenu(ev);
          }
        }}
        style={{
          flex: 1,
          overflowY: "auto",
          fontFamily: "var(--font-mono)",
          fontSize: "0.85rem",
          color: "var(--text-muted)",
          display: "flex",
          flexDirection: "column",
          gap: "0.15rem",
        }}
      >
        <div
          onContextMenu={(ev) => {
            ev.preventDefault();
            onBackgroundContextMenu(ev);
          }}
          style={{
            color: "var(--accent-acid)",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.15rem 0.25rem",
            marginBottom: "0.2rem",
          }}
        >
          <FolderOpen size={16} /> dataset/
        </div>
        {imageEntries.length === 0 ? (
          <div style={{ paddingLeft: "1.5rem" }}>{t("dataset.empty")}</div>
        ) : null}
        {visibleTreeRows.map((node) => {
          const depthPad = `${0.6 + node.depth * 0.85}rem`;
          if (node.kind === "directory") {
            const isExpanded = expandedDirs.has(node.relativePath);
            return (
              <div
                key={`d:${node.relativePath}`}
                onClick={() => onToggleDirectory(node.relativePath)}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  onDirectoryRowContextMenu(ev, node.relativePath);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  paddingLeft: depthPad,
                  paddingRight: "0.35rem",
                  paddingTop: "0.15rem",
                  paddingBottom: "0.15rem",
                  marginRight: "0.25rem",
                  borderRadius: "4px",
                  cursor: "pointer",
                  color: "var(--text-main)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background =
                    "color-mix(in srgb, var(--accent-acid) 10%, transparent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                {isExpanded ? (
                  <ChevronDown size={12} aria-hidden />
                ) : (
                  <ChevronRight size={12} aria-hidden />
                )}
                {isExpanded ? (
                  <FolderOpen size={14} aria-hidden />
                ) : (
                  <Folder size={14} aria-hidden />
                )}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {node.name}/
                </span>
              </div>
            );
          }

          const entry = node.entry!;
          const imageIndex = imageEntries.findIndex((e) => e.relativePath === entry.relativePath);
          const oneBased = imageIndex + 1;
          const inBatchRange =
            batchRangeHighlight !== null &&
            oneBased >= batchRangeHighlight.start &&
            oneBased <= batchRangeHighlight.end;
          const isActive = entry.relativePath === assetRelativePath;
          const isMultiSelected = selectedImagePaths.has(entry.relativePath);
          const isBatchWorking =
            busy === "batch-llm" &&
            batchProgress !== null &&
            entry.relativePath === batchProgress.relativePath;

          return (
            <div
              key={`i:${entry.relativePath}`}
              onClick={(ev) => onImageRowClick(entry.relativePath, ev)}
              onContextMenu={(ev) => onImageRowContextMenu(ev, entry.relativePath)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                paddingLeft: `calc(${depthPad} + 0.65rem)`,
                paddingRight: "0.35rem",
                paddingTop: "0.15rem",
                paddingBottom: "0.15rem",
                marginRight: "0.25rem",
                borderRadius: "4px",
                cursor: "pointer",
                color: isActive || isMultiSelected ? "var(--text-main)" : undefined,
                backgroundColor: isBatchWorking
                  ? "color-mix(in srgb, var(--accent-orange) 22%, transparent)"
                  : isMultiSelected
                    ? "color-mix(in srgb, var(--accent-acid) 24%, transparent)"
                    : inBatchRange
                      ? "color-mix(in srgb, var(--accent-acid) 14%, transparent)"
                      : undefined,
                boxShadow: isBatchWorking
                  ? "inset 3px 0 0 var(--accent-orange)"
                  : isActive
                    ? "inset 3px 0 0 var(--accent-acid)"
                    : inBatchRange
                      ? "inset 3px 0 0 var(--accent-acid)"
                      : undefined,
              }}
            >
              <Image size={13} />
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                }}
                title={entry.relativePath}
              >
                {entry.name}
              </span>
            </div>
          );
        })}
        <div
          style={{
            marginTop: "0.5rem",
            padding: "0.3rem 0.45rem 0",
            fontSize: "0.65rem",
            color: "var(--text-muted)",
            lineHeight: 1.4,
          }}
        >
          {t("dataset.treeHintMultiSelect")}
        </div>
      </div>
    </div>
  );
}
