import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  FolderTree,
  FolderOpen,
  Folder,
  FolderPlus,
  FolderMinus,
  FolderInput,
  FolderX,
  Edit3,
  Eye,
  Image,
  Tags,
  Bot,
  Languages,
  ArrowRightLeft,
  Save,
  Trash,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  PlusCircle,
  MinusCircle,
  Loader2,
  MousePointer2,
  StopCircle,
  SidebarOpen,
  ScrollText,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import {
  autoTagImage,
  baiduTranslate,
  cancelLlmCaption,
  clearApiLogs,
  deleteDatasetImage,
  getDatasetAsset,
  getRecentApiLogs,
  groupDatasetImages,
  listDatasetEntries,
  moveDatasetImages,
  readCaption,
  removeDatasetGroup,
  renameDatasetGroup,
  writeCaption,
} from "../../lib/desktopApi";
import FileAssetImage from "../FileAssetImage";
import TranslatedCaptionEditor, {
  type TranslatedCaptionEditorHandle,
} from "./TranslatedCaptionEditor";
import { useI18n, type TranslateFn } from "../../lib/i18n";
import {
  loadDatasetEditorFormPersist,
  saveDatasetEditorFormPersist,
} from "../../lib/datasetEditorPersistence";
import { contiguousTagRangeForSelection, splitCaptionTags, charRangeForContiguousTagIndices } from "../../lib/captionSegments";
import type { ApiLogEntry, DatasetAsset, DatasetEntry } from "../../lib/types";

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

const PREVIEW_DOCK_PX = 44;
const BATCH_FLYOUT_W = 300;
const API_LOG_DRAWER_W = 420;

