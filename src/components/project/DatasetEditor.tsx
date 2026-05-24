import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  autoTagImage,
  baiduTranslate,
  clearApiLogs,
  deleteDatasetImage,
  getDatasetAsset,
  getRecentApiLogs,
  groupDatasetImages,
  listUntaggedImagePaths,
  moveDatasetImages,
  readCaption,
  removeDatasetGroup,
  renameDatasetGroup,
  setDatasetGroupType,
  loadTrainingConfig,
  writeCaption,
} from "../../lib/desktopApi";
import { useI18n } from "../../lib/i18n";
import { looksLikeStyleArtistTrainingConfig } from "../../lib/presets";
import {
  loadDatasetEditorFormPersist,
  saveDatasetEditorFormPersist,
  type DatasetEditorTriggerScope,
} from "../../lib/datasetEditorPersistence";
import { contiguousTagRangeForSelection, splitCaptionTags, charRangeForContiguousTagIndices } from "../../lib/captionSegments";
import type { ApiLogEntry, CaptionTagMode, DatasetAsset, DatasetEntry } from "../../lib/types";
import type { TranslatedCaptionEditorHandle } from "./TranslatedCaptionEditor";
import { buildDatasetContextMenuItems } from "./dataset-editor/buildDatasetContextMenuItems";
import { DatasetContextMenu } from "./dataset-editor/DatasetContextMenu";
import { DatasetEditorCaptionsCard } from "./dataset-editor/DatasetEditorCaptionsCard";
import { DatasetEditorPreviewCard } from "./dataset-editor/DatasetEditorPreviewCard";
import { DatasetEditorSidebar } from "./dataset-editor/DatasetEditorSidebar";
import { DatasetPromptDialog } from "./dataset-editor/DatasetPromptDialog";
import {
  buildCaptionWithTriggerAt,
  getErrorMessage,
  isCaptionCancelledError,
  parseBatchImageRange,
  parseTriggerWordPosition,
  removeTriggerWordFromCaptionAllSegments,
} from "./dataset-editor/datasetEditorHelpers";
import type { BatchProgress } from "./dataset-editor/datasetEditorTypes";
import { pullDatasetSidebarEntries, withDatasetSidebarRefresh } from "./dataset-editor/datasetSidebarSync";
import { resolveScopedImagePaths } from "./dataset-editor/datasetImageScope";
import {
  buildDatasetTree,
  collectAllDirectoryPaths,
  flattenVisibleTree,
  isDatasetTypingTarget,
  parentRelativePath,
} from "./dataset-editor/datasetTree";

interface DatasetEditorProps {
  projectId: string;
  initialImagePath?: string;
}

