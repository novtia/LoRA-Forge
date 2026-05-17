import { Edit3, FolderInput, FolderMinus, FolderPlus, FolderX, X } from "lucide-react";
import type { TranslateFn } from "../../../lib/i18n";
import type { DatasetContextMenuItem } from "./DatasetContextMenu";
import { parentRelativePath } from "./datasetTree";

/**
 * Computes the context-menu rows for the dataset sidebar based on what was right-clicked
 * (background / directory / image) and the current multi-selection. Kept as a pure
 * helper so the JSX in `DatasetEditor` stays focused on layout rather than menu wiring.
 */
export function buildDatasetContextMenuItems(args: {
  contextMenu: {
    x: number;
    y: number;
    targetPath: string;
    targetKind: "image" | "directory" | "background";
  } | null;
  selectedImagePaths: Set<string>;
  imagesUnderDirectory: (dirPath: string) => string[];
  openCreateGroupDialog: (initialPaths: string[], parentPath: string | null) => boolean;
  performMoveImagesToRoot: (paths: string[]) => Promise<void> | void;
  performRemoveGroup: (groupPath: string, deleteContents: boolean) => Promise<void> | void;
  setSelectedImagePaths: (next: Set<string>) => void;
  setSelectionAnchorPath: (next: string | null) => void;
  setPromptDialog: (
    next: { mode: "rename-group"; targetPath: string; defaultValue: string } | null,
  ) => void;
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
      sameParent && groupingPaths.length > 0 ? parentRelativePath(groupingPaths[0]!) : "";

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
