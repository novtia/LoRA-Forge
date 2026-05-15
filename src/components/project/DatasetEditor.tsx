import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FolderTree,
  FolderOpen,
  Eye,
  Image,
  Tags,
  Bot,
  Languages,
  ArrowRightLeft,
  Save,
  Trash,
  ChevronLeft,
  ChevronRight,
  X,
  PlusCircle,
  MinusCircle,
  Loader2,
  MousePointer2,
  StopCircle,
  SidebarOpen,
  ScrollText,
} from "lucide-react";
import {
  autoTagImage,
  baiduTranslate,
  cancelLlmCaption,
  clearApiLogs,
  deleteDatasetImage,
  getDatasetAsset,
  getRecentApiLogs,
  listDatasetEntries,
  readCaption,
  writeCaption,
} from "../../lib/desktopApi";
import FileAssetImage from "../FileAssetImage";
import TranslatedCaptionEditor, {
  type TranslatedCaptionEditorHandle,
} from "./TranslatedCaptionEditor";
import { useI18n } from "../../lib/i18n";
import {
  loadDatasetEditorFormPersist,
  saveDatasetEditorFormPersist,
} from "../../lib/datasetEditorPersistence";
import { contiguousTagRangeForSelection, splitCaptionTags, charRangeForContiguousTagIndices } from "../../lib/captionSegments";
import type { ApiLogEntry, DatasetAsset, DatasetEntry } from "../../lib/types";

interface DatasetEditorProps {
  projectId: string;
}

type BatchProgress = {
  /** 1-based position in batch (currently running) */
  current: number;
  total: number;
  currentName: string;
  relativePath: string;
};

const PREVIEW_DOCK_PX = 44;
const BATCH_FLYOUT_W = 300;
const API_LOG_DRAWER_W = 420;

