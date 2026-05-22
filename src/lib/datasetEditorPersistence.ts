const STORAGE_NS = "loraForge.datasetEditorForm.v1";

export type DatasetEditorTriggerScope = "all" | "group" | "selection";

export type DatasetEditorFormPersist = {
  llmUserHint: string;
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
  /** When true, batch tagging skips images that already have a non-empty caption. */
  onlyUntagged: boolean;
  /** Vertical preview tool dock next to image (legacy key `showBatchPanel`). */
  previewDockOpen: boolean;
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
      DatasetEditorFormPersist & { showBatchPanel?: boolean }
    >;
    if (typeof parsed !== "object" || parsed === null) return null;
    const taggingMode = parsed.taggingMode === "range" ? "range" : "all";
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
    return {
      llmUserHint: typeof parsed.llmUserHint === "string" ? parsed.llmUserHint : "",
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
      onlyUntagged: typeof parsed.onlyUntagged === "boolean" ? parsed.onlyUntagged : false,
      previewDockOpen: dockLegacy,
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
