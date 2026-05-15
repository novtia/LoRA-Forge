const STORAGE_NS = "loraForge.datasetEditorForm.v1";

export type DatasetEditorFormPersist = {
  llmUserHint: string;
  triggerWord: string;
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