function formatApiLogTime(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString(undefined, {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
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

/**
 * Parses the raw user-entered position string into a normalized insertion index.
 *
 * The returned index is the slot (0-based) where the trigger should be inserted into the
 * tag list, so the resulting tag becomes the (index+1)-th tag.
 *
 * Rules:
 * - Empty / non-numeric / `0` / negative-but-not -1 → `0` (front).
 * - Positive integer `N` → `N` (insert after the N-th existing tag).
 * - `-1` → `Number.POSITIVE_INFINITY`, which the caller clamps to the tag count (append).
 *
 * The infinity sentinel keeps the call sites branch-free: they simply `Math.min` against
 * `parts.length` to land at the end without an extra special case.
 */
function parseTriggerWordPosition(raw: string): number {
  const s = raw.trim();
  if (!s) return 0;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return 0;
  if (n === -1) return Number.POSITIVE_INFINITY;
  if (n <= 0) return 0;
  return n;
}

/**
 * Splits a comma/ideographic-comma-separated caption into trimmed, non-empty tags.
 * Mirrors the split used by `buildCaptionWithTriggerAt` so previews stay in sync with writes.
 */
function splitCaptionTagsForPreview(caption: string): string[] {
  const trimmed = caption.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Resolves the displayed insertion slot (0..tags.length) from the raw user input
 * and the tag count of the current caption. Mirrors the semantics of
 * `parseTriggerWordPosition` + `Math.min(parts.length, …)` used by the writer,
 * so the preview lines up exactly with what would be written.
 */
function resolveTriggerInsertSlot(raw: string, tagCount: number): number {
  const idx = parseTriggerWordPosition(raw);
  if (!Number.isFinite(idx)) return tagCount;
  return Math.max(0, Math.min(idx, tagCount));
}

/**
 * Returns new caption text, or null if `tw` already occupies the resolved insertion slot.
 *
 * `positionIndex` is the 0-based slot in the comma-separated tag list where the trigger
 * should land (so `0` means "front" and `parts.length` means "end"). When the caption is
 * empty the trigger is returned as-is regardless of `positionIndex`.
 */
function buildCaptionWithTriggerAt(
  existingTrimmed: string,
  tw: string,
  positionIndex: number,
): string | null {
  if (!tw) return null;
  if (!existingTrimmed) {
    return tw;
  }
  const parts = existingTrimmed.split(/[,，]/).map((s) => s.trim());
  const insertAt = Math.max(0, Math.min(positionIndex, parts.length));
  if ((parts[insertAt] ?? "") === tw) {
    return null;
  }
  const next = [...parts.slice(0, insertAt), tw, ...parts.slice(insertAt)];
  return next.filter((segment) => segment.length > 0).join(", ");
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

/**
 * Visual picker for the trigger-word insertion slot.
 *
 * Renders the current caption as a chain of pill-shaped tags interleaved with
 * clickable "slot" markers. Clicking a slot selects that 0..N insertion point,
 * and the chosen slot is replaced by a dashed "ghost" pill that previews where
 * the trigger word will land. Two shortcut buttons ("Front" / "End") plus a
 * numeric override input round out the affordances.
 *
 * The `rawPosition` value is the same persisted string used by the writer, so
 * the preview here is guaranteed to match what `buildCaptionWithTriggerAt`
 * would produce.
 */
function TriggerPositionPicker({
  caption,
  triggerWord,
  rawPosition,
  onChangeRaw,
  disabled,
  t,
}: {
  caption: string;
  triggerWord: string;
  rawPosition: string;
  onChangeRaw: (next: string) => void;
  disabled: boolean;
  t: TranslateFn;
}) {
  // Collapsed by default to keep the form compact; expand only when the user
  // wants to fine-tune the slot via the visual chain.
  const [expanded, setExpanded] = useState(false);

  const tags = useMemo(() => splitCaptionTagsForPreview(caption), [caption]);
  const tagCount = tags.length;
  const selectedSlot = useMemo(
    () => resolveTriggerInsertSlot(rawPosition, tagCount),
    [rawPosition, tagCount],
  );
  const trimmedTrigger = triggerWord.trim();
  const ghostLabel = trimmedTrigger || t("dataset.triggerWord");

  // Persist `-1` for "end" so the writer keeps the legacy semantics; for any
  // middle slot we write the slot index verbatim. Front (0) is stored as the
  // empty string to preserve legacy default behaviour on first load.
  const writeSlot = useCallback(
    (slot: number) => {
      if (slot <= 0) onChangeRaw("");
      else if (slot >= tagCount) onChangeRaw("-1");
      else onChangeRaw(String(slot));
    },
    [onChangeRaw, tagCount],
  );

  const positionLabel = useMemo(() => {
    if (tagCount === 0) return t("dataset.triggerPosition.emptyCaption");
    if (selectedSlot <= 0) return t("dataset.triggerPosition.atFront");
    if (selectedSlot >= tagCount) return t("dataset.triggerPosition.atEnd");
    return t("dataset.triggerPosition.afterNth", { n: selectedSlot });
  }, [selectedSlot, tagCount, t]);

  const MAX_VISIBLE = 14;
  // Window-sliding around the selected slot keeps it visible in long captions
  // without making the picker scroll horizontally.
  const { visibleTags, startOffset, truncatedHead, truncatedTail } = useMemo(() => {
    if (tagCount <= MAX_VISIBLE) {
      return {
        visibleTags: tags,
        startOffset: 0,
        truncatedHead: 0,
        truncatedTail: 0,
      };
    }
    const half = Math.floor(MAX_VISIBLE / 2);
    let start = Math.max(0, Math.min(selectedSlot - half, tagCount - MAX_VISIBLE));
    const end = Math.min(tagCount, start + MAX_VISIBLE);
    start = Math.max(0, end - MAX_VISIBLE);
    return {
      visibleTags: tags.slice(start, end),
      startOffset: start,
      truncatedHead: start,
      truncatedTail: tagCount - end,
    };
  }, [tags, tagCount, selectedSlot]);

  const handleSlotClick = useCallback(
    (slot: number) => {
      if (disabled) return;
      writeSlot(slot);
    },
    [disabled, writeSlot],
  );

  const summaryToggleTitle = expanded
    ? t("dataset.triggerPosition.collapse")
    : t("dataset.triggerPosition.expand");

  return (
    <div
      className="lf-trigger-pos-picker"
      style={{
        display: "flex",
        flexDirection: "column",
        border: "1px solid var(--border-dim)",
        borderRadius: "0.4rem",
        background: "var(--bg-surface)",
        opacity: disabled ? 0.6 : 1,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        disabled={disabled}
        aria-expanded={expanded}
        title={summaryToggleTitle}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          padding: "0.4rem 0.6rem",
          background: "transparent",
          border: "none",
          borderBottom: expanded ? "1px solid var(--border-dim)" : "none",
          color: "var(--text-muted)",
          fontSize: "0.72rem",
          cursor: disabled ? "not-allowed" : "pointer",
          font: "inherit",
          textAlign: "left",
          width: "100%",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <span
            style={{
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              flexShrink: 0,
            }}
          >
            {t("dataset.triggerPosition.label")}
          </span>
          <span
            style={{
              color: "var(--accent-acid)",
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {positionLabel}
          </span>
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          style={{
            flexShrink: 0,
            transition: "transform 120ms ease",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </button>

      {expanded ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.4rem",
            padding: "0.5rem 0.6rem",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.3rem",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className="btn"
              style={{
                padding: "0.2rem 0.55rem",
                fontSize: "0.7rem",
                borderColor:
                  selectedSlot <= 0 ? "var(--accent-acid)" : "var(--border-dim)",
                color: selectedSlot <= 0 ? "var(--accent-acid)" : undefined,
              }}
              disabled={disabled}
              onClick={() => handleSlotClick(0)}
              title={t("dataset.triggerPosition.front")}
              aria-pressed={selectedSlot <= 0}
            >
              <ChevronsLeft size={12} aria-hidden style={{ marginRight: "0.2rem" }} />
              {t("dataset.triggerPosition.front")}
            </button>
            <button
              type="button"
              className="btn"
              style={{
                padding: "0.2rem 0.55rem",
                fontSize: "0.7rem",
                borderColor:
                  tagCount > 0 && selectedSlot >= tagCount
                    ? "var(--accent-acid)"
                    : "var(--border-dim)",
                color:
                  tagCount > 0 && selectedSlot >= tagCount ? "var(--accent-acid)" : undefined,
              }}
              disabled={disabled || tagCount === 0}
              onClick={() => handleSlotClick(tagCount)}
              title={t("dataset.triggerPosition.end")}
              aria-pressed={tagCount > 0 && selectedSlot >= tagCount}
            >
              {t("dataset.triggerPosition.end")}
              <ChevronsRight size={12} aria-hidden style={{ marginLeft: "0.2rem" }} />
            </button>
            <input
              type="number"
              className="form-input"
              style={{
                width: "3.6rem",
                padding: "0.2rem 0.35rem",
                fontSize: "0.72rem",
                textAlign: "center",
              }}
              placeholder="0"
              title={t("dataset.triggerPosition.numericHint")}
              aria-label={t("dataset.triggerPosition.numericLabel")}
              value={rawPosition}
              disabled={disabled}
              onChange={(e) => onChangeRaw(e.target.value)}
              min={-1}
              step={1}
              autoComplete="off"
            />
          </div>

          <div
            role="radiogroup"
            aria-label={t("dataset.triggerPosition.label")}
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.15rem",
              padding: "0.25rem 0",
              minHeight: "2.1rem",
              fontFamily: "var(--font-mono)",
              fontSize: "0.72rem",
              lineHeight: 1.1,
            }}
          >
            {tagCount === 0 ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  padding: "0.25rem 0.55rem",
                  border: "1px dashed var(--accent-acid)",
                  color: "var(--accent-acid)",
                  borderRadius: "0.3rem",
                  background: "var(--accent-acid-dim)",
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                <PlusCircle size={11} aria-hidden />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: "12rem",
                  }}
                >
                  {ghostLabel}
                </span>
              </div>
            ) : (
              <>
                <SlotMarker
                  active={selectedSlot === 0 && truncatedHead === 0}
                  disabled={disabled}
                  onClick={() => handleSlotClick(0)}
                  label={t("dataset.triggerPosition.slotAriaFront")}
                  ghostLabel={selectedSlot === 0 && truncatedHead === 0 ? ghostLabel : null}
                />
                {truncatedHead > 0 ? (
                  <span
                    style={{
                      color: "var(--text-muted)",
                      padding: "0 0.25rem",
                      fontSize: "0.68rem",
                    }}
                    aria-hidden
                  >
                    … +{truncatedHead}
                  </span>
                ) : null}
                {visibleTags.map((tag, vIdx) => {
                  const tagAbsIdx = startOffset + vIdx;
                  const slotAfter = tagAbsIdx + 1;
                  const isLastVisibleTag = vIdx === visibleTags.length - 1;
                  return (
                    <span
                      key={`${tagAbsIdx}-${tag}`}
                      style={{ display: "inline-flex", alignItems: "center", gap: "0.15rem" }}
                    >
                      <span
                        style={{
                          padding: "0.2rem 0.5rem",
                          border: "1px solid var(--border-dim)",
                          borderRadius: "0.3rem",
                          background: "var(--bg-surface-alt)",
                          color: "var(--text-muted)",
                          maxWidth: "10rem",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={tag}
                      >
                        {tag}
                      </span>
                      {isLastVisibleTag && truncatedTail > 0 ? (
                        <span
                          style={{
                            color: "var(--text-muted)",
                            padding: "0 0.25rem",
                            fontSize: "0.68rem",
                          }}
                          aria-hidden
                        >
                          … +{truncatedTail}
                        </span>
                      ) : null}
                      <SlotMarker
                        active={
                          selectedSlot === slotAfter &&
                          // Only the right edge slot of the last visible tag can stand in
                          // for the "end" slot when the tail is truncated.
                          (truncatedTail === 0 || (isLastVisibleTag && slotAfter === tagCount))
                        }
                        disabled={disabled}
                        onClick={() => handleSlotClick(slotAfter)}
                        label={
                          slotAfter >= tagCount
                            ? t("dataset.triggerPosition.slotAriaEnd")
                            : t("dataset.triggerPosition.slotAriaAfter", { n: slotAfter })
                        }
                        ghostLabel={
                          selectedSlot === slotAfter &&
                          (truncatedTail === 0 || (isLastVisibleTag && slotAfter === tagCount))
                            ? ghostLabel
                            : null
                        }
                      />
                    </span>
                  );
                })}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Single insertion-point marker between (or at the ends of) the tag chain.
 * Renders either a thin vertical "dot+bar" target or, when active, a dashed
 * pill containing the ghost trigger label.
 */
function SlotMarker({
  active,
  disabled,
  onClick,
  label,
  ghostLabel,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
  ghostLabel: string | null;
}) {
  if (active && ghostLabel !== null) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed
        title={label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.25rem",
          padding: "0.2rem 0.5rem",
          border: "1px dashed var(--accent-acid)",
          color: "var(--accent-acid)",
          borderRadius: "0.3rem",
          background: "var(--accent-acid-dim)",
          cursor: disabled ? "not-allowed" : "pointer",
          font: "inherit",
          maxWidth: "12rem",
        }}
      >
        <PlusCircle size={11} aria-hidden />
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {ghostLabel}
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        position: "relative",
        width: "0.85rem",
        height: "1.6rem",
        padding: 0,
        border: "none",
        background: "transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.1rem",
        color: "var(--border-glow)",
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.color = "var(--accent-acid)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--border-glow)";
      }}
    >
      <span
        aria-hidden
        style={{
          display: "block",
          width: "2px",
          height: "1.1rem",
          background: "currentColor",
          opacity: 0.6,
          borderRadius: "1px",
        }}
      />
      <span
        aria-hidden
        style={{
          display: "block",
          width: "5px",
          height: "5px",
          borderRadius: "50%",
          background: "currentColor",
        }}
      />
    </button>
  );
}

/**
 * Returns the parent dataset-relative path for `relativePath`, or `""` when the path
 * already lives at the dataset root. Mirrors the backend's `/`-separated convention so
 * that callers can feed the result straight back into other dataset commands without
 * an extra normalisation step.
 */
function parentRelativePath(relativePath: string): string {
  const trimmed = relativePath.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "";
  const idx = trimmed.lastIndexOf("/");
  if (idx < 0) return "";
  return trimmed.slice(0, idx);
}

/**
 * Tree node used by the dataset sidebar. Directories track their children; images are
 * leaves that reference the underlying `DatasetEntry` so click/select handlers don't
 * need a second lookup. Non-image / non-directory files are intentionally dropped from
 * the tree because the editor only operates on image assets.
 */
type DatasetTreeNode = {
  kind: "directory" | "image";
  name: string;
  relativePath: string;
  depth: number;
  entry?: DatasetEntry;
  children: DatasetTreeNode[];
};

/**
 * Builds a hierarchical view of the flat `entries` array returned by the backend.
 *
 * The backend already gives us pre-sorted directory + image entries, but the sidebar
 * needs nesting (so groups can collapse) and an image-only filter (so non-image files
 * don't show up as un-clickable rows). Directories are kept even if they only contain
 * non-image files so users can still recognise the structure on disk.
 */
function buildDatasetTree(entries: DatasetEntry[]): DatasetTreeNode[] {
  const root: DatasetTreeNode = {
    kind: "directory",
    name: "",
    relativePath: "",
    depth: -1,
    children: [],
  };
  const dirByPath = new Map<string, DatasetTreeNode>();
  dirByPath.set("", root);

  for (const entry of entries) {
    if (entry.kind === "directory") {
      const node: DatasetTreeNode = {
        kind: "directory",
        name: entry.name,
        relativePath: entry.relativePath,
        depth: entry.depth,
        entry,
        children: [],
      };
      dirByPath.set(entry.relativePath, node);
      const parent = dirByPath.get(parentRelativePath(entry.relativePath));
      (parent ?? root).children.push(node);
    } else if (entry.kind === "image") {
      const node: DatasetTreeNode = {
        kind: "image",
        name: entry.name,
        relativePath: entry.relativePath,
        depth: entry.depth,
        entry,
        children: [],
      };
      const parent = dirByPath.get(parentRelativePath(entry.relativePath));
      (parent ?? root).children.push(node);
    }
    // Non-image files (e.g. .txt captions, .json metadata) are deliberately ignored;
    // the sidebar is for image assets and would otherwise pollute the tree.
  }

  return root.children;
}

/**
 * Walks the visible tree in render order and returns the flat list the keyboard
 * navigation / range selection use. Collapsed directories hide their descendants
 * exactly the way they do visually, so Shift-click ranges line up with what the
 * user sees on screen.
 */
function flattenVisibleTree(
  nodes: DatasetTreeNode[],
  expanded: Set<string>,
  acc: DatasetTreeNode[] = [],
): DatasetTreeNode[] {
  for (const node of nodes) {
    acc.push(node);
    if (node.kind === "directory" && expanded.has(node.relativePath)) {
      flattenVisibleTree(node.children, expanded, acc);
    }
  }
  return acc;
}

/** Collects every directory path in the tree (used for "expand all"). */
function collectAllDirectoryPaths(nodes: DatasetTreeNode[], acc: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === "directory") {
      acc.push(node.relativePath);
      collectAllDirectoryPaths(node.children, acc);
    }
  }
  return acc;
}

/** When true, dataset image hotkeys should not run (user is editing text or a text-like control). */
function isDatasetTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }
  if (target.closest("textarea, select, [contenteditable='true']")) {
    return true;
  }
  const input = target.closest("input");
  if (input instanceof HTMLInputElement) {
    const type = input.type;
    if (
      type === "button" ||
      type === "submit" ||
      type === "checkbox" ||
      type === "radio" ||
      type === "reset" ||
      type === "image" ||
      type === "file" ||
      type === "range" ||
      type === "color"
    ) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * Lightweight modal used for the "create group" / "rename group" prompts. Built in
 * place instead of pulling in a UI library because the existing project relies on
 * raw `var(--…)` tokens for theming and we want the dialog to inherit the same look
 * as the rest of the dataset editor without a wrapper component.
 */
function DatasetPromptDialog({
  open,
  title,
  description,
  defaultValue,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  title: string;
  description?: string;
  defaultValue: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      // Defer focus until the input has been mounted by the same render commit.
      const id = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, [open, defaultValue]);

  if (!open) return null;

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    onConfirm(trimmed);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "var(--bg-card, #1e1e1e)",
          border: "1px solid var(--border-dim)",
          borderRadius: "0.6rem",
          padding: "1.1rem 1.25rem",
          minWidth: "20rem",
          maxWidth: "min(90vw, 28rem)",
          boxShadow: "0 18px 40px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            if (!busy) onCancel();
          }
        }}
      >
        <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{title}</div>
        {description ? (
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
            {description}
          </div>
        ) : null}
        <input
          ref={inputRef}
          type="text"
          className="form-input"
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <button
            type="button"
            className="btn"
            onClick={() => onCancel()}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={busy || !value.trim()}
          >
            {busy ? (
              <Loader2 size={14} className="lf-icon-spin" aria-hidden style={{ marginRight: "0.35rem" }} />
            ) : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Single floating popup of context-menu actions, positioned at the supplied viewport
 * coordinates. Items are simple `<button>` rows so the keyboard / focus story is
 * predictable; closing happens through outside-click + Escape, owned by the parent.
 */
type DatasetContextMenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
};

function DatasetContextMenu({
  open,
  x,
  y,
  items,
  onClose,
}: {
  open: boolean;
  x: number;
  y: number;
  items: DatasetContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (ev: MouseEvent) => {
      if (ref.current && ev.target instanceof Node && !ref.current.contains(ev.target)) {
        onClose();
      }
    };
    const escHandler = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", handler);
    window.addEventListener("keydown", escHandler);
    return () => {
      window.removeEventListener("mousedown", handler);
      window.removeEventListener("keydown", escHandler);
    };
  }, [open, onClose]);

  if (!open) return null;

  // Clamp the menu inside the viewport so right-clicking near the bottom/right edge
  // doesn't render half of it off-screen.
  const MAX_W = 240;
  const MAX_H = 320;
  const left = Math.min(x, Math.max(0, window.innerWidth - MAX_W - 8));
  const top = Math.min(y, Math.max(0, window.innerHeight - MAX_H - 8));

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 1100,
        minWidth: 200,
        maxWidth: MAX_W,
        background: "var(--bg-card, #1e1e1e)",
        border: "1px solid var(--border-dim)",
        borderRadius: "0.4rem",
        padding: "0.3rem",
        boxShadow: "0 14px 30px rgba(0,0,0,0.55)",
        display: "flex",
        flexDirection: "column",
        gap: "0.1rem",
      }}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
            onClose();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.4rem 0.55rem",
            background: "transparent",
            border: "none",
            color: item.danger ? "var(--accent-orange)" : "var(--text-main)",
            fontSize: "0.78rem",
            textAlign: "left",
            cursor: item.disabled ? "not-allowed" : "pointer",
            opacity: item.disabled ? 0.55 : 1,
            borderRadius: "0.3rem",
            font: "inherit",
          }}
          onMouseEnter={(e) => {
            if (!item.disabled) {
              e.currentTarget.style.background =
                "color-mix(in srgb, var(--accent-acid) 18%, transparent)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          {item.icon ? (
            <span style={{ display: "inline-flex", alignItems: "center" }}>{item.icon}</span>
          ) : null}
          <span style={{ flex: 1 }}>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

export default function DatasetEditor({ projectId }: DatasetEditorProps) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<DatasetEntry[]>([]);
  const [asset, setAsset] = useState<DatasetAsset | null>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(-1);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewDockOpen, setPreviewDockOpen] = useState(false);
  const [batchFlyoutOpen, setBatchFlyoutOpen] = useState(false);
  const [apiLogDrawerOpen, setApiLogDrawerOpen] = useState(false);
  const [apiLogLines, setApiLogLines] = useState<ApiLogEntry[]>([]);
  const [taggingMode, setTaggingMode] = useState<"all" | "range">("all");
  const [imageRange, setImageRange] = useState("");
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [triggerWord, setTriggerWord] = useState("");
  /**
   * Raw user input for the insertion slot of the trigger word.
   * See `parseTriggerWordPosition` for the supported value grammar.
   */
  const [triggerWordPosition, setTriggerWordPosition] = useState("");
  /** Optional text sent to the LLM with the image to reduce mis-tags. */
  const [llmUserHint, setLlmUserHint] = useState("");
  /** Avoid writing another project's form snapshot before hydrate completes (projectId switch). */
  const [persistReadyProjectId, setPersistReadyProjectId] = useState<string | null>(null);
  const captionRef = useRef(caption);
  captionRef.current = caption;

  /** Multi-select state for the dataset sidebar. Always a set of image relative paths;
   *  directory rows toggle expansion but do not enter the selection set. */
  const [selectedImagePaths, setSelectedImagePaths] = useState<Set<string>>(new Set());
  /** Anchor used by Shift-click range selection. Tracks the most recent single click. */
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string | null>(null);
  /** Open/expanded directory paths in the sidebar tree. */
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  /** Sidebar context-menu, if any. Coordinates are viewport-relative. */
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    targetPath: string;
    targetKind: "image" | "directory" | "background";
  } | null>(null);
  /** Modal prompt currently open in the sidebar (create / rename group). */
  const [promptDialog, setPromptDialog] = useState<{
    mode: "create-group" | "rename-group";
    targetPath: string;
    defaultValue: string;
  } | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);

  const [translatedCaption, setTranslatedCaption] = useState("");
  /** 拖动选中连续标签分区后持久高亮（译文标签下标 + 字符区间）。 */
  const [zhPartitionHighlight, setZhPartitionHighlight] = useState<{
    lo: number;
    hi: number;
    start: number;
    end: number;
  } | null>(null);
  const [translateNotice, setTranslateNotice] = useState<string | null>(null);
  const [translateBusy, setTranslateBusy] = useState(false);
  const translateTimerRef = useRef<number | null>(null);
  const translateGenRef = useRef(0);
  const translatedCaptionEditorRef = useRef<TranslatedCaptionEditorHandle | null>(null);
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

  useEffect(() => {
    const saved = loadDatasetEditorFormPersist(projectId);
    setLlmUserHint(saved?.llmUserHint ?? "");
    setTriggerWord(saved?.triggerWord ?? "");
    setTriggerWordPosition(saved?.triggerWordPosition ?? "");
    setImageRange(saved?.imageRange ?? "");
    setTaggingMode(saved?.taggingMode === "range" ? "range" : "all");
    setPreviewDockOpen(Boolean(saved?.previewDockOpen));
    setPersistReadyProjectId(projectId);
  }, [projectId]);

  useEffect(() => {
    if (persistReadyProjectId !== projectId) return;
    saveDatasetEditorFormPersist(projectId, {
      llmUserHint,
      triggerWord,
      triggerWordPosition,
      imageRange,
      taggingMode,
      previewDockOpen,
    });
  }, [
    persistReadyProjectId,
    projectId,
    llmUserHint,
    triggerWord,
    triggerWordPosition,
    imageRange,
    taggingMode,
    previewDockOpen,
  ]);

  const imageEntries = useMemo(
    () => entries.filter((entry) => entry.kind === "image"),
    [entries],
  );

  /** Tree view of the dataset for the sidebar; rebuilt whenever the backend listing changes. */
  const datasetTree = useMemo(() => buildDatasetTree(entries), [entries]);

  /** Visible (post-collapse) flat order of tree rows; powers Shift-click ranges. */
  const visibleTreeRows = useMemo(
    () => flattenVisibleTree(datasetTree, expandedDirs),
    [datasetTree, expandedDirs],
  );

  /** Lookup: image relativePath → position in the visible tree, for range selection. */
  const visibleImagePathToIndex = useMemo(() => {
    const map = new Map<string, number>();
    visibleTreeRows.forEach((row, idx) => {
      if (row.kind === "image") map.set(row.relativePath, idx);
    });
    return map;
  }, [visibleTreeRows]);

  /** Auto-expand any directory that contains the currently displayed image so the
   *  user always sees the active row in the sidebar without manual expand clicks. */
  useEffect(() => {
    const active = entries.find((entry) => entry.relativePath === asset?.relativePath);
    if (!active || active.kind !== "image") return;
    const parents = new Set<string>();
    let cursor = parentRelativePath(active.relativePath);
    while (cursor) {
      parents.add(cursor);
      cursor = parentRelativePath(cursor);
    }
    if (parents.size === 0) return;
    setExpandedDirs((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const p of parents) {
        if (!next.has(p)) {
          next.add(p);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [asset?.relativePath, entries]);

  /** Drop selection entries that no longer correspond to existing images (e.g. after
   *  the backend moves / deletes files). Anchor follows the same rule. */
  useEffect(() => {
    const existing = new Set(imageEntries.map((entry) => entry.relativePath));
    setSelectedImagePaths((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const path of prev) {
        if (existing.has(path)) next.add(path);
        else changed = true;
      }
      return changed ? next : prev;
    });
    setSelectionAnchorPath((prev) => (prev && existing.has(prev) ? prev : null));
  }, [imageEntries]);

  const refreshApiLogs = useCallback(async () => {
    try {
      const rows = await getRecentApiLogs(400);
      setApiLogLines(rows);
    } catch {
      /* ignore */
    }
  }, []);

  const handleClearApiLogs = useCallback(async () => {
    try {
      await clearApiLogs();
      setApiLogLines([]);
    } catch {
      /* ignore */
    }
  }, []);

  const openImage = useCallback((relativePath: string) => {
    setSelectedImageIndex((currentIndex) => {
      const nextIndex = imageEntries.findIndex((entry) => entry.relativePath === relativePath);
      return nextIndex >= 0 ? nextIndex : currentIndex;
    });
  }, [imageEntries]);

  const toggleDirectoryExpansion = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  /**
   * Mouse click handler for an image row in the sidebar tree. Handles all three
   * selection idioms in one place so the rendering layer stays declarative:
   *
   * - plain click  → preview the image and become the sole selection (the active
   *   preview always belongs to the selection set so batch operations include it).
   * - Ctrl / Cmd  → toggle this image in/out of the selection set; the anchor moves
   *   to whichever path was just touched.
   * - Shift       → select every visible image between the anchor and this row,
   *   merging with the existing set so the user can extend a range.
   */
  const handleImageRowClick = useCallback(
    (relativePath: string, ev: React.MouseEvent) => {
      const isRange = ev.shiftKey;
      const isToggle = ev.ctrlKey || ev.metaKey;

      if (isRange && selectionAnchorPath) {
        const anchorIdx = visibleImagePathToIndex.get(selectionAnchorPath);
        const targetIdx = visibleImagePathToIndex.get(relativePath);
        if (anchorIdx !== undefined && targetIdx !== undefined) {
          const lo = Math.min(anchorIdx, targetIdx);
          const hi = Math.max(anchorIdx, targetIdx);
          const rangePaths: string[] = [];
          for (let i = lo; i <= hi; i++) {
            const row = visibleTreeRows[i];
            if (row?.kind === "image") rangePaths.push(row.relativePath);
          }
          setSelectedImagePaths((prev) => {
            const next = isToggle ? new Set(prev) : new Set<string>();
            for (const p of rangePaths) next.add(p);
            next.add(relativePath);
            return next;
          });
          void openImage(relativePath);
          return;
        }
      }

      if (isToggle) {
        setSelectedImagePaths((prev) => {
          const next = new Set(prev);
          if (next.has(relativePath)) {
            next.delete(relativePath);
          } else {
            next.add(relativePath);
          }
          return next;
        });
        setSelectionAnchorPath(relativePath);
        void openImage(relativePath);
        return;
      }

      setSelectedImagePaths(new Set([relativePath]));
      setSelectionAnchorPath(relativePath);
      void openImage(relativePath);
    },
    [openImage, selectionAnchorPath, visibleImagePathToIndex, visibleTreeRows],
  );

  /**
   * Collects every image relative path under `dirPath` (inclusive of nested groups).
   * Used by the "select directory" context-menu action and as a fallback when the
   * user invokes Ctrl+G on a folder row rather than on a multi-selection.
   */
  const imagesUnderDirectory = useCallback(
    (dirPath: string): string[] => {
      const prefix = dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
      return imageEntries
        .filter((entry) => entry.relativePath.startsWith(prefix))
        .map((entry) => entry.relativePath);
    },
    [imageEntries],
  );

  /**
   * Reloads the dataset listing after a structural change and tries to keep the
   * preview pointed at the same image (its `relativePath` may have moved). When the
   * old path no longer exists (e.g. after a delete-group), the preview falls back to
   * the first available image so the editor stays in a usable state.
   */
  const reloadEntriesPreserveSelection = useCallback(
    async (newEntries: DatasetEntry[], preferredImagePath?: string | null) => {
      setEntries(newEntries);
      const nextImages = newEntries.filter((entry) => entry.kind === "image");
      if (nextImages.length === 0) {
        assetRequestIdRef.current += 1;
        setSelectedImageIndex(-1);
        setAsset(null);
        setCaption("");
        return;
      }

      const targetPath = preferredImagePath ?? asset?.relativePath ?? null;
      const idx = targetPath
        ? nextImages.findIndex((entry) => entry.relativePath === targetPath)
        : -1;
      if (idx >= 0) {
        setSelectedImageIndex(idx);
      } else {
        setSelectedImageIndex(0);
      }
    },
    [asset?.relativePath],
  );

  const performCreateGroup = useCallback(
    async (groupName: string, relativePaths: string[], parentPath: string | null) => {
      if (relativePaths.length === 0) {
        setError(t("dataset.groupCreateNeedSelection"));
        return;
      }
      setPromptBusy(true);
      setError(null);
      try {
        const nextEntries = await groupDatasetImages(
          projectId,
          relativePaths,
          groupName,
          parentPath ?? null,
        );

        // Diff old vs new directory entries to discover which group folder the
        // backend actually created. The user-supplied name is only a hint — collisions
        // get suffixed (`name (2)` etc.), so we cannot reconstruct the path purely
        // from the input. By taking the directory diff we get the authoritative new
        // path back from the listing the backend just returned, which keeps the UI
        // truthful even if the rename rules change later.
        const oldDirs = new Set(
          entries.filter((e) => e.kind === "directory").map((e) => e.relativePath),
        );
        const newGroupPaths = nextEntries
          .filter((e) => e.kind === "directory" && !oldDirs.has(e.relativePath))
          .map((e) => e.relativePath);

        // Heuristic: the freshly created group lives under the chosen parent (or root)
        // and now contains the moved images. Prefer the one that ends with our parent
        // prefix; fall back to the deepest new directory otherwise.
        const expectedParent = (parentPath ?? "").replace(/^\/+|\/+$/g, "");
        const matchedGroupPath =
          newGroupPaths.find((p) => parentRelativePath(p) === expectedParent) ??
          newGroupPaths[0] ??
          null;

        let movedImagePaths: string[] = [];
        if (matchedGroupPath) {
          const prefix = `${matchedGroupPath}/`;
          movedImagePaths = nextEntries
            .filter((e) => e.kind === "image" && e.relativePath.startsWith(prefix))
            .map((e) => e.relativePath);
        }

        // Reveal the new group so the user immediately sees the moved files instead of
        // having to expand the folder by hand after every Ctrl+G.
        if (matchedGroupPath) {
          setExpandedDirs((prev) => {
            const next = new Set(prev);
            next.add(matchedGroupPath);
            // Also expand every ancestor so a nested group becomes visible too.
            let cursor = parentRelativePath(matchedGroupPath);
            while (cursor) {
              next.add(cursor);
              cursor = parentRelativePath(cursor);
            }
            return next;
          });
        }

        // Keep the preview on the same logical image when possible: if the active
        // image was part of the moved set, jump to its new location; otherwise leave
        // the preview alone (reloadEntriesPreserveSelection handles the fallback).
        const previousActive = asset?.relativePath ?? null;
        const wasActiveMoved = previousActive ? relativePaths.includes(previousActive) : false;
        let newActivePath: string | null = null;
        if (wasActiveMoved && previousActive && matchedGroupPath) {
          const basename = previousActive.split("/").pop() ?? "";
          const candidate = movedImagePaths.find((p) => p.endsWith(`/${basename}`));
          newActivePath = candidate ?? movedImagePaths[0] ?? null;
        } else if (!wasActiveMoved && previousActive) {
          newActivePath = previousActive;
        } else {
          newActivePath = movedImagePaths[0] ?? null;
        }

        await reloadEntriesPreserveSelection(nextEntries, newActivePath);
        // Multi-select the entire freshly created group so the user can immediately
        // run a follow-up batch action (caption, trigger word, etc.) on just that set.
        setSelectedImagePaths(new Set(movedImagePaths));
        setSelectionAnchorPath(newActivePath);
        setPromptDialog(null);
      } catch (e) {
        setError(t("dataset.groupActionFailed", { error: getErrorMessage(e, "") }));
      } finally {
        setPromptBusy(false);
      }
    },
    [asset?.relativePath, entries, projectId, reloadEntriesPreserveSelection, t],
  );

  const performRenameGroup = useCallback(
    async (groupPath: string, newName: string) => {
      setPromptBusy(true);
      setError(null);
      try {
        const nextEntries = await renameDatasetGroup(projectId, groupPath, newName);
        // The current asset path may include the renamed group as a prefix; rewrite
        // to the new prefix when possible so the preview keeps pointing at the same
        // file rather than snapping back to image #0.
        const oldPrefix = groupPath.endsWith("/") ? groupPath : `${groupPath}/`;
        const currentPath = asset?.relativePath ?? null;
        let preferred: string | null = currentPath;
        if (currentPath && currentPath.startsWith(oldPrefix)) {
          const basename = currentPath.slice(oldPrefix.length);
          const candidate = nextEntries.find(
            (entry) =>
              entry.kind === "image" && entry.relativePath.endsWith(`/${basename}`),
          );
          preferred = candidate?.relativePath ?? currentPath;
        }
        await reloadEntriesPreserveSelection(nextEntries, preferred);
        setPromptDialog(null);
      } catch (e) {
        setError(t("dataset.groupActionFailed", { error: getErrorMessage(e, "") }));
      } finally {
        setPromptBusy(false);
      }
    },
    [asset?.relativePath, projectId, reloadEntriesPreserveSelection, t],
  );

  const performMoveImagesToRoot = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      setError(null);
      try {
        const nextEntries = await moveDatasetImages(projectId, paths, "");
        await reloadEntriesPreserveSelection(nextEntries, null);
        setSelectedImagePaths(new Set());
        setSelectionAnchorPath(null);
      } catch (e) {
        setError(t("dataset.groupActionFailed", { error: getErrorMessage(e, "") }));
      }
    },
    [projectId, reloadEntriesPreserveSelection, t],
  );

  const performRemoveGroup = useCallback(
    async (groupPath: string, deleteContents: boolean) => {
      setError(null);
      try {
        const nextEntries = await removeDatasetGroup(projectId, groupPath, deleteContents);
        await reloadEntriesPreserveSelection(nextEntries, null);
        setSelectedImagePaths(new Set());
        setSelectionAnchorPath(null);
      } catch (e) {
        setError(t("dataset.groupActionFailed", { error: getErrorMessage(e, "") }));
      }
    },
    [projectId, reloadEntriesPreserveSelection, t],
  );

  /** Opens the "create group" dialog using either the explicit selection set or the
   *  given directory's images when invoked from a folder row. Returns true when the
   *  dialog was actually shown so callers can suppress fallback notifications. */
  const openCreateGroupDialog = useCallback(
    (initialPaths: string[], parentPath: string | null) => {
      if (initialPaths.length === 0) {
        setError(t("dataset.groupCreateNeedSelection"));
        return false;
      }
      setPromptDialog({
        mode: "create-group",
        targetPath: parentPath ?? "",
        defaultValue: t("dataset.groupCreateDefaultName"),
      });
      return true;
    },
    [t],
  );

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

  useEffect(() => {
    setZhPartitionHighlight(null);
  }, [currentImage?.relativePath]);

  const batchRangeHighlight = useMemo(() => {
    if (!previewDockOpen || !batchFlyoutOpen || taggingMode !== "range") return null;
    return parseBatchImageRange(imageRange, imageEntries.length);
  }, [previewDockOpen, batchFlyoutOpen, taggingMode, imageRange, imageEntries.length]);

  const previousImage = selectedImageIndex > 0 ? imageEntries[selectedImageIndex - 1] : null;
  const nextImage =
    selectedImageIndex >= 0 && selectedImageIndex < imageEntries.length - 1
      ? imageEntries[selectedImageIndex + 1]
      : null;

  const openImageRef = useRef(openImage);
  openImageRef.current = openImage;

  const imageNavKeysRef = useRef({
    prev: null as DatasetEntry | null,
    next: null as DatasetEntry | null,
    first: null as DatasetEntry | null,
    last: null as DatasetEntry | null,
  });
  imageNavKeysRef.current = {
    prev: previousImage,
    next: nextImage,
    first: imageEntries[0] ?? null,
    last: imageEntries.length > 0 ? imageEntries[imageEntries.length - 1]! : null,
  };

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented || ev.repeat) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (isDatasetTypingTarget(ev.target)) return;

      const { prev, next, first, last } = imageNavKeysRef.current;
      const go = (entry: DatasetEntry | null) => {
        if (!entry) return;
        openImageRef.current(entry.relativePath);
      };

      switch (ev.key) {
        case "ArrowUp":
        case "ArrowLeft":
          if (prev) {
            ev.preventDefault();
            go(prev);
          }
          break;
        case "ArrowDown":
        case "ArrowRight":
          if (next) {
            ev.preventDefault();
            go(next);
          }
          break;
        case "PageUp":
          if (prev) {
            ev.preventDefault();
            go(prev);
          }
          break;
        case "PageDown":
          if (next) {
            ev.preventDefault();
            go(next);
          }
          break;
        case "Home":
          if (first) {
            ev.preventDefault();
            go(first);
          }
          break;
        case "End":
          if (last) {
            ev.preventDefault();
            go(last);
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Ctrl+G shortcut for "group selection". Lives in its own listener because the main
  // navigation handler intentionally bails out as soon as Ctrl/Meta is held — adding
  // Ctrl+G there would tangle the two state machines together.
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented || ev.repeat) return;
      if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey) return;
      if (ev.key.toLowerCase() !== "g") return;
      if (isDatasetTypingTarget(ev.target)) return;
      ev.preventDefault();
      const paths = Array.from(selectedImagePaths);
      if (paths.length === 0) {
        setError(t("dataset.groupCreateNeedSelection"));
        return;
      }
      // When every selected image already lives under the same directory, use that
      // directory as the parent for the new group so it nests naturally rather than
      // jumping back to the dataset root.
      const parents = new Set(paths.map((p) => parentRelativePath(p)));
      const parent = parents.size === 1 ? (parents.values().next().value ?? "") : "";
      openCreateGroupDialog(paths, parent || null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openCreateGroupDialog, selectedImagePaths, t]);

  useEffect(() => {
    if (!apiLogDrawerOpen || !previewDockOpen) return;
    let cancelled = false;
    void refreshApiLogs();
    const id = window.setInterval(() => {
      if (!cancelled) void refreshApiLogs();
    }, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [apiLogDrawerOpen, previewDockOpen, refreshApiLogs]);

  const runBaiduCaptionTranslate = useCallback(() => {
    if (translateTimerRef.current !== null) {
      clearTimeout(translateTimerRef.current);
      translateTimerRef.current = null;
    }
    const raw = captionRef.current.trim();
    if (!raw) {
      return;
    }
    const generation = ++translateGenRef.current;
    setTranslateBusy(true);
    setTranslateNotice(null);
    void baiduTranslate(raw, "auto", "zh")
      .then((zh) => {
        if (translateGenRef.current === generation) {
          setZhPartitionHighlight(null);
          setTranslatedCaption(zh);
        }
      })
      .catch((translateError) => {
        if (translateGenRef.current === generation) {
          setZhPartitionHighlight(null);
          setTranslatedCaption("");
          setTranslateNotice(getErrorMessage(translateError, t("errors.baiduTranslate")));
        }
      })
      .finally(() => {
        if (translateGenRef.current === generation) {
          setTranslateBusy(false);
        }
      });
  }, [t]);

  useEffect(() => {
    if (translateTimerRef.current !== null) {
      clearTimeout(translateTimerRef.current);
      translateTimerRef.current = null;
    }
    const trimmed = caption.trim();
    setTranslateNotice(null);
    if (!trimmed) {
      translateGenRef.current += 1;
      setZhPartitionHighlight(null);
      setTranslatedCaption("");
      setTranslateBusy(false);
      return;
    }
    translateTimerRef.current = window.setTimeout(() => {
      translateTimerRef.current = null;
      runBaiduCaptionTranslate();
    }, 560);
    return () => {
      if (translateTimerRef.current !== null) {
        clearTimeout(translateTimerRef.current);
        translateTimerRef.current = null;
      }
    };
  }, [caption, runBaiduCaptionTranslate]);

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

  const applyZhOverwriteToCaption = useCallback(async () => {
    if (!asset || !currentImage) return;
    const zh = translatedCaption.trim();
    if (!zh) {
      setTranslateNotice(t("dataset.overwriteNeedsZh"));
      return;
    }
    setBusy("caption-merge");
    setTranslateNotice(null);
    try {
      const englishBack = await baiduTranslate(zh, "zh", "en");
      const next = englishBack.trim();
      if (!next) {
        setTranslateNotice(t("dataset.overwriteBackEmpty"));
        return;
      }
      setCaption(next);
      captionRef.current = next;
      await writeCaption(projectId, currentImage.relativePath, next);
      await loadAsset(currentImage.relativePath);
    } catch (mergeErr) {
      setTranslateNotice(getErrorMessage(mergeErr, t("errors.overwriteCaptionMerge")));
    } finally {
      setBusy(null);
    }
  }, [asset, currentImage, loadAsset, projectId, t, translatedCaption]);

  const captionTagCountAligned = useMemo(() => {
    const n = splitCaptionTags(caption).length;
    const m = splitCaptionTags(translatedCaption).length;
    return n > 0 && n === m;
  }, [caption, translatedCaption]);

  const zhHlSafe = useMemo(() => {
    if (!zhPartitionHighlight) {
      return null;
    }
    const { start, end } = zhPartitionHighlight;
    const len = translatedCaption.length;
    if (start < 0 || end > len || start >= end) {
      return null;
    }
    return { start, end };
  }, [zhPartitionHighlight, translatedCaption]);

  const syncZhPartitionHighlightFromSelection = useCallback(() => {
    if (busy !== null || translateBusy) {
      return;
    }
    const api = translatedCaptionEditorRef.current;
    if (!api) {
      return;
    }
    const sel = api.getPlainSelection();
    if (!sel || sel.start === sel.end) {
      return;
    }
    const rangeTags = contiguousTagRangeForSelection(translatedCaption, sel.start, sel.end);
    if (!rangeTags) {
      return;
    }
    const charRange = charRangeForContiguousTagIndices(translatedCaption, rangeTags.lo, rangeTags.hi);
    if (!charRange) {
      return;
    }
    setZhPartitionHighlight({
      lo: rangeTags.lo,
      hi: rangeTags.hi,
      start: charRange.start,
      end: charRange.end,
    });
  }, [translatedCaption, busy, translateBusy]);

  const applyZhSelectionToCaption = useCallback(async () => {
    if (!asset || !currentImage) return;
    const zhFull = translatedCaption;

    let rangeZh: { lo: number; hi: number } | null = null;
    let selZh = "";

    const api = translatedCaptionEditorRef.current;
    if (api && busy === null && !translateBusy) {
      const rawSel = api.getPlainSelection();
      if (rawSel && rawSel.start !== rawSel.end) {
        const fromSel = contiguousTagRangeForSelection(zhFull, rawSel.start, rawSel.end);
        if (fromSel) {
          rangeZh = fromSel;
          selZh = zhFull.slice(rawSel.start, rawSel.end).trim();
        }
      }
    }

    if (!rangeZh && zhHlSafe && zhPartitionHighlight) {
      rangeZh = { lo: zhPartitionHighlight.lo, hi: zhPartitionHighlight.hi };
      selZh = zhFull.slice(zhHlSafe.start, zhHlSafe.end).trim();
    }

    if (!rangeZh) {
      setTranslateNotice(t("dataset.overwriteSelectionInvalid"));
      return;
    }
    if (!selZh) {
      setTranslateNotice(t("dataset.overwriteSelectionEmpty"));
      return;
    }

    const origParts = splitCaptionTags(caption);
    const zhParts = splitCaptionTags(zhFull);
    if (origParts.length !== zhParts.length) {
      setTranslateNotice(t("dataset.segmentCountMismatch"));
      return;
    }
    setBusy("caption-merge");
    setTranslateNotice(null);
    try {
      const englishBack = await baiduTranslate(selZh, "zh", "en");
      const newParts = splitCaptionTags(englishBack.trim());
      if (!newParts.length) {
        setTranslateNotice(t("dataset.overwriteBackEmpty"));
        return;
      }
      const { lo, hi } = rangeZh;
      const nextOrig = [...origParts];
      nextOrig.splice(lo, hi - lo + 1, ...newParts);
      const next = nextOrig.join(", ");
      setCaption(next);
      captionRef.current = next;
      await writeCaption(projectId, currentImage.relativePath, next);
      await loadAsset(currentImage.relativePath);
    } catch (selErr) {
      setTranslateNotice(getErrorMessage(selErr, t("errors.overwriteCaptionMerge")));
    } finally {
      setBusy(null);
    }
  }, [
    asset,
    caption,
    currentImage,
    loadAsset,
    projectId,
    t,
    translatedCaption,
    zhHlSafe,
    zhPartitionHighlight,
    translateBusy,
    busy,
  ]);

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

    let previousAssistantCaption: string | undefined;
    let previousImageRelativePath: string | undefined;
    if (previousImage) {
      try {
        const prior = await readCaption(projectId, previousImage.relativePath);
        const t = prior.trim();
        if (t.length > 0) {
          previousAssistantCaption = t;
          previousImageRelativePath = previousImage.relativePath;
        }
      } catch {
        previousAssistantCaption = undefined;
        previousImageRelativePath = undefined;
      }
    }

    try {
      const nextCaption = await autoTagImage(
        projectId,
        asset.relativePath,
        hint.length > 0 ? hint : undefined,
        previousAssistantCaption,
        previousImageRelativePath,
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
    let previousAssistantCaption: string | undefined;
    let previousImageRelativePath: string | undefined;

    try {
      for (let i = 0; i < targets.length; i++) {
        const entry = targets[i];
        startTransition(() => {
          setBatchProgress({
            current: i + 1,
            total: targets.length,
            currentName: entry.name,
            relativePath: entry.relativePath,
          });
        });
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });

        try {
          const hint = llmUserHint.trim();
          const nextCaption = await autoTagImage(
            projectId,
            entry.relativePath,
            hint.length > 0 ? hint : undefined,
            previousAssistantCaption,
            previousImageRelativePath,
          );
          await writeCaption(projectId, entry.relativePath, nextCaption);
          const trimmedNew = nextCaption.trim();
          if (trimmedNew.length > 0) {
            previousAssistantCaption = trimmedNew;
            previousImageRelativePath = entry.relativePath;
          } else {
            previousAssistantCaption = undefined;
            previousImageRelativePath = undefined;
          }
          ok++;
          if (currentImage?.relativePath === entry.relativePath) {
            await loadAsset(entry.relativePath);
          }
        } catch (itemError) {
          if (isCaptionCancelledError(itemError)) {
            userCancelled = true;
            break;
          }
          previousAssistantCaption = undefined;
          previousImageRelativePath = undefined;
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

    const positionIndex = parseTriggerWordPosition(triggerWordPosition);

    setBusy("trigger-all");
    setError(null);
    try {
      for (const entry of imageEntries) {
        const raw = await readCaption(projectId, entry.relativePath);
        const trimmed = raw.trim();
        const next = buildCaptionWithTriggerAt(trimmed, tw, positionIndex);
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
  }, [busy, currentImage, imageEntries, loadAsset, projectId, t, triggerWord, triggerWordPosition]);

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
            onClick={() => {
              const paths = Array.from(selectedImagePaths);
              const parents = new Set(paths.map((p) => parentRelativePath(p)));
              const parent = parents.size === 1 ? (parents.values().next().value ?? "") : "";
              openCreateGroupDialog(paths, parent || null);
            }}
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
            onClick={() => {
              setExpandedDirs(new Set(collectAllDirectoryPaths(datasetTree)));
            }}
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
            onClick={() => setExpandedDirs(new Set())}
          >
            <ChevronRight size={13} aria-hidden />
          </button>
        </div>

        <div
          className="dataset-tree"
          onContextMenu={(ev) => {
            if (ev.target === ev.currentTarget) {
              ev.preventDefault();
              setContextMenu({
                x: ev.clientX,
                y: ev.clientY,
                targetPath: "",
                targetKind: "background",
              });
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
              setContextMenu({
                x: ev.clientX,
                y: ev.clientY,
                targetPath: "",
                targetKind: "background",
              });
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
                  onClick={() => toggleDirectoryExpansion(node.relativePath)}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    setContextMenu({
                      x: ev.clientX,
                      y: ev.clientY,
                      targetPath: node.relativePath,
                      targetKind: "directory",
                    });
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
            const isActive = entry.relativePath === asset?.relativePath;
            const isMultiSelected = selectedImagePaths.has(entry.relativePath);
            const isBatchWorking =
              busy === "batch-llm" &&
              batchProgress !== null &&
              entry.relativePath === batchProgress.relativePath;

            return (
              <div
                key={`i:${entry.relativePath}`}
                onClick={(ev) => handleImageRowClick(entry.relativePath, ev)}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  // Right-clicking a row that isn't already selected makes it the new
                  // sole selection so the resulting menu acts on the right target —
                  // matches how every native file manager handles this.
                  if (!selectedImagePaths.has(entry.relativePath)) {
                    setSelectedImagePaths(new Set([entry.relativePath]));
                    setSelectionAnchorPath(entry.relativePath);
                    void openImage(entry.relativePath);
                  }
                  setContextMenu({
                    x: ev.clientX,
                    y: ev.clientY,
                    targetPath: entry.relativePath,
                    targetKind: "image",
                  });
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
                  opacity: imageEntries.length === 0 ? 0.35 : 1,
                }}
                disabled={imageEntries.length === 0}
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

                <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "1.25rem", flex: 1, minHeight: 0, overflowY: "auto" }}>
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

                <div style={{ padding: "1rem", borderTop: "1px solid var(--border-dim)", flexShrink: 0 }}>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ flex: 1, justifyContent: "center", padding: "0.75rem" }}
                      disabled={imageEntries.length === 0 || busy !== null}
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
                    onClick={() => void handleClearApiLogs()}
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

      <div className="card" style={{ gridColumn: "span 4", gridRow: "span 3", animationDelay: "0.08s" }}>
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
            <TriggerPositionPicker
              caption={caption}
              triggerWord={triggerWord}
              rawPosition={triggerWordPosition}
              onChangeRaw={setTriggerWordPosition}
              disabled={busy !== null}
              t={t}
            />
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: "0.65rem",
              minHeight: 0,
              marginTop: "0.5rem",
            }}
          >
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "row",
                gap: "0.75rem",
                minHeight: 0,
                alignItems: "stretch",
              }}
            >
              <div
                className="lf-dataset-caption-zone"
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 0,
                }}
              >
                <div
                  style={{
                    minHeight: "2.35rem",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: "0.2rem",
                  }}
                >
                  <label className="form-label" style={{ margin: 0 }}>
                    {t("dataset.rawTagText")}
                  </label>
                  <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", lineHeight: 1.3 }}>
                    {t("dataset.captionZoneOriginal")}
                  </span>
                </div>
                <textarea
                  className="form-input"
                  style={{
                    flex: 1,
                    minHeight: "12rem",
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
              <div className="lf-dataset-caption-divider" aria-hidden />
              <div
                className="lf-dataset-caption-zone lf-dataset-caption-zone--translated"
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 0,
                }}
              >
                <div
                  style={{
                    minHeight: "2.35rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.35rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "0.5rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      className="form-label"
                      style={{ margin: 0, display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}
                    >
                      <Languages size={16} aria-hidden />
                      {t("dataset.translatedCaption")}
                      {translateBusy ? (
                        <Loader2 size={16} className="lf-icon-spin" aria-hidden />
                      ) : null}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem", flexShrink: 0 }}
                        disabled={!caption.trim() || translateBusy || busy !== null}
                        onClick={() => runBaiduCaptionTranslate()}
                      >
                        {t("dataset.translateNow")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem", flexShrink: 0 }}
                        title={
                          captionTagCountAligned
                            ? t("dataset.overwriteSelectionToCaptionTitle")
                            : t("dataset.overwriteSelectionNeedAlignedTags")
                        }
                        disabled={
                          !asset ||
                          !captionTagCountAligned ||
                          !translatedCaption.trim() ||
                          translateBusy ||
                          busy !== null
                        }
                        onMouseDown={(e) => {
                          e.preventDefault();
                        }}
                        onClick={() => void applyZhSelectionToCaption()}
                      >
                        {busy === "caption-merge" ? (
                          <Loader2 size={16} className="lf-icon-spin" aria-hidden style={{ marginRight: "0.35rem" }} />
                        ) : (
                          <MousePointer2 size={16} aria-hidden style={{ marginRight: "0.35rem" }} />
                        )}
                        {t("dataset.overwriteSelectionToCaption")}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem", flexShrink: 0 }}
                        title={t("dataset.overwriteTagsFromZhTitle")}
                        disabled={
                          !asset ||
                          !translatedCaption.trim() ||
                          translateBusy ||
                          busy !== null
                        }
                        onClick={() => void applyZhOverwriteToCaption()}
                      >
                        {busy === "caption-merge" ? (
                          <Loader2 size={16} className="lf-icon-spin" aria-hidden style={{ marginRight: "0.35rem" }} />
                        ) : (
                          <ArrowRightLeft size={16} aria-hidden style={{ marginRight: "0.35rem" }} />
                        )}
                        {t("dataset.overwriteTagsFromZh")}
                      </button>
                    </div>
                  </div>
                  <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", lineHeight: 1.3 }}>
                    {t("dataset.captionZoneTranslated")}
                  </span>
                </div>
                <TranslatedCaptionEditor
                  ref={translatedCaptionEditorRef}
                  value={translatedCaption}
                  highlight={zhHlSafe}
                  disabled={busy !== null || translateBusy}
                  placeholder={translateBusy ? t("dataset.translateRefreshing") : ""}
                  onChange={(next) => {
                    setZhPartitionHighlight(null);
                    setTranslatedCaption(next);
                  }}
                  onPlainSelectionGesture={syncZhPartitionHighlightFromSelection}
                />
              </div>
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: 1.35 }}>
              {t("dataset.translateCaptionHint")}
            </div>
            {translateNotice ? (
              <div style={{ fontSize: "0.72rem", color: "var(--accent-orange)", lineHeight: 1.35 }}>
                {translateNotice}
              </div>
            ) : null}
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

      <DatasetContextMenu
        open={contextMenu !== null}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        items={buildDatasetContextMenuItems({
          contextMenu,
          selectedImagePaths,
          imagesUnderDirectory,
          openCreateGroupDialog,
          performMoveImagesToRoot,
          performRemoveGroup,
          setSelectedImagePaths,
          setSelectionAnchorPath,
          setPromptDialog,
          t,
          busy,
        })}
        onClose={() => setContextMenu(null)}
      />

      <DatasetPromptDialog
        open={promptDialog?.mode === "create-group"}
        title={t("dataset.groupCreate")}
        description={t("dataset.groupCreatePromptDesc")}
        defaultValue={promptDialog?.defaultValue ?? ""}
        confirmLabel={t("dataset.dialogConfirm")}
        cancelLabel={t("dataset.dialogCancel")}
        busy={promptBusy}
        onConfirm={(name) => {
          const parent = promptDialog?.targetPath || "";
          const paths = Array.from(selectedImagePaths);
          // Fall back to the directory's own images when the user opened the dialog
          // from a folder context menu without a multi-selection. This keeps the
          // single-folder "group" gesture symmetric with the multi-select gesture.
          const effectivePaths =
            paths.length > 0 ? paths : imagesUnderDirectory(promptDialog?.targetPath ?? "");
          void performCreateGroup(name, effectivePaths, parent || null);
        }}
        onCancel={() => setPromptDialog(null)}
      />

      <DatasetPromptDialog
        open={promptDialog?.mode === "rename-group"}
        title={t("dataset.groupRename")}
        description={undefined}
        defaultValue={promptDialog?.defaultValue ?? ""}
        confirmLabel={t("dataset.dialogConfirm")}
        cancelLabel={t("dataset.dialogCancel")}
        busy={promptBusy}
        onConfirm={(name) => {
          const target = promptDialog?.targetPath ?? "";
          if (!target) return;
          void performRenameGroup(target, name);
        }}
        onCancel={() => setPromptDialog(null)}
      />
    </div>
  );
}

