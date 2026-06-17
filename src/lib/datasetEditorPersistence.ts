const STORAGE_NS = "loraForge.datasetEditorForm.v1";

export type DatasetEditorTriggerScope = "all" | "group" | "selection";

/**
 * 批量打标的执行方式：
 * - `sequential` — 一张接一张排队打标（默认，保留上一张 caption 作为上下文）。
 * - `parallel`   — 每张图各自独立并发打标，互不影响（速度快，无跨图上下文）。
 */
export type DatasetEditorBatchExecutionMode = "sequential" | "parallel";

/** Tagging workspace mode: standard single-image tagging vs. edit-model pair tagging. */
export type DatasetEditorMode = "normal" | "edit";

import type { CaptionTagMode } from "./types";

export type DatasetEditorFormPersist = {
  /** Active tagging workspace mode. */
  datasetMode: DatasetEditorMode;
  /** Optional notes sent with direct (auto) tagging. */
  llmDirectTagHint: string;
  /** Edit instruction for conversation modify mode. */
  llmConversationHint: string;
  /** Single-image LLM mode: direct tagging vs conversation modify. */
  llmTagMode: CaptionTagMode;
  triggerWord: string;
  /**
   * Insertion position for the trigger word, as a raw string captured from the UI input.
   *
   * Semantics (after trimming):
   * - Empty string or `"0"` → insert at the front (legacy default behaviour).
   * - Positive integer `N`  → insert immediately after the N-th existing tag, i.e. it becomes
   *   the (N+1)-th tag. When the caption has fewer than `N` tags, the trigger is appended at
   *   the end.
   * - `"-1"` (or any negative integer) → append at the end of the caption.
   *
   * Stored as the raw user input string so that an empty field is distinguishable from `0`
   * for future UX needs and is round-tripped verbatim through persistence.
   */
  triggerWordPosition: string;
  /** Which images receive bulk trigger-word insert/remove from the captions card. */
  triggerWordScope: DatasetEditorTriggerScope;
  /** Dataset-relative folder path when `triggerWordScope` is `group`; `""` means root-level images only. */
  triggerWordGroupPath: string;
  /** Which images are included in batch LLM tagging (independent from trigger-word scope). */
  batchTaggingScope: DatasetEditorTriggerScope;
  /** Dataset-relative folder path when `batchTaggingScope` is `group`; `""` means root-level images only. */
  batchTaggingGroupPath: string;
  imageRange: string;
  taggingMode: "all" | "range";
  /** Sequential (one-by-one) vs parallel (each image independent) batch execution. */
  batchExecutionMode: DatasetEditorBatchExecutionMode;
  /** When true, batch tagging skips images that already have a non-empty caption. */
  onlyUntagged: boolean;
  /** Vertical preview tool dock next to image (legacy key `showBatchPanel`). */
  previewDockOpen: boolean;
  /** Dataset-relative path of the last previewed image when leaving the editor. */
  lastImageRelativePath: string;
};

function key(projectId: string): string {
  return `${STORAGE_NS}:${projectId}`;
}

export function loadDatasetEditorFormPersist(projectId: string): DatasetEditorFormPersist | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<
      DatasetEditorFormPersist & { showBatchPanel?: boolean; llmUserHint?: string }
    >;
    if (typeof parsed !== "object" || parsed === null) return null;
    const taggingMode = parsed.taggingMode === "range" ? "range" : "all";
    const batchExecutionMode: DatasetEditorBatchExecutionMode =
      parsed.batchExecutionMode === "parallel" ? "parallel" : "sequential";
    const dockLegacy =
      typeof parsed.previewDockOpen === "boolean"
        ? parsed.previewDockOpen
        : typeof parsed.showBatchPanel === "boolean"
          ? parsed.showBatchPanel
          : false;
    const scopeRaw = parsed.triggerWordScope;
    const triggerWordScope: DatasetEditorTriggerScope =
      scopeRaw === "group" || scopeRaw === "selection" ? scopeRaw : "all";
    const batchScopeRaw = parsed.batchTaggingScope;
    const batchTaggingScope: DatasetEditorTriggerScope =
      batchScopeRaw === "group" || batchScopeRaw === "selection" ? batchScopeRaw : "all";
    const tagModeRaw = parsed.llmTagMode;
    const llmTagMode =
      tagModeRaw === "conversationModify" ? "conversationModify" : "direct";
    const datasetMode: DatasetEditorMode = parsed.datasetMode === "edit" ? "edit" : "normal";
    const legacyHint =
      typeof parsed.llmUserHint === "string" ? parsed.llmUserHint : "";
    const llmDirectTagHint =
      typeof parsed.llmDirectTagHint === "string"
        ? parsed.llmDirectTagHint
        : llmTagMode === "direct"
          ? legacyHint
          : "";
    const llmConversationHint =
      typeof parsed.llmConversationHint === "string"
        ? parsed.llmConversationHint
        : llmTagMode === "conversationModify"
          ? legacyHint
          : "";
    return {
      datasetMode,
      llmDirectTagHint,
      llmConversationHint,
      llmTagMode,
      triggerWord: typeof parsed.triggerWord === "string" ? parsed.triggerWord : "",
      triggerWordPosition:
        typeof parsed.triggerWordPosition === "string" ? parsed.triggerWordPosition : "",
      triggerWordScope,
      triggerWordGroupPath:
        typeof parsed.triggerWordGroupPath === "string" ? parsed.triggerWordGroupPath : "",
      batchTaggingScope,
      batchTaggingGroupPath:
        typeof parsed.batchTaggingGroupPath === "string" ? parsed.batchTaggingGroupPath : "",
      imageRange: typeof parsed.imageRange === "string" ? parsed.imageRange : "",
      taggingMode,
      batchExecutionMode,
      onlyUntagged: typeof parsed.onlyUntagged === "boolean" ? parsed.onlyUntagged : false,
      previewDockOpen: dockLegacy,
      lastImageRelativePath:
        typeof parsed.lastImageRelativePath === "string" ? parsed.lastImageRelativePath : "",
    };
  } catch {
    return null;
  }
}

export function saveDatasetEditorFormPersist(projectId: string, value: DatasetEditorFormPersist): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(projectId), JSON.stringify(value));
  } catch {
    // quota / private mode — ignore
  }
}