export default function DatasetEditor({ projectId, initialImagePath }: DatasetEditorProps) {
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
  const [batchTaggingScope, setBatchTaggingScope] = useState<DatasetEditorTriggerScope>("all");
  /** Folder path when `batchTaggingScope === "group"`; "" = images at dataset root only. */
  const [batchTaggingGroupPath, setBatchTaggingGroupPath] = useState("");
  const [imageRange, setImageRange] = useState("");
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [onlyUntagged, setOnlyUntagged] = useState(false);
  /** null = not loaded yet; string[] = paths of untagged images in current batch scope */
  const [untaggedPaths, setUntaggedPaths] = useState<string[] | null>(null);
  const [triggerWord, setTriggerWord] = useState("");
  /**
   * Raw user input for the insertion slot of the trigger word.
   * See `parseTriggerWordPosition` for the supported value grammar.
   */
  const [triggerWordPosition, setTriggerWordPosition] = useState("");
  const [triggerWordScope, setTriggerWordScope] = useState<DatasetEditorTriggerScope>("all");
  /** Folder path when `triggerWordScope === "group"`; "" = images at dataset root only. */
  const [triggerWordGroupPath, setTriggerWordGroupPath] = useState("");
  /** Optional notes for direct LLM auto-tagging. */
  const [llmDirectTagHint, setLlmDirectTagHint] = useState("");
  /** Edit instruction for conversation modify mode. */
  const [llmConversationHint, setLlmConversationHint] = useState("");
  /** Single-image LLM mode: direct tagging vs conversation modify. */
  const [llmTagMode, setLlmTagMode] = useState<CaptionTagMode>("direct");
  const [styleTrainingCaptions, setStyleTrainingCaptions] = useState(false);
  /** Avoid writing another project's form snapshot before hydrate completes (projectId switch). */
  const [persistReadyProjectId, setPersistReadyProjectId] = useState<string | null>(null);
  /** Restored from localStorage on projectId change; used once when imageEntries first loads. */
  const lastRestoredImagePathRef = useRef<string | null>(null);
  const initialImageNavigatedRef = useRef(false);
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
    targetGroupType?: import("../../lib/types").DatasetGroupType;
  } | null>(null);
  /** Modal prompt currently open in the sidebar (create / rename group). */
  const [promptDialog, setPromptDialog] = useState<{
    mode: "create-group" | "rename-group";
    targetPath: string;
    defaultValue: string;
  } | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);

  const [translatedCaption, setTranslatedCaption] = useState("");
  /** 鎷栧姩閫変腑杩炵画鏍囩鍒嗗尯鍚庢寔涔呴珮浜紙璇戞枃鏍囩涓嬫爣 + 瀛楃鍖洪棿锛夈€?*/
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
    const datasetEntries = await pullDatasetSidebarEntries(projectId);
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
    setLlmDirectTagHint(saved?.llmDirectTagHint ?? "");
    setLlmConversationHint(saved?.llmConversationHint ?? "");
    setLlmTagMode(saved?.llmTagMode === "conversationModify" ? "conversationModify" : "direct");
    setTriggerWord(saved?.triggerWord ?? "");
    setTriggerWordPosition(saved?.triggerWordPosition ?? "");
    setTriggerWordScope(saved?.triggerWordScope ?? "all");
    setTriggerWordGroupPath(saved?.triggerWordGroupPath ?? "");
    setBatchTaggingScope(saved?.batchTaggingScope ?? "all");
    setBatchTaggingGroupPath(saved?.batchTaggingGroupPath ?? "");
    setImageRange(saved?.imageRange ?? "");
    setTaggingMode(saved?.taggingMode === "range" ? "range" : "all");
    setOnlyUntagged(Boolean(saved?.onlyUntagged));
    setPreviewDockOpen(Boolean(saved?.previewDockOpen));
    lastRestoredImagePathRef.current = saved?.lastImageRelativePath?.trim() || null;
    initialImageNavigatedRef.current = false;
    setSelectedImageIndex(-1);
    setPersistReadyProjectId(projectId);
  }, [projectId]);

  useEffect(() => {
    let mounted = true;
    void loadTrainingConfig(projectId)
      .then((cfg) => {
        if (mounted) {
          setStyleTrainingCaptions(looksLikeStyleArtistTrainingConfig(cfg));
        }
      })
      .catch(() => {
        if (mounted) {
          setStyleTrainingCaptions(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (persistReadyProjectId !== projectId) return;
    const imgs = entries.filter((entry) => entry.kind === "image");
    const activePath =
      selectedImageIndex >= 0 && imgs[selectedImageIndex]
        ? imgs[selectedImageIndex]!.relativePath
        : loadDatasetEditorFormPersist(projectId)?.lastImageRelativePath ?? "";
    saveDatasetEditorFormPersist(projectId, {
      llmDirectTagHint,
      llmConversationHint,
      llmTagMode,
      triggerWord,
      triggerWordPosition,
      triggerWordScope,
      triggerWordGroupPath,
      batchTaggingScope,
      batchTaggingGroupPath,
      imageRange,
      taggingMode,
      onlyUntagged,
      previewDockOpen,
      lastImageRelativePath: activePath,
    });
  }, [
    persistReadyProjectId,
    projectId,
    entries,
    selectedImageIndex,
    llmDirectTagHint,
    llmConversationHint,
    llmTagMode,
    triggerWord,
    triggerWordPosition,
    triggerWordScope,
    triggerWordGroupPath,
    batchTaggingScope,
    batchTaggingGroupPath,
    imageRange,
    taggingMode,
    onlyUntagged,
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

  /** Lookup: image relativePath 鈫?position in the visible tree, for range selection. */
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
   * - plain click  鈫?preview the image and become the sole selection (the active
   *   preview always belongs to the selection set so batch operations include it).
   * - Ctrl / Cmd  鈫?toggle this image in/out of the selection set; the anchor moves
   *   to whichever path was just touched.
   * - Shift       鈫?select every visible image between the anchor and this row,
   *   merging with the existing set so the user can extend a range.
   */
  const handleImageRowClick = useCallback(
    (relativePath: string, ev: ReactMouseEvent) => {
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
      if (!dirPath) {
        return imageEntries
          .filter((entry) => parentRelativePath(entry.relativePath) === "")
          .map((entry) => entry.relativePath);
      }
      const prefix = dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
      return imageEntries
        .filter((entry) => entry.relativePath.startsWith(prefix))
        .map((entry) => entry.relativePath);
    },
    [imageEntries],
  );

  /** Sidebar folder rows for the trigger-word "group" scope dropdown (sorted path order). */
  const triggerGroupFolderOptions = useMemo(() => {
    const dirs = entries.filter((e) => e.kind === "directory");
    dirs.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    return dirs.map((d) => ({
      value: d.relativePath,
      depth: d.depth,
      label: d.relativePath,
    }));
  }, [entries]);

  const existingImagePathSet = useMemo(
    () => new Set(imageEntries.map((e) => e.relativePath)),
    [imageEntries],
  );

  const allImagePaths = useMemo(
    () => imageEntries.map((e) => e.relativePath),
    [imageEntries],
  );

  /** Relative paths that receive bulk trigger insert/remove for the current scope UI. */
  const triggerTargetPaths = useMemo(
    () =>
      resolveScopedImagePaths(
        triggerWordScope,
        allImagePaths,
        imagesUnderDirectory,
        triggerWordGroupPath,
        selectedImagePaths,
        existingImagePathSet,
      ),
    [
      allImagePaths,
      existingImagePathSet,
      imagesUnderDirectory,
      selectedImagePaths,
      triggerWordGroupPath,
      triggerWordScope,
    ],
  );

  /** Images included in batch LLM tagging for the current batch scope UI. */
  const batchTaggingTargetEntries = useMemo(() => {
    const pathSet = new Set(
      resolveScopedImagePaths(
        batchTaggingScope,
        allImagePaths,
        imagesUnderDirectory,
        batchTaggingGroupPath,
        selectedImagePaths,
        existingImagePathSet,
      ),
    );
    return imageEntries.filter((e) => pathSet.has(e.relativePath));
  }, [
    allImagePaths,
    batchTaggingGroupPath,
    batchTaggingScope,
    existingImagePathSet,
    imageEntries,
    imagesUnderDirectory,
    selectedImagePaths,
  ]);

  // Reactively compute which images in the current batch scope are untagged.
  // Runs whenever the scope, target entries, or onlyUntagged toggle changes.
  // Results drive both the count in the flyout and the sidebar highlight.
  useEffect(() => {
    if (!onlyUntagged || batchTaggingTargetEntries.length === 0) {
      setUntaggedPaths(onlyUntagged ? [] : null);
      return;
    }
    let cancelled = false;
    const scopePaths = batchTaggingTargetEntries.map((e) => e.relativePath);
    listUntaggedImagePaths(projectId, scopePaths)
      .then((untagged) => {
        if (!cancelled) setUntaggedPaths(untagged);
      })
      .catch(() => {
        if (!cancelled) setUntaggedPaths([]);
      });
    return () => {
      cancelled = true;
    };
  }, [onlyUntagged, batchTaggingTargetEntries, projectId]);

  /** Derived count used by the preview flyout. */
  const untaggedCount = untaggedPaths?.length ?? null;

  /** Set for O(1) lookups in the sidebar row renderer. */
  const untaggedPathSet = useMemo(
    () => (untaggedPaths ? new Set(untaggedPaths) : null),
    [untaggedPaths],
  );

  useEffect(() => {
    if (triggerWordScope !== "group") return;
    if (triggerWordGroupPath === "") return;
    const stillExists = entries.some(
      (e) => e.kind === "directory" && e.relativePath === triggerWordGroupPath,
    );
    if (!stillExists) {
      setTriggerWordGroupPath("");
    }
  }, [entries, triggerWordGroupPath, triggerWordScope]);

  useEffect(() => {
    if (batchTaggingScope !== "group") return;
    if (batchTaggingGroupPath === "") return;
    const stillExists = entries.some(
      (e) => e.kind === "directory" && e.relativePath === batchTaggingGroupPath,
    );
    if (!stillExists) {
      setBatchTaggingGroupPath("");
    }
  }, [batchTaggingGroupPath, batchTaggingScope, entries]);

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
        const { fresh } = await withDatasetSidebarRefresh(projectId, () =>
          groupDatasetImages(projectId, relativePaths, groupName, parentPath ?? null),
        );

        // Diff old vs new directory entries to discover which group folder the
        // backend actually created. The user-supplied name is only a hint 鈥?collisions
        // get suffixed (`name (2)` etc.), so we cannot reconstruct the path purely
        // from the input. By taking the directory diff we get the authoritative new
        // path back from the listing the backend just returned, which keeps the UI
        // truthful even if the rename rules change later.
        const oldDirs = new Set(
          entries.filter((e) => e.kind === "directory").map((e) => e.relativePath),
        );
        const newGroupPaths = fresh
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
          movedImagePaths = fresh
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

        await reloadEntriesPreserveSelection(fresh, newActivePath);
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
        const { fresh } = await withDatasetSidebarRefresh(projectId, () =>
          renameDatasetGroup(projectId, groupPath, newName),
        );
        // The current asset path may include the renamed group as a prefix; rewrite
        // to the new prefix when possible so the preview keeps pointing at the same
        // file rather than snapping back to image #0.
        const oldPrefix = groupPath.endsWith("/") ? groupPath : `${groupPath}/`;
        const currentPath = asset?.relativePath ?? null;
        let preferred: string | null = currentPath;
        if (currentPath && currentPath.startsWith(oldPrefix)) {
          const basename = currentPath.slice(oldPrefix.length);
          const candidate = fresh.find(
            (entry) =>
              entry.kind === "image" && entry.relativePath.endsWith(`/${basename}`),
          );
          preferred = candidate?.relativePath ?? currentPath;
        }
        await reloadEntriesPreserveSelection(fresh, preferred);
        setPromptDialog(null);
      } catch (e) {
        setError(t("dataset.groupActionFailed", { error: getErrorMessage(e, "") }));
      } finally {
        setPromptBusy(false);
      }
    },
    [asset?.relativePath, projectId, reloadEntriesPreserveSelection, t],
  );

  /**
   * Moves images (and sibling captions on disk) into `targetRelativePath` — use `""`
   * for the dataset root. Skips paths already in that folder. Expands the target
   * folder and updates multi-selection when new paths can be resolved.
   */
  const performMoveImagesToTarget = useCallback(
    async (paths: string[], targetRelativePath: string) => {
      const normalizedTarget = targetRelativePath.replace(/^\/+|\/+$/g, "");
      const unique = [...new Set(paths.map((p) => p.trim()).filter(Boolean))];
      const toMove = unique.filter((p) => parentRelativePath(p) !== normalizedTarget);
      if (toMove.length === 0) return;

      setError(null);
      try {
        const { fresh } = await withDatasetSidebarRefresh(projectId, () =>
          moveDatasetImages(projectId, toMove, normalizedTarget),
        );

        if (normalizedTarget) {
          setExpandedDirs((prev) => {
            const next = new Set(prev);
            next.add(normalizedTarget);
            let cursor = parentRelativePath(normalizedTarget);
            while (cursor) {
              next.add(cursor);
              cursor = parentRelativePath(cursor);
            }
            return next;
          });
        }

        const prefix = normalizedTarget ? `${normalizedTarget}/` : "";
        const newSelection = new Set<string>();
        for (const oldPath of toMove) {
          const base = oldPath.split("/").pop() ?? "";
          const expectedRel = prefix ? `${prefix}${base}` : base;
          const found = fresh.find((e) => e.kind === "image" && e.relativePath === expectedRel);
          if (found) {
            newSelection.add(found.relativePath);
          }
        }

        const previousActive = asset?.relativePath ?? null;
        let newActivePath: string | null = null;
        if (previousActive && toMove.includes(previousActive)) {
          const base = previousActive.split("/").pop() ?? "";
          const expectedRel = prefix ? `${prefix}${base}` : base;
          newActivePath =
            fresh.find((e) => e.kind === "image" && e.relativePath === expectedRel)?.relativePath ??
            null;
        } else if (previousActive) {
          newActivePath = previousActive;
        }

        await reloadEntriesPreserveSelection(fresh, newActivePath);
        setSelectedImagePaths(newSelection);
        setSelectionAnchorPath(newSelection.size > 0 ? [...newSelection][0]! : null);
      } catch (e) {
        setError(t("dataset.groupActionFailed", { error: getErrorMessage(e, "") }));
      }
    },
    [asset?.relativePath, projectId, reloadEntriesPreserveSelection, t],
  );

  const performMoveImagesToRoot = useCallback(
    async (paths: string[]) => {
      await performMoveImagesToTarget(paths, "");
    },
    [performMoveImagesToTarget],
  );

  const performRemoveGroup = useCallback(
    async (groupPath: string, deleteContents: boolean) => {
      setError(null);
      try {
        const { fresh } = await withDatasetSidebarRefresh(projectId, () =>
          removeDatasetGroup(projectId, groupPath, deleteContents),
        );
        await reloadEntriesPreserveSelection(fresh, null);
        setSelectedImagePaths(new Set());
        setSelectionAnchorPath(null);
      } catch (e) {
        setError(t("dataset.groupActionFailed", { error: getErrorMessage(e, "") }));
      }
    },
    [projectId, reloadEntriesPreserveSelection, t],
  );

  const performSetGroupType = useCallback(
    async (groupPath: string, groupType: "normal" | "reg") => {
      setError(null);
      try {
        const { fresh } = await withDatasetSidebarRefresh(projectId, () =>
          setDatasetGroupType(projectId, groupPath, groupType),
        );
        await reloadEntriesPreserveSelection(fresh, null);
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
      if (currentIndex >= 0) {
        return Math.min(currentIndex, imageEntries.length - 1);
      }

      if (initialImagePath && !initialImageNavigatedRef.current) {
        const initialIdx = imageEntries.findIndex((e) => e.relativePath === initialImagePath);
        initialImageNavigatedRef.current = true;
        if (initialIdx >= 0) {
          return initialIdx;
        }
      }

      const savedPath = lastRestoredImagePathRef.current;
      if (savedPath) {
        const savedIdx = imageEntries.findIndex((e) => e.relativePath === savedPath);
        if (savedIdx >= 0) {
          return savedIdx;
        }
      }

      return 0;
    });
  }, [imageEntries, initialImagePath]);

  const currentImage = selectedImageIndex >= 0 ? imageEntries[selectedImageIndex] ?? null : null;

  useEffect(() => {
    setZhPartitionHighlight(null);
  }, [currentImage?.relativePath]);

  const batchRangeHighlightPaths = useMemo(() => {
    if (!previewDockOpen || !batchFlyoutOpen || taggingMode !== "range") return null;
    const range = parseBatchImageRange(imageRange, batchTaggingTargetEntries.length);
    if (!range) return null;
    const slice = batchTaggingTargetEntries.slice(range.start - 1, range.end);
    return new Set(slice.map((e) => e.relativePath));
  }, [
    previewDockOpen,
    batchFlyoutOpen,
    taggingMode,
    imageRange,
    batchTaggingTargetEntries,
  ]);

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
  // navigation handler intentionally bails out as soon as Ctrl/Meta is held 鈥?adding
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
      const deletedPath = asset.relativePath;
      const deletedIndex = imageEntries.findIndex((entry) => entry.relativePath === deletedPath);
      const { fresh } = await withDatasetSidebarRefresh(projectId, () =>
        deleteDatasetImage(projectId, deletedPath),
      );
      const nextImages = fresh.filter((entry) => entry.kind === "image");
      const preferred: string | null =
        nextImages.length === 0
          ? null
          : (nextImages[Math.min(deletedIndex < 0 ? 0 : deletedIndex, nextImages.length - 1)]?.relativePath ??
            null);
      await reloadEntriesPreserveSelection(fresh, preferred);
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, t("errors.deleteImage")));
    } finally {
      setBusy(null);
    }
  };

  const applyGeneratedCaption = async () => {
    if (!asset) return;
    const isConversation = llmTagMode === "conversationModify";
    const hint = (isConversation ? llmConversationHint : llmDirectTagHint).trim();
    if (isConversation && hint.length === 0) {
      setError(t("dataset.modifyCaptionNeedHint"));
      return;
    }
    if (isConversation && caption.trim().length === 0) {
      setError(t("dataset.modifyCaptionNeedCaption"));
      return;
    }
    setBusy("llm");
    setError(null);

    let previousAssistantCaption: string | undefined;
    let previousImageRelativePath: string | undefined;
    if (!isConversation && previousImage) {
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
        llmTagMode,
        isConversation ? caption : undefined,
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
    if (batchTaggingTargetEntries.length === 0 || busy !== null) {
      if (imageEntries.length > 0 && batchTaggingTargetEntries.length === 0) {
        setError(t("dataset.batchTaggingScope.empty"));
      }
      return;
    }

    let targets: DatasetEntry[];
    if (taggingMode === "all") {
      targets = batchTaggingTargetEntries;
    } else {
      const range = parseBatchImageRange(imageRange, batchTaggingTargetEntries.length);
      if (!range) {
        setError(t("dataset.batchInvalidRange"));
        return;
      }
      targets = batchTaggingTargetEntries.slice(range.start - 1, range.end);
    }

    // When "only untagged" is active, filter to images that have no caption yet.
    if (onlyUntagged && targets.length > 0) {
      const untaggedPaths = new Set(
        await listUntaggedImagePaths(
          projectId,
          targets.map((e) => e.relativePath),
        ),
      );
      targets = targets.filter((e) => untaggedPaths.has(e.relativePath));
    }

    if (targets.length === 0) {
      setError(t("dataset.batchNoUntagged"));
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
          const hint = llmDirectTagHint.trim();
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
    batchTaggingTargetEntries,
    currentImage?.relativePath,
    imageEntries.length,
    imageRange,
    loadAsset,
    onlyUntagged,
    projectId,
    taggingMode,
    t,
    llmDirectTagHint,
  ]);

  const applyTriggerWordToAll = useCallback(async () => {
    const tw = triggerWord.trim();
    if (!tw) {
      setError(t("dataset.triggerWordEmpty"));
      return;
    }
    if (triggerTargetPaths.length === 0 || busy !== null) {
      return;
    }

    const positionIndex = parseTriggerWordPosition(triggerWordPosition);

    setBusy("trigger-all");
    setError(null);
    try {
      for (const relativePath of triggerTargetPaths) {
        const raw = await readCaption(projectId, relativePath);
        const trimmed = raw.trim();
        const next = buildCaptionWithTriggerAt(trimmed, tw, positionIndex);
        if (next !== null) {
          await writeCaption(projectId, relativePath, next);
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
  }, [
    busy,
    currentImage,
    loadAsset,
    projectId,
    t,
    triggerTargetPaths,
    triggerWord,
    triggerWordPosition,
  ]);

  const removeTriggerWordFromAll = useCallback(async () => {
    const tw = triggerWord.trim();
    if (!tw) {
      setError(t("dataset.triggerWordEmpty"));
      return;
    }
    if (triggerTargetPaths.length === 0 || busy !== null) {
      return;
    }

    setBusy("trigger-remove");
    setError(null);
    try {
      for (const relativePath of triggerTargetPaths) {
        const raw = await readCaption(projectId, relativePath);
        const trimmed = raw.trim();
        const next = removeTriggerWordFromCaptionAllSegments(trimmed, tw);
        if (next !== null) {
          await writeCaption(projectId, relativePath, next);
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
  }, [busy, currentImage, loadAsset, projectId, t, triggerTargetPaths, triggerWord]);

  return (
    <div className="bento bento-detail view-dataset">
      <DatasetEditorSidebar
        busy={busy}
        imageEntries={imageEntries}
        datasetTree={datasetTree}
        visibleTreeRows={visibleTreeRows}
        expandedDirs={expandedDirs}
        selectedImagePaths={selectedImagePaths}
        assetRelativePath={asset?.relativePath}
        batchRangeHighlightPaths={batchRangeHighlightPaths}
        untaggedImagePaths={untaggedPathSet}
        batchProgress={batchProgress}
        onToolbarCreateGroup={() => {
          const paths = Array.from(selectedImagePaths);
          const parents = new Set(paths.map((p) => parentRelativePath(p)));
          const parent = parents.size === 1 ? (parents.values().next().value ?? "") : "";
          openCreateGroupDialog(paths, parent || null);
        }}
        onExpandAll={() => setExpandedDirs(new Set(collectAllDirectoryPaths(datasetTree)))}
        onCollapseAll={() => setExpandedDirs(new Set())}
        onToggleDirectory={toggleDirectoryExpansion}
        onMoveImagesToFolder={(paths, targetRelativePath) => {
          void performMoveImagesToTarget(paths, targetRelativePath);
        }}
        onImageRowClick={handleImageRowClick}
        onImageRowContextMenu={(ev, relativePath) => {
          if (!selectedImagePaths.has(relativePath)) {
            setSelectedImagePaths(new Set([relativePath]));
            setSelectionAnchorPath(relativePath);
            void openImage(relativePath);
          }
          setContextMenu({
            x: ev.clientX,
            y: ev.clientY,
            targetPath: relativePath,
            targetKind: "image",
          });
        }}
        onDirectoryRowContextMenu={(ev, relativePath) => {
          ev.preventDefault();
          const dirEntry = entries.find(
            (e) => e.kind === "directory" && e.relativePath === relativePath,
          );
          setContextMenu({
            x: ev.clientX,
            y: ev.clientY,
            targetPath: relativePath,
            targetKind: "directory",
            targetGroupType: dirEntry?.groupType,
          });
        }}
        onBackgroundContextMenu={(ev) => {
          ev.preventDefault();
          setContextMenu({
            x: ev.clientX,
            y: ev.clientY,
            targetPath: "",
            targetKind: "background",
          });
        }}
      />

      <DatasetEditorPreviewCard
        asset={asset}
        imageEntriesLength={imageEntries.length}
        batchTaggingTargetCount={batchTaggingTargetEntries.length}
        selectedImageIndex={selectedImageIndex}
        previewDockOpen={previewDockOpen}
        batchFlyoutOpen={batchFlyoutOpen}
        apiLogDrawerOpen={apiLogDrawerOpen}
        setPreviewDockOpen={setPreviewDockOpen}
        setBatchFlyoutOpen={setBatchFlyoutOpen}
        setApiLogDrawerOpen={setApiLogDrawerOpen}
        batchTaggingScope={batchTaggingScope}
        setBatchTaggingScope={setBatchTaggingScope}
        batchTaggingGroupPath={batchTaggingGroupPath}
        setBatchTaggingGroupPath={setBatchTaggingGroupPath}
        batchTaggingFolderOptions={triggerGroupFolderOptions}
        taggingMode={taggingMode}
        setTaggingMode={setTaggingMode}
        imageRange={imageRange}
        setImageRange={setImageRange}
        busy={busy}
        batchProgress={batchProgress}
        onlyUntagged={onlyUntagged}
        setOnlyUntagged={setOnlyUntagged}
        untaggedCount={untaggedCount}
        apiLogLines={apiLogLines}
        runBatchTagging={runBatchTagging}
        refreshApiLogs={refreshApiLogs}
        clearApiLogs={handleClearApiLogs}
        previousImage={previousImage}
        nextImage={nextImage}
        openImage={openImage}
      />

      <DatasetEditorCaptionsCard
        asset={asset}
        busy={busy}
        imageEntriesLength={imageEntries.length}
        onAutoTag={applyGeneratedCaption}
        llmTagMode={llmTagMode}
        setLlmTagMode={setLlmTagMode}
        llmDirectTagHint={llmDirectTagHint}
        setLlmDirectTagHint={setLlmDirectTagHint}
        llmConversationHint={llmConversationHint}
        setLlmConversationHint={setLlmConversationHint}
        triggerWord={triggerWord}
        setTriggerWord={setTriggerWord}
        triggerWordScope={triggerWordScope}
        setTriggerWordScope={setTriggerWordScope}
        triggerWordGroupPath={triggerWordGroupPath}
        setTriggerWordGroupPath={setTriggerWordGroupPath}
        triggerGroupFolderOptions={triggerGroupFolderOptions}
        triggerTargetCount={triggerTargetPaths.length}
        triggerWordPosition={triggerWordPosition}
        setTriggerWordPosition={setTriggerWordPosition}
        caption={caption}
        setCaption={setCaption}
        translatedCaption={translatedCaption}
        translateBusy={translateBusy}
        translateNotice={translateNotice}
        captionTagCountAligned={captionTagCountAligned}
        zhHlSafe={zhHlSafe}
        translatedCaptionEditorRef={translatedCaptionEditorRef}
        onTranslatedCaptionChange={(next) => {
          setZhPartitionHighlight(null);
          setTranslatedCaption(next);
        }}
        onPlainSelectionGesture={syncZhPartitionHighlightFromSelection}
        onTranslateNow={() => runBaiduCaptionTranslate()}
        onApplyZhSelectionToCaption={applyZhSelectionToCaption}
        onApplyZhOverwriteToCaption={applyZhOverwriteToCaption}
        onSave={handleSave}
        onDelete={handleDelete}
        onApplyTriggerWordToAll={applyTriggerWordToAll}
        onRemoveTriggerWordFromAll={removeTriggerWordFromAll}
        showStyleCaptionHint={styleTrainingCaptions}
        error={error}
      />


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
          performSetGroupType,
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
