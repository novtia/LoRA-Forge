const STORAGE_NS = "loraForge.preferredTrainingMode.v1";

export type PreferredTrainingMode = "sd-scripts" | "diffusion-pipe";

function key(projectId: string): string {
  return `${STORAGE_NS}:${projectId}`;
}

/** Persisted hint so other views (e.g. the dataset edit panel) can steer the
 * project detail page to a given training backend on next load. */
export function getPreferredTrainingMode(projectId: string): PreferredTrainingMode | null {
  if (typeof window === "undefined" || !projectId) return null;
  try {
    const raw = window.localStorage.getItem(key(projectId));
    return raw === "diffusion-pipe" || raw === "sd-scripts" ? raw : null;
  } catch {
    return null;
  }
}

export function setPreferredTrainingMode(projectId: string, mode: PreferredTrainingMode): void {
  if (typeof window === "undefined" || !projectId) return;
  try {
    window.localStorage.setItem(key(projectId), mode);
  } catch {
    // quota / private mode — ignore
  }
}
