import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import {
  CheckCircle2,
  ImagePlus,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import {
  autoTagImage,
  importEditPair,
  loadDiffusionPipeConfig,
  saveDiffusionPipeConfig,
  setDatasetControlDir,
  writeCaption,
} from "../../../lib/desktopApi";
import { setPreferredTrainingMode } from "../../../lib/trainingModePreference";
import type { DatasetEditorMode } from "../../../lib/datasetEditorPersistence";
import { useI18n } from "../../../lib/i18n";
import type { DatasetEntry } from "../../../lib/types";
import { DatasetModeToggle } from "./DatasetModeToggle";
import { fileToImportPayload } from "./fileUpload";
import { getErrorMessage } from "./datasetEditorHelpers";

type SlotImage = { file: File; url: string };

type PairDraft = {
  control: SlotImage | null;
  target: SlotImage | null;
  caption: string;
  uploaded: boolean;
  targetRel: string | null;
  controlRel: string | null;
  tagging: boolean;
};

type SavedPair = PairDraft & { id: string };

type Props = {
  projectId: string;
  entries: DatasetEntry[];
  busy: string | null;
  setBusy: (busy: string | null) => void;
  onError: (message: string | null) => void;
  onEntriesRefreshed: (entries: DatasetEntry[]) => void;
  llmDirectTagHint: string;
  datasetMode: DatasetEditorMode;
  setDatasetMode: (mode: DatasetEditorMode) => void;
};

const DEFAULT_TARGET_FOLDER = "edit_target";
const DEFAULT_CONTROL_FOLDER = "edit_control";

function emptyDraft(): PairDraft {
  return {
    control: null,
    target: null,
    caption: "",
    uploaded: false,
    targetRel: null,
    controlRel: null,
    tagging: false,
  };
}

function newSavedId(): string {
  return `pair_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function imageFileFromInput(files: FileList | null): File | null {
  const file = files?.[0];
  if (!file) return null;
  if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp)$/i.test(file.name)) return file;
  return null;
}

function revokeSlot(slot: SlotImage | null) {
  if (slot) URL.revokeObjectURL(slot.url);
}

export function EditPairManagerPanel({
  projectId,
  entries,
  busy,
  setBusy,
  onError,
  onEntriesRefreshed,
  llmDirectTagHint,
  datasetMode,
  setDatasetMode,
}: Props) {
  const { t } = useI18n();
  const [targetFolder, setTargetFolder] = useState(DEFAULT_TARGET_FOLDER);
  const [controlFolder, setControlFolder] = useState(DEFAULT_CONTROL_FOLDER);
  const [draft, setDraft] = useState<PairDraft>(() => emptyDraft());
  const [savedPairs, setSavedPairs] = useState<SavedPair[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const savedRef = useRef(savedPairs);
  savedRef.current = savedPairs;

  const controlInputRef = useRef<HTMLInputElement | null>(null);
  const targetInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      revokeSlot(draftRef.current.control);
      revokeSlot(draftRef.current.target);
      for (const row of savedRef.current) {
        revokeSlot(row.control);
        revokeSlot(row.target);
      }
    };
  }, []);

  const setDraftSlot = useCallback((slot: "target" | "control", file: File | null) => {
    if (!file) return;
    setDraft((prev) => {
      revokeSlot(prev[slot]);
      return {
        ...prev,
        [slot]: { file, url: URL.createObjectURL(file) },
        uploaded: false,
        targetRel: null,
        controlRel: null,
      };
    });
  }, []);

  const clearDraft = useCallback(() => {
    setDraft((prev) => {
      revokeSlot(prev.control);
      revokeSlot(prev.target);
      return emptyDraft();
    });
  }, []);

  const saveDraftToDisk = useCallback(
    async (pair: PairDraft): Promise<PairDraft> => {
      if (!pair.target || !pair.control) return pair;
      if (pair.uploaded && pair.targetRel && pair.controlRel) return pair;
      const [targetPayload, controlPayload] = await Promise.all([
        fileToImportPayload(pair.target.file),
        fileToImportPayload(pair.control.file),
      ]);
      const result = await importEditPair(
        projectId,
        targetFolder.trim() || DEFAULT_TARGET_FOLDER,
        controlFolder.trim() || DEFAULT_CONTROL_FOLDER,
        targetPayload,
        controlPayload,
        pair.caption,
      );
      onEntriesRefreshed(result.entries);
      return {
        ...pair,
        uploaded: true,
        targetRel: result.targetRelativePath,
        controlRel: result.controlRelativePath,
      };
    },
    [controlFolder, onEntriesRefreshed, projectId, targetFolder],
  );

  const draftComplete = Boolean(draft.target && draft.control);
  const savedCompleteCount = savedPairs.filter((p) => p.target && p.control).length;
  const totalPairCount = savedCompleteCount + (draftComplete ? 1 : 0);
  const pendingSavedCount = savedPairs.filter((p) => p.target && p.control && !p.uploaded).length;
  const pendingDraft = draftComplete && !draft.uploaded;

  const handleSaveDraft = useCallback(async () => {
    if (busy !== null || !draftRef.current.target || !draftRef.current.control) return;
    setBusy("edit-save");
    onError(null);
    setNotice(null);
    try {
      const saved = await saveDraftToDisk(draftRef.current);
      setDraft(saved);
      setNotice(t("dataset.editSavedNotice", { count: 1 }));
    } catch (e) {
      onError(getErrorMessage(e, t("dataset.editSaveFailed")));
    } finally {
      setBusy(null);
    }
  }, [busy, onError, saveDraftToDisk, setBusy, t]);

  const handleSaveAll = useCallback(async () => {
    if (busy !== null) return;
    const toSave = [
      ...(pendingDraft ? [draftRef.current] : []),
      ...savedRef.current.filter((p) => p.target && p.control && !p.uploaded),
    ];
    if (toSave.length === 0) return;
    setBusy("edit-save");
    onError(null);
    setNotice(null);
    try {
      let count = 0;
      if (pendingDraft) {
        const saved = await saveDraftToDisk(draftRef.current);
        setDraft(saved);
        count += 1;
      }
      const nextSaved: SavedPair[] = [];
      for (const row of savedRef.current) {
        if (row.target && row.control && !row.uploaded) {
          const saved = await saveDraftToDisk(row);
          nextSaved.push({ ...saved, id: row.id });
          count += 1;
        } else {
          nextSaved.push(row);
        }
      }
      setSavedPairs(nextSaved);
      setNotice(t("dataset.editSavedNotice", { count }));
    } catch (e) {
      onError(getErrorMessage(e, t("dataset.editSaveFailed")));
    } finally {
      setBusy(null);
    }
  }, [busy, onError, pendingDraft, saveDraftToDisk, setBusy, t]);

  const tagPair = useCallback(
    async (pair: PairDraft, onUpdate: (next: PairDraft) => void) => {
      if (!pair.target || !pair.control) return;
      onUpdate({ ...pair, tagging: true });
      try {
        const saved = await saveDraftToDisk(pair);
        if (!saved.targetRel || !saved.controlRel) return;
        const caption = await autoTagImage(
          projectId,
          saved.targetRel,
          llmDirectTagHint,
          null,
          null,
          "direct",
          saved.caption,
          saved.controlRel,
        );
        await writeCaption(projectId, saved.targetRel, caption);
        onUpdate({ ...saved, caption, tagging: false });
      } catch (e) {
        onUpdate({ ...pair, tagging: false });
        throw e;
      }
    },
    [llmDirectTagHint, projectId, saveDraftToDisk],
  );

  const handleTagDraft = useCallback(async () => {
    if (busy !== null) return;
    setBusy("edit-tag");
    onError(null);
    setNotice(null);
    try {
      await tagPair(draftRef.current, setDraft);
    } catch (e) {
      onError(getErrorMessage(e, t("dataset.editTagFailed")));
    } finally {
      setBusy(null);
    }
  }, [busy, onError, setBusy, t, tagPair]);

  const handleTagAll = useCallback(async () => {
    if (busy !== null) return;
    setBusy("edit-tag");
    onError(null);
    setNotice(null);
    try {
      if (draftRef.current.target && draftRef.current.control) {
        await tagPair(draftRef.current, setDraft);
      }
      const nextSaved = [...savedRef.current];
      for (let i = 0; i < nextSaved.length; i += 1) {
        const row = nextSaved[i]!;
        if (row.target && row.control) {
          await tagPair(row, (next) => {
            nextSaved[i] = { ...next, id: row.id };
            setSavedPairs([...nextSaved]);
          });
        }
      }
      setNotice(t("dataset.editTagAllDone"));
    } catch (e) {
      onError(getErrorMessage(e, t("dataset.editTagFailed")));
    } finally {
      setBusy(null);
    }
  }, [busy, onError, setBusy, t, tagPair]);

  const handleAddPair = useCallback(async () => {
    if (busy !== null) return;
    onError(null);
    setNotice(null);
    try {
      let current = draftRef.current;
      if (current.target && current.control) {
        setBusy("edit-save");
        current = await saveDraftToDisk(current);
        setSavedPairs((prev) => [...prev, { ...current, id: newSavedId() }]);
        clearDraft();
        setNotice(t("dataset.editPairQueued"));
      }
    } catch (e) {
      onError(getErrorMessage(e, t("dataset.editSaveFailed")));
    } finally {
      setBusy(null);
    }
  }, [busy, clearDraft, onError, saveDraftToDisk, setBusy, t]);

  const handleApplyConfig = useCallback(async () => {
    if (busy !== null) return;
    setBusy("edit-apply");
    onError(null);
    setNotice(null);
    try {
      const target = targetFolder.trim() || DEFAULT_TARGET_FOLDER;
      const control = controlFolder.trim() || DEFAULT_CONTROL_FOLDER;
      const cfg = await loadDiffusionPipeConfig(projectId);
      await saveDiffusionPipeConfig(projectId, { ...cfg, modelType: "flux2" });
      await setDatasetControlDir(projectId, target, control);
      setPreferredTrainingMode(projectId, "diffusion-pipe");
      setNotice(t("dataset.editApplyDone"));
    } catch (e) {
      onError(getErrorMessage(e, t("dataset.editApplyFailed")));
    } finally {
      setBusy(null);
    }
  }, [busy, controlFolder, onError, projectId, setBusy, t, targetFolder]);

  const handleDrop =
    (pick: (file: File | null) => void) =>
    (ev: ReactDragEvent): void => {
      ev.preventDefault();
      ev.stopPropagation();
      const file = imageFileFromInput(ev.dataTransfer.files);
      if (file) pick(file);
    };

  const disabled = busy !== null;
  const folderCount = entries.filter((e) => e.kind === "directory").length;

  return (
    <div
      className="card"
      style={{
        gridColumn: "span 6",
        gridRow: "span 3",
        animationDelay: "0.08s",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div className="card-header" style={{ flexWrap: "wrap", gap: "0.4rem" }}>
        <span className="card-title-icon">
          <Wand2 size={18} /> {t("dataset.editPanelTitle")}
        </span>
        <DatasetModeToggle mode={datasetMode} onChange={setDatasetMode} disabled={disabled} />
        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {t("dataset.editPairCount", { count: totalPairCount })}
        </span>
      </div>

      {/* Main editor: always visible — reference | target on top, caption below */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: "0.55rem",
          padding: "0 0.35rem",
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: "180px",
            display: "flex",
            gap: "0.55rem",
            alignItems: "stretch",
          }}
        >
          <ImageSlot
            label={t("dataset.editReferenceLabel")}
            image={draft.control}
            disabled={disabled}
            inputRef={controlInputRef}
            onPick={(file) => setDraftSlot("control", file)}
            onDrop={handleDrop((file) => setDraftSlot("control", file))}
            large
          />
          <ImageSlot
            label={t("dataset.editTargetLabel")}
            image={draft.target}
            disabled={disabled}
            inputRef={targetInputRef}
            onPick={(file) => setDraftSlot("target", file)}
            onDrop={handleDrop((file) => setDraftSlot("target", file))}
            large
          />
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", flexShrink: 0 }}>
          <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
            {t("dataset.editCaptionLabel")}
          </span>
          <textarea
            value={draft.caption}
            disabled={disabled}
            placeholder={t("dataset.editCaptionPlaceholder")}
            onChange={(e) => setDraft((prev) => ({ ...prev, caption: e.target.value }))}
            style={{
              width: "100%",
              minHeight: "72px",
              resize: "vertical",
              fontFamily: "var(--font-mono)",
              fontSize: "0.78rem",
              padding: "0.4rem 0.5rem",
            }}
          />
        </label>

        <div style={{ display: "flex", gap: "0.35rem", alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
          <button
            type="button"
            className="btn"
            style={{ padding: "0.25rem 0.55rem", fontSize: "0.72rem" }}
            disabled={disabled || !draftComplete}
            onClick={() => void handleTagDraft()}
          >
            {draft.tagging || busy === "edit-tag" ? (
              <Loader2 size={13} className="spin" aria-hidden style={{ marginRight: "0.3rem" }} />
            ) : (
              <Sparkles size={13} aria-hidden style={{ marginRight: "0.3rem" }} />
            )}
            {t("dataset.editTagPair")}
          </button>
          <button
            type="button"
            className="btn"
            style={{ padding: "0.25rem 0.55rem", fontSize: "0.72rem" }}
            disabled={disabled || !draftComplete}
            onClick={() => void handleSaveDraft()}
          >
            {busy === "edit-save" ? (
              <Loader2 size={13} className="spin" aria-hidden style={{ marginRight: "0.3rem" }} />
            ) : (
              <ImagePlus size={13} aria-hidden style={{ marginRight: "0.3rem" }} />
            )}
            {t("dataset.editSaveCurrent")}
          </button>
          {draft.uploaded ? (
            <span style={{ fontSize: "0.65rem", color: "var(--accent-acid)", fontFamily: "var(--font-mono)" }}>
              <CheckCircle2 size={12} aria-hidden style={{ verticalAlign: "-2px", marginRight: "0.2rem" }} />
              {t("dataset.editSavedBadge")}
            </span>
          ) : null}
          <button
            type="button"
            className="btn"
            style={{ padding: "0.25rem 0.55rem", fontSize: "0.72rem", marginLeft: "auto" }}
            disabled={disabled || (!draft.control && !draft.target && !draft.caption)}
            onClick={clearDraft}
          >
            <Trash2 size={13} aria-hidden style={{ marginRight: "0.25rem" }} />
            {t("dataset.editClearDraft")}
          </button>
        </div>

        {savedPairs.length > 0 ? (
          <div
            style={{
              flexShrink: 0,
              maxHeight: "120px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "0.3rem",
              borderTop: "1px solid var(--border-dim)",
              paddingTop: "0.45rem",
            }}
          >
            <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
              {t("dataset.editSavedPairsTitle", { count: savedPairs.length })}
            </span>
            {savedPairs.map((row) => (
              <div
                key={row.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  fontSize: "0.68rem",
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-muted)",
                }}
              >
                {row.control ? (
                  <img src={row.control.url} alt="" style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 3 }} />
                ) : null}
                {row.target ? (
                  <img src={row.target.url} alt="" style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 3 }} />
                ) : null}
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.caption || t("dataset.editNoCaption")}
                </span>
                {row.uploaded ? (
                  <CheckCircle2 size={12} style={{ color: "var(--accent-acid)", flexShrink: 0 }} />
                ) : null}
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "0.15rem 0.35rem" }}
                  disabled={disabled}
                  onClick={() => {
                    setSavedPairs((prev) => {
                      const removed = prev.find((p) => p.id === row.id);
                      revokeSlot(removed?.control ?? null);
                      revokeSlot(removed?.target ?? null);
                      return prev.filter((p) => p.id !== row.id);
                    });
                  }}
                  aria-label={t("dataset.editRemovePair")}
                >
                  <Trash2 size={12} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.4rem",
          padding: "0.55rem 0.35rem 0.25rem",
          borderTop: "1px solid var(--border-dim)",
          marginTop: "0.25rem",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem", fontSize: "0.65rem", color: "var(--text-muted)" }}>
          {t("dataset.editTargetFolder")}
          <input
            type="text"
            value={targetFolder}
            disabled={disabled}
            onChange={(e) => setTargetFolder(e.target.value)}
            style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", padding: "0.2rem 0.35rem", width: "7rem" }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem", fontSize: "0.65rem", color: "var(--text-muted)" }}>
          {t("dataset.editControlFolder")}
          <input
            type="text"
            value={controlFolder}
            disabled={disabled}
            onChange={(e) => setControlFolder(e.target.value)}
            style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", padding: "0.2rem 0.35rem", width: "7rem" }}
          />
        </label>
        <button type="button" className="btn" disabled={disabled} onClick={() => void handleAddPair()}>
          <Plus size={14} aria-hidden style={{ marginRight: "0.3rem" }} />
          {t("dataset.editAddPair")}
        </button>
        <button
          type="button"
          className="btn"
          disabled={disabled || (pendingSavedCount === 0 && !pendingDraft)}
          onClick={() => void handleSaveAll()}
        >
          {t("dataset.editSaveAll")}
        </button>
        <button
          type="button"
          className="btn"
          disabled={disabled || totalPairCount === 0}
          onClick={() => void handleTagAll()}
        >
          {t("dataset.editTagAll")}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          style={{ marginLeft: "auto" }}
          disabled={disabled}
          onClick={() => void handleApplyConfig()}
        >
          {busy === "edit-apply" ? (
            <Loader2 size={14} className="spin" aria-hidden style={{ marginRight: "0.3rem" }} />
          ) : (
            <CheckCircle2 size={14} aria-hidden style={{ marginRight: "0.3rem" }} />
          )}
          {t("dataset.editApplyConfig")}
        </button>
      </div>

      {notice ? (
        <div style={{ padding: "0.35rem 0.35rem 0", fontSize: "0.72rem", color: "var(--accent-acid)" }}>
          {notice}
        </div>
      ) : null}
      <div style={{ padding: "0.25rem 0.35rem 0", fontSize: "0.62rem", color: "var(--text-muted)" }}>
        {t("dataset.editFolderSummary", { folders: folderCount })}
      </div>
    </div>
  );
}

type SlotProps = {
  label: string;
  image: SlotImage | null;
  disabled: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (file: File | null) => void;
  onDrop: (ev: ReactDragEvent) => void;
  large?: boolean;
};

function ImageSlot({ label, image, disabled, inputRef, onPick, onDrop, large }: SlotProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
        flex: 1,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <span
        style={{
          fontSize: large ? "0.72rem" : "0.62rem",
          color: "var(--text-muted)",
          textAlign: "center",
          fontFamily: "var(--font-mono)",
        }}
      >
        {label}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          ev.dataTransfer.dropEffect = disabled ? "none" : "copy";
        }}
        onDrop={onDrop}
        style={{
          flex: 1,
          width: "100%",
          minHeight: large ? "140px" : "72px",
          border: "1px dashed var(--border-dim)",
          borderRadius: "6px",
          background: "var(--bg-deep, #0b0b0b)",
          cursor: disabled ? "not-allowed" : "pointer",
          padding: 0,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {image ? (
          <img
            src={image.url}
            alt={label}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.35rem", color: "var(--text-muted)" }}>
            <ImagePlus size={large ? 28 : 20} aria-hidden />
            <span style={{ fontSize: "0.65rem" }}>{label}</span>
          </div>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = imageFileFromInput(e.target.files);
          e.target.value = "";
          onPick(file);
        }}
      />
    </div>
  );
}
