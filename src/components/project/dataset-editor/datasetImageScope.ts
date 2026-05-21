import type { DatasetEditorTriggerScope } from "../../../lib/datasetEditorPersistence";

/** Relative paths included in the current bulk scope (stable dataset listing order). */
export function resolveScopedImagePaths(
  scope: DatasetEditorTriggerScope,
  allImagePaths: string[],
  imagesUnderDirectory: (dirPath: string) => string[],
  groupPath: string,
  selectedPaths: Iterable<string>,
  existingPathSet: Set<string>,
): string[] {
  if (scope === "all") {
    return allImagePaths;
  }
  if (scope === "group") {
    return imagesUnderDirectory(groupPath);
  }
  return Array.from(selectedPaths).filter((p) => existingPathSet.has(p));
}