/**
 * Computes the context-menu rows for the dataset sidebar based on what was right-clicked
 * (background / directory / image) and the current multi-selection. Kept as a pure
 * helper so the JSX in `DatasetEditor` stays focused on layout rather than menu wiring.
 */
function buildDatasetContextMenuItems(args: {
  contextMenu: { x: number; y: number; targetPath: string; targetKind: "image" | "directory" | "background" } | null;
  selectedImagePaths: Set<string>;
  imagesUnderDirectory: (dirPath: string) => string[];
  openCreateGroupDialog: (initialPaths: string[], parentPath: string | null) => boolean;
  performMoveImagesToRoot: (paths: string[]) => Promise<void> | void;
  performRemoveGroup: (groupPath: string, deleteContents: boolean) => Promise<void> | void;
  setSelectedImagePaths: (next: Set<string>) => void;
  setSelectionAnchorPath: (next: string | null) => void;
  setPromptDialog: (next: { mode: "rename-group"; targetPath: string; defaultValue: string } | null) => void;
  t: TranslateFn;
  busy: string | null;
}): DatasetContextMenuItem[] {
  const {
    contextMenu,
    selectedImagePaths,
    imagesUnderDirectory,
    openCreateGroupDialog,
    performMoveImagesToRoot,
    performRemoveGroup,
    setSelectedImagePaths,
    setSelectionAnchorPath,
    setPromptDialog,
    t,
    busy,
  } = args;

  if (!contextMenu) return [];
  const items: DatasetContextMenuItem[] = [];

  if (contextMenu.targetKind === "image") {
    const selectionSize = selectedImagePaths.size;
    const groupingPaths = Array.from(selectedImagePaths);
    const sameParent = groupingPaths.every(
      (p) => parentRelativePath(p) === parentRelativePath(groupingPaths[0] ?? ""),
    );
    const parent =
      sameParent && groupingPaths.length > 0
        ? parentRelativePath(groupingPaths[0]!)
        : "";

    items.push({
      key: "create-group",
      icon: <FolderPlus size={13} aria-hidden />,
      label:
        selectionSize > 1
          ? `${t("dataset.groupCreate")} (${selectionSize})`
          : t("dataset.groupCreate"),
      disabled: busy !== null || selectionSize === 0,
      onSelect: () => {
        openCreateGroupDialog(groupingPaths, parent || null);
      },
    });

    const hasNestedImage = groupingPaths.some((p) => parentRelativePath(p) !== "");
    items.push({
      key: "move-to-root",
      icon: <FolderInput size={13} aria-hidden />,
      label: t("dataset.moveToRoot"),
      disabled: busy !== null || !hasNestedImage,
      onSelect: () => {
        void performMoveImagesToRoot(groupingPaths.filter((p) => parentRelativePath(p) !== ""));
      },
    });

    items.push({
      key: "clear-selection",
      icon: <X size={13} aria-hidden />,
      label: t("dataset.contextClearSelection"),
      disabled: selectionSize === 0,
      onSelect: () => {
        setSelectedImagePaths(new Set());
        setSelectionAnchorPath(null);
      },
    });
    return items;
  }

  if (contextMenu.targetKind === "directory" && contextMenu.targetPath) {
    const dirPath = contextMenu.targetPath;
    const dirName = dirPath.split("/").pop() ?? dirPath;
    const innerImages = imagesUnderDirectory(dirPath);
    items.push({
      key: "rename-group",
      icon: <Edit3 size={13} aria-hidden />,
      label: t("dataset.groupRename"),
      disabled: busy !== null,
      onSelect: () => {
        setPromptDialog({
          mode: "rename-group",
          targetPath: dirPath,
          defaultValue: dirName,
        });
      },
    });
    items.push({
      key: "group-images-here",
      icon: <FolderPlus size={13} aria-hidden />,
      label: t("dataset.groupCreate"),
      disabled: busy !== null || innerImages.length === 0,
      onSelect: () => {
        openCreateGroupDialog(innerImages, dirPath);
      },
    });
    items.push({
      key: "remove-group",
      icon: <FolderMinus size={13} aria-hidden />,
      label: t("dataset.groupRemove"),
      disabled: busy !== null,
      onSelect: () => {
        void performRemoveGroup(dirPath, false);
      },
    });
    items.push({
      key: "remove-group-contents",
      icon: <FolderX size={13} aria-hidden />,
      label: t("dataset.groupRemoveContents"),
      disabled: busy !== null,
      danger: true,
      onSelect: () => {
        if (window.confirm(t("dataset.groupRemoveConfirm", { name: dirName }))) {
          void performRemoveGroup(dirPath, true);
        }
      },
    });
    return items;
  }

  // background
  if (selectedImagePaths.size > 0) {
    items.push({
      key: "create-group-bg",
      icon: <FolderPlus size={13} aria-hidden />,
      label: t("dataset.groupCreate"),
      disabled: busy !== null,
      onSelect: () => {
        const paths = Array.from(selectedImagePaths);
        const parents = new Set(paths.map((p) => parentRelativePath(p)));
        const parent = parents.size === 1 ? (parents.values().next().value ?? "") : "";
        openCreateGroupDialog(paths, parent || null);
      },
    });
    items.push({
      key: "clear-selection-bg",
      icon: <X size={13} aria-hidden />,
      label: t("dataset.contextClearSelection"),
      onSelect: () => {
        setSelectedImagePaths(new Set());
        setSelectionAnchorPath(null);
      },
    });
  } else {
    items.push({
      key: "noop",
      label: t("dataset.groupCreateNeedSelection"),
      disabled: true,
      onSelect: () => undefined,
    });
  }
  return items;
}