function formatApiLogTime(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString(undefined, {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return fallback;
}

function isCaptionCancelledError(error: unknown): boolean {
  return /LLM caption cancelled/i.test(getErrorMessage(error, ""));
}

/** 1-based image indices, inclusive; clamped to [1, total]. Returns null if input cannot be interpreted. */
function parseBatchImageRange(raw: string, total: number): { start: number; end: number } | null {
  if (total <= 0) return null;
  const s = raw.trim();
  if (!s) return null;

  const full = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (full) {
    let a = parseInt(full[1], 10);
    let b = parseInt(full[2], 10);
    if (a > b) [a, b] = [b, a];
    const start = Math.max(1, Math.min(a, total));
    const end = Math.max(1, Math.min(b, total));
    return start <= end ? { start, end } : { start: end, end: start };
  }

  const startOpen = s.match(/^(\d+)\s*-\s*$/);
  if (startOpen) {
    const a = Math.max(1, Math.min(parseInt(startOpen[1], 10), total));
    return { start: a, end: total };
  }

  const endOpen = s.match(/^-\s*(\d+)$/);
  if (endOpen) {
    const b = Math.max(1, Math.min(parseInt(endOpen[1], 10), total));
    return { start: 1, end: b };
  }

  const single = s.match(/^(\d+)$/);
  if (single) {
    const i = Math.max(1, Math.min(parseInt(single[1], 10), total));
    return { start: i, end: i };
  }

  return null;
}

/** Returns new caption text, or null if file already has `tw` as the first tag. */
function buildCaptionWithTriggerAtFront(existingTrimmed: string, tw: string): string | null {
  if (!tw) return null;
  if (!existingTrimmed) {
    return tw;
  }
  const first = existingTrimmed.split(/[,，]/)[0]?.trim() ?? "";
  if (first === tw) {
    return null;
  }
  return `${tw}, ${existingTrimmed}`;
}

/**
 * Removes every comma/ideographic-comma–separated segment that exactly equals `tw` (after trim).
 * Returns null if the trigger does not appear as its own tag (file unchanged).
 */
function removeTriggerWordFromCaptionAllSegments(existingTrimmed: string, tw: string): string | null {
  if (!tw || !existingTrimmed) {
    return null;
  }
  const parts = existingTrimmed.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  const filtered = parts.filter((segment) => segment !== tw);
  if (filtered.length === parts.length) {
    return null;
  }
  return filtered.join(", ");
}

/** When true, dataset image hotkeys should not run (user is editing text or a text-like control). */
function isDatasetTypingTarget(target: EventTarget | null): boolean {
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

export default function DatasetEditor({ projectId }: DatasetEditorProps) {
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
  const [imageRange, setImageRange] = useState("");
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [triggerWord, setTriggerWord] = useState("");
  /** Optional text sent to the LLM with the image to reduce mis-tags. */
  const [llmUserHint, setLlmUserHint] = useState("");
  /** Avoid writing another project's form snapshot before hydrate completes (projectId switch). */
  const [persistReadyProjectId, setPersistReadyProjectId] = useState<string | null>(null);
  const captionRef = useRef(caption);
  captionRef.current = caption;

  const [translatedCaption, setTranslatedCaption] = useState("");
  /** 拖动选中连续标签分区后持久高亮（译文标签下标 + 字符区间）。 */
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
    const datasetEntries = await listDatasetEntries(projectId);
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
    setLlmUserHint(saved?.llmUserHint ?? "");
    setTriggerWord(saved?.triggerWord ?? "");
    setImageRange(saved?.imageRange ?? "");
    setTaggingMode(saved?.taggingMode === "range" ? "range" : "all");
    setPreviewDockOpen(Boolean(saved?.previewDockOpen));
    setPersistReadyProjectId(projectId);
  }, [projectId]);

  useEffect(() => {
    if (persistReadyProjectId !== projectId) return;
    saveDatasetEditorFormPersist(projectId, {
      llmUserHint,
      triggerWord,
      imageRange,
      taggingMode,
      previewDockOpen,
    });
  }, [
    persistReadyProjectId,
    projectId,
    llmUserHint,
    triggerWord,
    imageRange,
    taggingMode,
    previewDockOpen,
  ]);

  const imageEntries = useMemo(
    () => entries.filter((entry) => entry.kind === "image"),
    [entries],
  );

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

  useEffect(() => {
    if (imageEntries.length === 0) {
      assetRequestIdRef.current += 1;
      setSelectedImageIndex(-1);
      setAsset(null);
      setCaption("");
      return;
    }

    setSelectedImageIndex((currentIndex) => {
      if (currentIndex < 0) {
        return 0;
      }
      return Math.min(currentIndex, imageEntries.length - 1);
    });
  }, [imageEntries]);

  const currentImage = selectedImageIndex >= 0 ? imageEntries[selectedImageIndex] ?? null : null;

  useEffect(() => {
    setZhPartitionHighlight(null);
  }, [currentImage?.relativePath]);

  const batchRangeHighlight = useMemo(() => {
    if (!previewDockOpen || !batchFlyoutOpen || taggingMode !== "range") return null;
    return parseBatchImageRange(imageRange, imageEntries.length);
  }, [previewDockOpen, batchFlyoutOpen, taggingMode, imageRange, imageEntries.length]);

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
      const deletedIndex = imageEntries.findIndex((entry) => entry.relativePath === asset.relativePath);
      const nextEntries = await deleteDatasetImage(projectId, asset.relativePath);
      setEntries(nextEntries);
      const nextImageEntries = nextEntries.filter((entry) => entry.kind === "image");
      if (nextImageEntries.length === 0) {
        assetRequestIdRef.current += 1;
        setAsset(null);
        setSelectedImageIndex(-1);
        setCaption("");
        return;
      }

      setSelectedImageIndex(deletedIndex < 0 ? 0 : Math.min(deletedIndex, nextImageEntries.length - 1));
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, t("errors.deleteImage")));
    } finally {
      setBusy(null);
    }
  };

  const applyGeneratedCaption = async () => {
    if (!asset) return;
    setBusy("llm");
    setError(null);
    const hint = llmUserHint.trim();
    try {
      const nextCaption = await autoTagImage(
        projectId,
        asset.relativePath,
        hint.length > 0 ? hint : undefined,
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
    if (imageEntries.length === 0 || busy !== null) return;

    let targets: DatasetEntry[];
    if (taggingMode === "all") {
      targets = imageEntries;
    } else {
      const range = parseBatchImageRange(imageRange, imageEntries.length);
      if (!range) {
        setError(t("dataset.batchInvalidRange"));
        return;
      }
      targets = imageEntries.slice(range.start - 1, range.end);
    }

    if (targets.length === 0) {
      return;
    }

    setBusy("batch-llm");
    setError(null);
    setBatchProgress(null);

    let ok = 0;
    let fail = 0;
    let lastErr = "";
    let userCancelled = false;

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
          const hint = llmUserHint.trim();
          const nextCaption = await autoTagImage(
            projectId,
            entry.relativePath,
            hint.length > 0 ? hint : undefined,
          );
          await writeCaption(projectId, entry.relativePath, nextCaption);
          ok++;
          if (currentImage?.relativePath === entry.relativePath) {
            await loadAsset(entry.relativePath);
          }
        } catch (itemError) {
          if (isCaptionCancelledError(itemError)) {
            userCancelled = true;
            break;
          }
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
    currentImage?.relativePath,
    imageEntries,
    imageRange,
    loadAsset,
    projectId,
    taggingMode,
    t,
    llmUserHint,
  ]);

  const applyTriggerWordToAll = useCallback(async () => {
    const tw = triggerWord.trim();
    if (!tw) {
      setError(t("dataset.triggerWordEmpty"));
      return;
    }
    if (imageEntries.length === 0 || busy !== null) {
      return;
    }

    setBusy("trigger-all");
    setError(null);
    try {
      for (const entry of imageEntries) {
        const raw = await readCaption(projectId, entry.relativePath);
        const trimmed = raw.trim();
        const next = buildCaptionWithTriggerAtFront(trimmed, tw);
        if (next !== null) {
          await writeCaption(projectId, entry.relativePath, next);
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
  }, [busy, currentImage, imageEntries, loadAsset, projectId, t, triggerWord]);

  const removeTriggerWordFromAll = useCallback(async () => {
    const tw = triggerWord.trim();
    if (!tw) {
      setError(t("dataset.triggerWordEmpty"));
      return;
    }
    if (imageEntries.length === 0 || busy !== null) {
      return;
    }

    setBusy("trigger-remove");
    setError(null);
    try {
      for (const entry of imageEntries) {
        const raw = await readCaption(projectId, entry.relativePath);
        const trimmed = raw.trim();
        const next = removeTriggerWordFromCaptionAllSegments(trimmed, tw);
        if (next !== null) {
          await writeCaption(projectId, entry.relativePath, next);
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
  }, [busy, currentImage, imageEntries, loadAsset, projectId, t, triggerWord]);

  return (
    <div className="bento bento-detail view-dataset">
      <div className="card" style={{ gridColumn: "span 2", gridRow: "span 3", animationDelay: "0s" }}>
        <div className="card-header">
          <span className="card-title-icon">
            <FolderTree size={18} /> {t("dataset.fileSystem")}
          </span>
        </div>
        <div
          className="dataset-tree"
          style={{
            flex: 1,
            overflowY: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: "0.85rem",
            color: "var(--text-muted)",
            display: "flex",
            flexDirection: "column",
            gap: "0.45rem",
          }}
        >
          <div
            style={{
              color: "var(--accent-acid)",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <FolderOpen size={16} /> dataset/
          </div>
          {imageEntries.length === 0 ? (
            <div style={{ paddingLeft: "1.5rem" }}>{t("dataset.empty")}</div>
          ) : null}
          {imageEntries.map((entry, imageIndex) => {
            const oneBased = imageIndex + 1;
            const inBatchRange =
              batchRangeHighlight !== null &&
              oneBased >= batchRangeHighlight.start &&
              oneBased <= batchRangeHighlight.end;
            const isSelected = entry.relativePath === asset?.relativePath;
            const isBatchWorking =
              busy === "batch-llm" &&
              batchProgress !== null &&
              entry.relativePath === batchProgress.relativePath;
            return (
              <div
                key={entry.relativePath}
                onClick={() => {
                  void openImage(entry.relativePath);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  paddingLeft: `${1.25 + entry.depth * 1.2}rem`,
                  paddingRight: "0.35rem",
                  marginRight: "0.25rem",
                  borderRadius: "4px",
                  cursor: "pointer",
                  color: isSelected ? "var(--text-main)" : undefined,
                  backgroundColor: isBatchWorking
                    ? "color-mix(in srgb, var(--accent-orange) 22%, transparent)"
                    : inBatchRange
                      ? "color-mix(in srgb, var(--accent-acid) 20%, transparent)"
                      : undefined,
                  boxShadow: isBatchWorking
                    ? "inset 3px 0 0 var(--accent-orange)"
                    : inBatchRange
                      ? "inset 3px 0 0 var(--accent-acid)"
                      : undefined,
                }}
              >
                <Image size={14} />
                {entry.name}
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="card"
        style={{
          gridColumn: "span 6",
          gridRow: "span 3",
          animationDelay: "0.04s",
        }}
      >
        <div className="card-header">
          <span className="card-title-icon">
            <Eye size={18} /> {t("dataset.imagePreview")}
          </span>
          <span>
            {asset
              ? selectedImageIndex >= 0
                ? t("dataset.imageCounter", {
                    name: asset.name,
                    current: selectedImageIndex + 1,
                    total: imageEntries.length,
                  })
                : asset.name
              : t("dataset.imageCount", { count: imageEntries.length })}
          </span>
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "row",
            minWidth: 0,
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <FileAssetImage
              filePath={asset?.filePath}
              alt={asset?.name ?? t("dataset.datasetPreviewAlt")}
              fit="contain"
              placeholderIconSize={64}
              showOverlay
              style={{
                width: "100%",
                height: "100%",
                border: "1px solid var(--border-dim)",
              }}
            />

            {!previewDockOpen ? (
              <button
                type="button"
                className="btn"
                aria-label={t("dataset.previewDockOpen")}
                title={t("dataset.previewDockOpen")}
                style={{
                  position: "absolute",
                  right: 0,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: "22px",
                  minWidth: "22px",
                  padding: "0.55rem 0",
                  borderRadius: "6px 0 0 6px",
                  zIndex: 12,
                  borderRight: "none",
                  justifyContent: "center",
                  opacity: imageEntries.length === 0 ? 0.35 : 1,
                }}
                disabled={imageEntries.length === 0}
                onClick={() => {
                  setPreviewDockOpen(true);
                  setBatchFlyoutOpen(true);
                  setApiLogDrawerOpen(false);
                }}
              >
                <SidebarOpen size={16} aria-hidden />
              </button>
            ) : null}

            {previewDockOpen && batchFlyoutOpen ? (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  right: PREVIEW_DOCK_PX,
                  width: BATCH_FLYOUT_W,
                  maxWidth: `calc(100% - ${PREVIEW_DOCK_PX}px - 0.5rem)`,
                  backgroundColor: "var(--bg-card, #1e1e1e)",
                  borderLeft: "1px solid var(--border-dim)",
                  boxShadow: "-10px 0 28px rgba(0, 0, 0, 0.45)",
                  display: "flex",
                  flexDirection: "column",
                  zIndex: 15,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "0.85rem",
                    borderBottom: "1px solid var(--border-dim)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexShrink: 0,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 600 }}>
                    <Bot size={18} /> {t("dataset.batchTagging")}
                  </div>
                  <button
                    type="button"
                    className="btn"
                    style={{
                      padding: "0.25rem",
                      border: "none",
                      background: "transparent",
                    }}
                    aria-label={t("dataset.batchFlyoutClose")}
                    title={t("dataset.batchFlyoutClose")}
                    onClick={() => setBatchFlyoutOpen(false)}
                  >
                    <X size={16} />
                  </button>
                </div>

                <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "1.25rem", flex: 1, minHeight: 0, overflowY: "auto" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <label className="form-label">{t("dataset.taggingMode")}</label>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "0.5rem",
                      }}
                    >
                      <button
                        type="button"
                        className="btn"
                        aria-pressed={taggingMode === "all"}
                        disabled={busy !== null}
                        onClick={() => setTaggingMode("all")}
                        style={{
                          justifyContent: "center",
                          padding: "0.75rem",
                          borderColor:
                            taggingMode === "all" ? "var(--accent-acid)" : "var(--border-dim)",
                          background:
                            taggingMode === "all"
                              ? "color-mix(in srgb, var(--accent-acid) 14%, transparent)"
                              : "transparent",
                          color:
                            taggingMode === "all"
                              ? "var(--text-main)"
                              : "var(--text-muted)",
                        }}
                      >
                        {t("dataset.tagAll")}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        aria-pressed={taggingMode === "range"}
                        disabled={busy !== null}
                        onClick={() => setTaggingMode("range")}
                        style={{
                          justifyContent: "center",
                          padding: "0.75rem",
                          borderColor:
                            taggingMode === "range" ? "var(--accent-acid)" : "var(--border-dim)",
                          background:
                            taggingMode === "range"
                              ? "color-mix(in srgb, var(--accent-acid) 14%, transparent)"
                              : "transparent",
                          color:
                            taggingMode === "range"
                              ? "var(--text-main)"
                              : "var(--text-muted)",
                        }}
                      >
                        {t("dataset.tagRange")}
                      </button>
                    </div>
                  </div>

                  {taggingMode === "range" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      <label className="form-label">{t("dataset.imageRange")}</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="1-100"
                        value={imageRange}
                        disabled={busy !== null}
                        onChange={(e) => setImageRange(e.target.value)}
                      />
                    </div>
                  ) : null}

                  <div
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--text-muted)",
                      marginTop: taggingMode === "range" ? 0 : "-0.5rem",
                    }}
                  >
                    {t("dataset.totalImages", { total: imageEntries.length })}
                  </div>

                  {batchProgress ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      <div style={{ fontSize: "0.8rem", color: "var(--text-main)", fontWeight: 500 }}>
                        {t("dataset.batchTaggingProgress", {
                          current: batchProgress.current,
                          total: batchProgress.total,
                        })}
                      </div>
                      <div
                        style={{
                          height: "6px",
                          borderRadius: "3px",
                          backgroundColor: "color-mix(in srgb, var(--text-muted) 28%, transparent)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${
                              batchProgress.total > 0
                                ? (batchProgress.current / batchProgress.total) * 100
                                : 0
                            }%`,
                            backgroundColor: "var(--accent-acid)",
                            transition: "width 0.2s ease-out",
                          }}
                        />
                      </div>
                      <div
                        style={{
                          fontSize: "0.72rem",
                          color: "var(--text-muted)",
                          wordBreak: "break-all",
                          lineHeight: 1.35,
                        }}
                      >
                        {t("dataset.batchTaggingCurrent", { name: batchProgress.currentName })}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div style={{ padding: "1rem", borderTop: "1px solid var(--border-dim)", flexShrink: 0 }}>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ flex: 1, justifyContent: "center", padding: "0.75rem" }}
                      disabled={imageEntries.length === 0 || busy !== null}
                      onClick={() => void runBatchTagging()}
                    >
                      <Bot size={18} style={{ marginRight: "0.5rem" }} />{" "}
                      {busy === "batch-llm" ? t("dataset.batchTaggingRunning") : t("dataset.startBatchTagging")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      style={{
                        justifyContent: "center",
                        padding: "0 0.85rem",
                        flexShrink: 0,
                        minWidth: "3rem",
                      }}
                      title={t("dataset.stopLlmCaption")}
                      aria-label={t("dataset.stopLlmCaption")}
                      disabled={busy !== "batch-llm"}
                      onClick={() => {
                        void cancelLlmCaption();
                      }}
                    >
                      <StopCircle size={20} aria-hidden />
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {previewDockOpen && apiLogDrawerOpen ? (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  right: PREVIEW_DOCK_PX,
                  width: API_LOG_DRAWER_W,
                  maxWidth: `calc(100% - ${PREVIEW_DOCK_PX}px - 0.5rem)`,
                  backgroundColor: "var(--bg-card, #1e1e1e)",
                  borderLeft: "1px solid var(--border-dim)",
                  boxShadow: "-12px 0 32px rgba(0, 0, 0, 0.5)",
                  display: "flex",
                  flexDirection: "column",
                  zIndex: 16,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "0.65rem 0.75rem",
                    borderBottom: "1px solid var(--border-dim)",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.45rem",
                    flexShrink: 0,
                  }}
                >
                  <ScrollText size={17} aria-hidden />
                  <span style={{ flex: 1, fontWeight: 600, fontSize: "0.85rem" }}>
                    {t("dataset.apiLogTitle")}
                  </span>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "0.2rem 0.45rem", fontSize: "0.72rem" }}
                    onClick={() => void refreshApiLogs()}
                  >
                    {t("dataset.apiLogRefresh")}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "0.2rem 0.45rem", fontSize: "0.72rem" }}
                    onClick={() => void handleClearApiLogs()}
                  >
                    {t("dataset.apiLogClear")}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "0.2rem", border: "none", background: "transparent" }}
                    aria-label={t("dataset.apiLogClose")}
                    title={t("dataset.apiLogClose")}
                    onClick={() => setApiLogDrawerOpen(false)}
                  >
                    <X size={16} />
                  </button>
                </div>
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    padding: "0.5rem 0.65rem",
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.72rem",
                    lineHeight: 1.45,
                    color: "var(--text-muted)",
                  }}
                >
                  {apiLogLines.length === 0 ? (
                    <div>{t("dataset.apiLogEmpty")}</div>
                  ) : (
                    apiLogLines.map((line, idx) => (
                      <div
                        key={`${line.createdAt}-${idx}-${line.message.slice(0, 24)}`}
                        style={{ marginBottom: "0.35rem", wordBreak: "break-word" }}
                      >
                        <span style={{ color: "var(--accent-acid)", marginRight: "0.35rem" }}>
                          [{formatApiLogTime(line.createdAt)}]
                        </span>
                        <span style={{ marginRight: "0.35rem", opacity: 0.88 }}>{line.source}</span>
                        <span style={{ marginRight: "0.35rem", opacity: 0.72 }}>{line.level}</span>
                        <span style={{ whiteSpace: "pre-wrap" }}>{line.message}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {previewDockOpen ? (
            <div
              style={{
                width: PREVIEW_DOCK_PX,
                flexShrink: 0,
                borderLeft: "1px solid var(--border-dim)",
                backgroundColor: "color-mix(in srgb, var(--bg-card) 94%, transparent)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "0.45rem",
                padding: "0.45rem 0",
                zIndex: 18,
              }}
            >
              <button
                type="button"
                className={`btn ${batchFlyoutOpen ? "btn-primary" : ""}`}
                style={{
                  padding: "0.35rem",
                  width: "2.25rem",
                  justifyContent: "center",
                }}
                title={t("dataset.batchTagging")}
                aria-label={t("dataset.batchTagging")}
                aria-pressed={batchFlyoutOpen}
                onClick={() => {
                  setApiLogDrawerOpen(false);
                  setBatchFlyoutOpen((open) => !open);
                }}
              >
                <Bot size={18} aria-hidden />
              </button>
              <button
                type="button"
                className={`btn ${apiLogDrawerOpen ? "btn-primary" : ""}`}
                style={{
                  padding: "0.35rem",
                  width: "2.25rem",
                  justifyContent: "center",
                }}
                title={t("dataset.apiLogTitle")}
                aria-label={t("dataset.apiLogTitle")}
                aria-pressed={apiLogDrawerOpen}
                onClick={() => {
                  setBatchFlyoutOpen(false);
                  setApiLogDrawerOpen((open) => !open);
                }}
              >
                <ScrollText size={18} aria-hidden />
              </button>
              <div style={{ flex: 1, minHeight: "0.25rem" }} />
              <button
                type="button"
                className="btn"
                style={{
                  padding: "0.25rem",
                  width: "2rem",
                  justifyContent: "center",
                }}
                title={t("dataset.previewDockCollapse")}
                aria-label={t("dataset.previewDockCollapse")}
                onClick={() => {
                  setPreviewDockOpen(false);
                  setBatchFlyoutOpen(false);
                  setApiLogDrawerOpen(false);
                }}
              >
                <ChevronRight size={18} aria-hidden />
              </button>
            </div>
          ) : null}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "1rem",
            marginTop: "1rem",
          }}
        >
          <button
            type="button"
            className="btn"
            style={{ padding: "0.5rem 1rem" }}
            disabled={!previousImage}
            aria-label={t("dataset.prevImage")}
            title={t("dataset.prevImage")}
            onClick={() => {
              if (previousImage) {
                void openImage(previousImage.relativePath);
              }
            }}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="btn"
            style={{ padding: "0.5rem 1rem" }}
            disabled={!nextImage}
            aria-label={t("dataset.nextImage")}
            title={t("dataset.nextImage")}
            onClick={() => {
              if (nextImage) {
                void openImage(nextImage.relativePath);
              }
            }}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div
          style={{
            marginTop: "0.65rem",
            fontSize: "0.72rem",
            color: "var(--text-muted)",
            lineHeight: 1.4,
            textAlign: "center",
            maxWidth: "28rem",
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {t("dataset.imageKeyboardNavHint")}
        </div>
      </div>

      <div className="card" style={{ gridColumn: "span 4", gridRow: "span 3", animationDelay: "0.08s" }}>
        <div className="card-header">
          <span className="card-title-icon">
            <Tags size={18} /> {t("dataset.captionsAndTags")}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            flex: 1,
          }}
        >
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
            <button
              className="btn btn-primary"
              style={{ flex: 1, justifyContent: "center", padding: "0.75rem" }}
              disabled={!asset || (busy !== null && busy !== "llm")}
              onClick={() => void applyGeneratedCaption()}
            >
              <Bot size={18} /> {busy === "llm" ? t("dataset.running") : t("dataset.autoTag")}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              style={{ justifyContent: "center", padding: "0 0.85rem", flexShrink: 0, minWidth: "3rem" }}
              title={t("dataset.stopLlmCaption")}
              aria-label={t("dataset.stopLlmCaption")}
              disabled={busy !== "llm"}
              onClick={() => {
                void cancelLlmCaption();
              }}
            >
              <StopCircle size={20} aria-hidden />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label className="form-label">{t("dataset.llmUserHintLabel")}</label>
            <textarea
              className="form-input"
              style={{ minHeight: "4.5rem", resize: "vertical" }}
              placeholder={t("dataset.llmUserHintPlaceholder")}
              value={llmUserHint}
              disabled={busy !== null}
              onChange={(e) => setLlmUserHint(e.target.value)}
              spellCheck
            />
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: 1.35 }}>
              {t("dataset.llmUserHintDesc")}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label className="form-label">{t("dataset.triggerWord")}</label>
            <div style={{ display: "flex", alignItems: "stretch", gap: "0.5rem" }}>
              <input
                type="text"
                className="form-input"
                style={{ flex: 1, minWidth: 0 }}
                placeholder={t("dataset.triggerWordPlaceholder")}
                value={triggerWord}
                disabled={busy !== null}
                onChange={(e) => setTriggerWord(e.target.value)}
                autoComplete="off"
              />
              <button
                type="button"
                className="btn btn-primary"
                style={{
                  justifyContent: "center",
                  padding: "0 0.65rem",
                  flexShrink: 0,
                  alignSelf: "stretch",
                  minWidth: "2.75rem",
                }}
                aria-label={t("dataset.applyTriggerWordAll")}
                title={t("dataset.applyTriggerWordAll")}
                disabled={imageEntries.length === 0 || busy !== null || !triggerWord.trim()}
                onClick={() => void applyTriggerWordToAll()}
              >
                {busy === "trigger-all" ? (
                  <Loader2 size={18} className="lf-icon-spin" aria-hidden />
                ) : (
                  <PlusCircle size={18} aria-hidden />
                )}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                style={{
                  justifyContent: "center",
                  padding: "0 0.65rem",
                  flexShrink: 0,
                  alignSelf: "stretch",
                  minWidth: "2.75rem",
                }}
                aria-label={t("dataset.removeTriggerWordAll")}
                title={t("dataset.removeTriggerWordAll")}
                disabled={imageEntries.length === 0 || busy !== null || !triggerWord.trim()}
                onClick={() => void removeTriggerWordFromAll()}
              >
                {busy === "trigger-remove" ? (
                  <Loader2 size={18} className="lf-icon-spin" aria-hidden />
                ) : (
                  <MinusCircle size={18} aria-hidden />
                )}
              </button>
            </div>
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: "0.65rem",
              minHeight: 0,
              marginTop: "0.5rem",
            }}
          >
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "row",
                gap: "0.75rem",
                minHeight: 0,
                alignItems: "stretch",
              }}
            >
              <div
                className="lf-dataset-caption-zone"
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 0,
                }}
              >
                <div
                  style={{
                    minHeight: "2.35rem",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: "0.2rem",
                  }}
                >
                  <label className="form-label" style={{ margin: 0 }}>
                    {t("dataset.rawTagText")}
                  </label>
                  <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", lineHeight: 1.3 }}>
                    {t("dataset.captionZoneOriginal")}
                  </span>
                </div>
                <textarea
                  className="form-input"
                  style={{
                    flex: 1,
                    minHeight: "12rem",
                    resize: "none",
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.85rem",
                    lineHeight: 1.5,
                    padding: "1rem",
                  }}
                  placeholder={t("dataset.rawTagPlaceholder")}
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                />
              </div>
              <div className="lf-dataset-caption-divider" aria-hidden />
              <div
                className="lf-dataset-caption-zone lf-dataset-caption-zone--translated"
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 0,
                }}
              >
                <div
                  style={{
                    minHeight: "2.35rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.35rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "0.5rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      className="form-label"
                      style={{ margin: 0, display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}
                    >
                      <Languages size={16} aria-hidden />
                      {t("dataset.translatedCaption")}
                      {translateBusy ? (
                        <Loader2 size={16} className="lf-icon-spin" aria-hidden />
                      ) : null}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem", flexShrink: 0 }}
                        disabled={!caption.trim() || translateBusy || busy !== null}
                        onClick={() => runBaiduCaptionTranslate()}
                      >
                        {t("dataset.translateNow")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem", flexShrink: 0 }}
                        title={
                          captionTagCountAligned
                            ? t("dataset.overwriteSelectionToCaptionTitle")
                            : t("dataset.overwriteSelectionNeedAlignedTags")
                        }
                        disabled={
                          !asset ||
                          !captionTagCountAligned ||
                          !translatedCaption.trim() ||
                          translateBusy ||
                          busy !== null
                        }
                        onMouseDown={(e) => {
                          e.preventDefault();
                        }}
                        onClick={() => void applyZhSelectionToCaption()}
                      >
                        {busy === "caption-merge" ? (
                          <Loader2 size={16} className="lf-icon-spin" aria-hidden style={{ marginRight: "0.35rem" }} />
                        ) : (
                          <MousePointer2 size={16} aria-hidden style={{ marginRight: "0.35rem" }} />
                        )}
                        {t("dataset.overwriteSelectionToCaption")}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem", flexShrink: 0 }}
                        title={t("dataset.overwriteTagsFromZhTitle")}
                        disabled={
                          !asset ||
                          !translatedCaption.trim() ||
                          translateBusy ||
                          busy !== null
                        }
                        onClick={() => void applyZhOverwriteToCaption()}
                      >
                        {busy === "caption-merge" ? (
                          <Loader2 size={16} className="lf-icon-spin" aria-hidden style={{ marginRight: "0.35rem" }} />
                        ) : (
                          <ArrowRightLeft size={16} aria-hidden style={{ marginRight: "0.35rem" }} />
                        )}
                        {t("dataset.overwriteTagsFromZh")}
                      </button>
                    </div>
                  </div>
                  <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", lineHeight: 1.3 }}>
                    {t("dataset.captionZoneTranslated")}
                  </span>
                </div>
                <TranslatedCaptionEditor
                  ref={translatedCaptionEditorRef}
                  value={translatedCaption}
                  highlight={zhHlSafe}
                  disabled={busy !== null || translateBusy}
                  placeholder={translateBusy ? t("dataset.translateRefreshing") : ""}
                  onChange={(next) => {
                    setZhPartitionHighlight(null);
                    setTranslatedCaption(next);
                  }}
                  onPlainSelectionGesture={syncZhPartitionHighlightFromSelection}
                />
              </div>
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: 1.35 }}>
              {t("dataset.translateCaptionHint")}
            </div>
            {translateNotice ? (
              <div style={{ fontSize: "0.72rem", color: "var(--accent-orange)", lineHeight: 1.35 }}>
                {translateNotice}
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              className="btn btn-primary"
              style={{ flex: 1, justifyContent: "center", padding: "0.5rem" }}
              disabled={!asset || busy !== null}
              onClick={() => void handleSave()}
            >
              <Save size={16} /> {busy === "save" ? t("dataset.saving") : t("dataset.save")}
            </button>
            <button
              className="btn btn-danger"
              style={{ justifyContent: "center", padding: "0.5rem", marginLeft: 0 }}
              disabled={!asset || busy !== null}
              aria-label={t("dataset.delete")}
              title={t("dataset.delete")}
              onClick={() => void handleDelete()}
            >
              <Trash size={16} />
            </button>
          </div>
          {error ? (
            <div style={{ color: "var(--accent-orange)", fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
