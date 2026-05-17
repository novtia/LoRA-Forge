import { listDatasetEntries } from "../../../lib/desktopApi";
import type { DatasetEntry } from "../../../lib/types";

/**
 * Re-loads the dataset directory + image listing from the backend. Call after any
 * mutation that creates/removes/renames folders or moves/deletes images so the left
 * sidebar tree always reflects disk state (single source of truth).
 */
export function pullDatasetSidebarEntries(projectId: string): Promise<DatasetEntry[]> {
  return listDatasetEntries(projectId);
}

/**
 * Runs a mutating command, then always re-fetches the listing so the sidebar cannot
 * rely only on the command’s returned snapshot.
 */
export async function withDatasetSidebarRefresh<T>(
  projectId: string,
  mutate: () => Promise<T>,
): Promise<{ result: T; fresh: DatasetEntry[] }> {
  const result = await mutate();
  const fresh = await pullDatasetSidebarEntries(projectId);
  return { result, fresh };
}
