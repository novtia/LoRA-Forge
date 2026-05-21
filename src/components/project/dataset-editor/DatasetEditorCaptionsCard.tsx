import type { RefObject } from "react";
import { useMemo } from "react";
import {
  ArrowRightLeft,
  Bot,
  Languages,
  Loader2,
  MinusCircle,
  MousePointer2,
  PlusCircle,
  Save,
  StopCircle,
  Tags,
  Trash,
} from "lucide-react";
import { cancelLlmCaption } from "../../../lib/desktopApi";
import type { DatasetEditorTriggerScope } from "../../../lib/datasetEditorPersistence";
import { useI18n } from "../../../lib/i18n";
import type { DatasetAsset } from "../../../lib/types";
import TranslatedCaptionEditor, {
  type TranslatedCaptionEditorHandle,
  type TranslatedCaptionEditorHighlight,
} from "../TranslatedCaptionEditor";
import { TriggerPositionPicker } from "./TriggerPositionPicker";

type Props = {
  asset: DatasetAsset | null;
  busy: string | null;
  imageEntriesLength: number;
  onAutoTag: () => Promise<void>;
  llmUserHint: string;
  setLlmUserHint: (v: string) => void;
  triggerWord: string;
  setTriggerWord: (v: string) => void;
  triggerWordScope: DatasetEditorTriggerScope;
  setTriggerWordScope: (v: DatasetEditorTriggerScope) => void;
  triggerWordGroupPath: string;
  setTriggerWordGroupPath: (v: string) => void;
  triggerGroupFolderOptions: { value: string; depth: number; label: string }[];
  triggerTargetCount: number;
  triggerWordPosition: string;
  setTriggerWordPosition: (v: string) => void;
  caption: string;
  setCaption: (v: string) => void;
  translatedCaption: string;
  translateBusy: boolean;
  translateNotice: string | null;
  captionTagCountAligned: boolean;
  zhHlSafe: TranslatedCaptionEditorHighlight;
  translatedCaptionEditorRef: RefObject<TranslatedCaptionEditorHandle | null>;
  onTranslatedCaptionChange: (next: string) => void;
  onPlainSelectionGesture: () => void;
  onTranslateNow: () => void;
  onApplyZhSelectionToCaption: () => Promise<void>;
  onApplyZhOverwriteToCaption: () => Promise<void>;
  onSave: () => Promise<void>;
  onDelete: () => Promise<void>;
  onApplyTriggerWordToAll: () => Promise<void>;
  onRemoveTriggerWordFromAll: () => Promise<void>;
  showStyleCaptionHint: boolean;
  error: string | null;
};

export function DatasetEditorCaptionsCard({
  asset,
  busy,
  imageEntriesLength,
  onAutoTag,
  llmUserHint,
  setLlmUserHint,
  triggerWord,
  setTriggerWord,
  triggerWordScope,
  setTriggerWordScope,
  triggerWordGroupPath,
  setTriggerWordGroupPath,
  triggerGroupFolderOptions,
  triggerTargetCount,
  triggerWordPosition,
  setTriggerWordPosition,
  caption,
  setCaption,
  translatedCaption,
  translateBusy,
  translateNotice,
  captionTagCountAligned,
  zhHlSafe,
  translatedCaptionEditorRef,
  onTranslatedCaptionChange,
  onPlainSelectionGesture,
  onTranslateNow,
  onApplyZhSelectionToCaption,
  onApplyZhOverwriteToCaption,
  onSave,
  onDelete,
  onApplyTriggerWordToAll,
  onRemoveTriggerWordFromAll,
  showStyleCaptionHint,
  error,
}: Props) {
  const { t } = useI18n();

  const applyTriggerTitle = useMemo(() => {
    const n = triggerTargetCount;
    if (triggerWordScope === "group") {
      return t("dataset.triggerScope.applyTitleGroup", { count: n });
    }
    if (triggerWordScope === "selection") {
      return t("dataset.triggerScope.applyTitleSelection", { count: n });
    }
    return t("dataset.triggerScope.applyTitleAll", { count: n });
  }, [t, triggerTargetCount, triggerWordScope]);

  const removeTriggerTitle = useMemo(() => {
    const n = triggerTargetCount;
    if (triggerWordScope === "group") {
      return t("dataset.triggerScope.removeTitleGroup", { count: n });
    }
    if (triggerWordScope === "selection") {
      return t("dataset.triggerScope.removeTitleSelection", { count: n });
    }
    return t("dataset.triggerScope.removeTitleAll", { count: n });
  }, [t, triggerTargetCount, triggerWordScope]);

  return (
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
            onClick={() => void onAutoTag()}
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
          {showStyleCaptionHint ? (
            <div style={{ fontSize: "0.72rem", color: "var(--accent-orange)", lineHeight: 1.35 }}>
              {t("dataset.styleCaptionHint")}
            </div>
          ) : null}
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
              aria-label={applyTriggerTitle}
              title={applyTriggerTitle}
              disabled={triggerTargetCount === 0 || busy !== null || !triggerWord.trim()}
              onClick={() => void onApplyTriggerWordToAll()}
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
              aria-label={removeTriggerTitle}
              title={removeTriggerTitle}
              disabled={triggerTargetCount === 0 || busy !== null || !triggerWord.trim()}
              onClick={() => void onRemoveTriggerWordFromAll()}
            >
              {busy === "trigger-remove" ? (
                <Loader2 size={18} className="lf-icon-spin" aria-hidden />
              ) : (
                <MinusCircle size={18} aria-hidden />
              )}
            </button>
          </div>
          <TriggerPositionPicker
            caption={caption}
            triggerWord={triggerWord}
            rawPosition={triggerWordPosition}
            onChangeRaw={setTriggerWordPosition}
            disabled={busy !== null}
            t={t}
            scope={{
              mode: triggerWordScope,
              onChangeMode: setTriggerWordScope,
              groupPath: triggerWordGroupPath,
              onChangeGroupPath: setTriggerWordGroupPath,
              folderOptions: triggerGroupFolderOptions,
              targetCount: triggerTargetCount,
              imageEntriesLength: imageEntriesLength,
            }}
          />
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
                      onClick={onTranslateNow}
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
                      onClick={() => void onApplyZhSelectionToCaption()}
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
                        !asset || !translatedCaption.trim() || translateBusy || busy !== null
                      }
                      onClick={() => void onApplyZhOverwriteToCaption()}
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
                onChange={onTranslatedCaptionChange}
                onPlainSelectionGesture={onPlainSelectionGesture}
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
            onClick={() => void onSave()}
          >
            <Save size={16} /> {busy === "save" ? t("dataset.saving") : t("dataset.save")}
          </button>
          <button
            className="btn btn-danger"
            style={{ justifyContent: "center", padding: "0.5rem", marginLeft: 0 }}
            disabled={!asset || busy !== null}
            aria-label={t("dataset.delete")}
            title={t("dataset.delete")}
            onClick={() => void onDelete()}
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
  );
}
