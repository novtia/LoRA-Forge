const STORAGE_NS = "loraForge.datasetEditorForm.v1";

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
  imageRange: string;
  taggingMode: "all" | "range";
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
    return {
      llmUserHint: typeof parsed.llmUserHint === "string" ? parsed.llmUserHint : "",
      triggerWord: typeof parsed.triggerWord === "string" ? parsed.triggerWord : "",
      triggerWordPosition:
        typeof parsed.triggerWordPosition === "string" ? parsed.triggerWordPosition : "",
      imageRange: typeof parsed.imageRange === "string" ? parsed.imageRange : "",
      taggingMode,
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
