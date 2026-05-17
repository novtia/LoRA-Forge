import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import { useRef, useState } from "react";
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
import { parentRelativePath } from "./datasetTree";
import type { BatchProgress } from "./datasetEditorTypes";

const DATASET_IMAGE_DRAG_TYPE = "application/x-dataset-editor-image-paths";

function parseDatasetImageDragPaths(dataTransfer: DataTransfer): string[] | null {
  const raw = dataTransfer.getData(DATASET_IMAGE_DRAG_TYPE) || dataTransfer.getData("text/plain");
  if (!raw?.trim()) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || !("paths" in v)) return null;
    const pathsRaw = (v as { paths?: unknown }).paths;
    if (!Array.isArray(pathsRaw)) return null;
    const paths = pathsRaw.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
    return paths.length > 0 ? paths : null;
  } catch {
    return null;
  }
}

function dragPathsWouldChangeParent(paths: string[], targetRelativePath: string): boolean {
  const target = targetRelativePath.replace(/^\/+|\/+$/g, "");
  return paths.some((p) => parentRelativePath(p) !== target);
}

type FolderDropHighlight =
  | null
  | { kind: "root" }
  | { kind: "directory"; path: string };

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
  onMoveImagesToFolder: (paths: string[], targetRelativePath: string) => void;
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
  onMoveImagesToFolder,
  onImageRowClick,
  onImageRowContextMenu,
  onDirectoryRowContextMenu,
  onBackgroundContextMenu,
}: Props) {
  const { t } = useI18n();
  const [dropHighlight, setDropHighlight] = useState<FolderDropHighlight>(null);
  const canDragFromSidebar = busy === null;
  /** WebView2/Chromium needs dropEffect set on dragover; track our drag so gaps & image rows stay "move". */
  const internalImageDragActiveRef = useRef(false);

  const applySidebarDragDropEffect = (ev: ReactDragEvent) => {
    const allow =
      canDragFromSidebar &&
      internalImageDragActiveRef.current &&
      imageEntries.length > 0;
    ev.dataTransfer.dropEffect = allow ? "move" : "none";
  };

  const clearDropHighlightIfLeaving = (
    ev: ReactDragEvent,
    matches: (h: Exclude<FolderDropHighlight, null>) => boolean,
  ) => {
    const next = ev.relatedTarget;
    if (next instanceof Node && ev.currentTarget.contains(next)) return;
    setDropHighlight((h) => {
      if (h === null) return h;
      return matches(h) ? null : h;
    });
  };

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
        onDragOver={(ev) => {
          ev.preventDefault();
          applySidebarDragDropEffect(ev);
        }}
        onDragLeave={(ev) => {
          const next = ev.relatedTarget;
          if (next instanceof Node && ev.currentTarget.contains(next)) return;
          setDropHighlight(null);
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
          onDragOver={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (imageEntries.length === 0 || !canDragFromSidebar) {
              ev.dataTransfer.dropEffect = "none";
              return;
            }
            if (!internalImageDragActiveRef.current) {
              ev.dataTransfer.dropEffect = "none";
              return;
            }
            ev.dataTransfer.dropEffect = "move";
            setDropHighlight({ kind: "root" });
          }}
          onDragLeave={(ev) => clearDropHighlightIfLeaving(ev, (h) => h.kind === "root")}
          onDrop={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            setDropHighlight(null);
            const paths = parseDatasetImageDragPaths(ev.dataTransfer);
            if (!paths || !dragPathsWouldChangeParent(paths, "")) return;
            onMoveImagesToFolder(paths, "");
          }}
          style={{
            color: "var(--accent-acid)",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.15rem 0.25rem",
            marginBottom: "0.2rem",
            borderRadius: "4px",
            outline:
              dropHighlight?.kind === "root"
                ? "2px solid var(--accent-acid)"
                : undefined,
            outlineOffset: dropHighlight?.kind === "root" ? "1px" : undefined,
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
            const isDirDrop =
              dropHighlight?.kind === "directory" && dropHighlight.path === node.relativePath;
            return (
              <div
                key={`d:${node.relativePath}`}
                onClick={() => onToggleDirectory(node.relativePath)}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  onDirectoryRowContextMenu(ev, node.relativePath);
                }}
                onDragOver={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  if (!canDragFromSidebar) {
                    ev.dataTransfer.dropEffect = "none";
                    return;
                  }
                  if (!internalImageDragActiveRef.current) {
                    ev.dataTransfer.dropEffect = "none";
                    return;
                  }
                  ev.dataTransfer.dropEffect = "move";
                  setDropHighlight({ kind: "directory", path: node.relativePath });
                }}
                onDragLeave={(ev) =>
                  clearDropHighlightIfLeaving(
                    ev,
                    (h) => h.kind === "directory" && h.path === node.relativePath,
                  )
                }
                onDrop={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  setDropHighlight(null);
                  const paths = parseDatasetImageDragPaths(ev.dataTransfer);
                  if (!paths || !dragPathsWouldChangeParent(paths, node.relativePath)) return;
                  onMoveImagesToFolder(paths, node.relativePath);
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
                  outline: isDirDrop ? "2px solid var(--accent-acid)" : undefined,
                  outlineOffset: isDirDrop ? "1px" : undefined,
                }}
                onMouseEnter={(e) => {
                  if (isDirDrop) return;
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
              draggable={canDragFromSidebar}
              onDragStart={(ev) => {
                if (!canDragFromSidebar) return;
                internalImageDragActiveRef.current = true;
                const pathsToMove = selectedImagePaths.has(entry.relativePath)
                  ? [...selectedImagePaths]
                  : [entry.relativePath];
                const payload = JSON.stringify({ paths: pathsToMove });
                ev.dataTransfer.setData(DATASET_IMAGE_DRAG_TYPE, payload);
                ev.dataTransfer.setData("text/plain", payload);
                // WebView2 is less picky when both copy and move are allowed.
                ev.dataTransfer.effectAllowed = "copyMove";
              }}
              onDragEnd={() => {
                internalImageDragActiveRef.current = false;
                setDropHighlight(null);
              }}
              onClick={(ev) => onImageRowClick(entry.relativePath, ev)}
              onContextMenu={(ev) => onImageRowContextMenu(ev, entry.relativePath)}
              onDragOver={(ev) => {
                ev.preventDefault();
                applySidebarDragDropEffect(ev);
              }}
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
