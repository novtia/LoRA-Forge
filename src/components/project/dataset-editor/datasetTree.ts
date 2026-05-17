import type { DatasetEntry } from "../../../lib/types";

/**
 * Returns the parent dataset-relative path for `relativePath`, or `""` when the path
 * already lives at the dataset root. Mirrors the backend's `/`-separated convention so
 * that callers can feed the result straight back into other dataset commands without
 * an extra normalisation step.
 */
export function parentRelativePath(relativePath: string): string {
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
export type DatasetTreeNode = {
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
export function buildDatasetTree(entries: DatasetEntry[]): DatasetTreeNode[] {
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
export function flattenVisibleTree(
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
export function collectAllDirectoryPaths(nodes: DatasetTreeNode[], acc: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === "directory") {
      acc.push(node.relativePath);
      collectAllDirectoryPaths(node.children, acc);
    }
  }
  return acc;
}

/** When true, dataset image hotkeys should not run (user is editing text or a text-like control). */
export function isDatasetTypingTarget(target: EventTarget | null): boolean {
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
