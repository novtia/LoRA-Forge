import { FileImage } from "lucide-react";
import type { DatasetEditorTriggerScope } from "../../../lib/datasetEditorPersistence";
import { useI18n } from "../../../lib/i18n";
import { ImageScopePicker } from "./ImageScopePicker";
import type { TriggerScopeFolderOption } from "./TriggerPositionPicker";

export type DatasetTargetExtension = "png" | "jpg" | "webp";

type Props = {
  disabled: boolean;
  imageEntriesLength: number;
  scope: DatasetEditorTriggerScope;
  onChangeScope: (next: DatasetEditorTriggerScope) => void;
  groupPath: string;
  onChangeGroupPath: (next: string) => void;
  folderOptions: TriggerScopeFolderOption[];
  targetCount: number;
  renameBaseName: string;
  onChangeRenameBaseName: (next: string) => void;
  renameStartIndex: string;
  onChangeRenameStartIndex: (next: string) => void;
  targetExtension: DatasetTargetExtension;
  onChangeTargetExtension: (next: DatasetTargetExtension) => void;
  onApplyRename: () => void;
  onApplyExtension: () => void;
  renameBusy: boolean;
  extensionBusy: boolean;
};

/** Panel body for preview-dock file tools flyout (rename + extension unify). */
export function DatasetEditorFileToolsPanel({
  disabled,
  imageEntriesLength,
  scope,
  onChangeScope,
  groupPath,
  onChangeGroupPath,
  folderOptions,
  targetCount,
  renameBaseName,
  onChangeRenameBaseName,
  renameStartIndex,
  onChangeRenameStartIndex,
  targetExtension,
  onChangeTargetExtension,
  onApplyRename,
  onApplyExtension,
  renameBusy,
  extensionBusy,
}: Props) {
  const { t } = useI18n();
  const blockDisabled = disabled || imageEntriesLength === 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
      }}
    >
      <ImageScopePicker
        disabled={blockDisabled}
        t={t}
        config={{
          mode: scope,
          onChangeMode: onChangeScope,
          groupPath,
          onChangeGroupPath,
          folderOptions,
          targetCount,
          imageEntriesLength,
          labelKey: "dataset.fileToolsScope.label",
          folderMenuAriaKey: "dataset.fileToolsScope.folderMenuAria",
          selectionHintKey: "dataset.fileToolsScope.selectionHint",
          targetCountKey: "dataset.fileToolsScope.targetCount",
        }}
      />

      <div className="lf-trigger-scope-block">
        <div className="lf-trigger-field-label">{t("dataset.fileToolsRenameTitle")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          <input
            className="form-input"
            type="text"
            value={renameBaseName}
            disabled={blockDisabled || renameBusy}
            placeholder={t("dataset.fileToolsRenameBaseNamePlaceholder")}
            aria-label={t("dataset.fileToolsRenameBaseName")}
            onChange={(ev) => onChangeRenameBaseName(ev.target.value)}
            style={{ fontSize: "0.74rem", padding: "0.35rem 0.5rem" }}
          />
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <label
              style={{
                fontSize: "0.68rem",
                color: "var(--text-muted)",
                whiteSpace: "nowrap",
              }}
            >
              {t("dataset.fileToolsRenameStartIndex")}
            </label>
            <input
              className="form-input"
              type="number"
              min={1}
              step={1}
              value={renameStartIndex}
              disabled={blockDisabled || renameBusy}
              aria-label={t("dataset.fileToolsRenameStartIndex")}
              onChange={(ev) => onChangeRenameStartIndex(ev.target.value)}
              style={{
                width: "4.5rem",
                fontSize: "0.74rem",
                padding: "0.35rem 0.5rem",
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={blockDisabled || renameBusy || targetCount === 0}
              onClick={onApplyRename}
              style={{ marginLeft: "auto", padding: "0.28rem 0.55rem", fontSize: "0.72rem" }}
            >
              <FileImage size={12} aria-hidden style={{ marginRight: "0.25rem" }} />
              {renameBusy ? t("common.working") : t("dataset.fileToolsRenameApply")}
            </button>
          </div>
        </div>
        <div className="lf-trigger-hint">{t("dataset.fileToolsRenameHint")}</div>
      </div>

      <div className="lf-trigger-scope-block">
        <div className="lf-trigger-field-label">{t("dataset.fileToolsExtTitle")}</div>
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
          <label
            style={{
              fontSize: "0.68rem",
              color: "var(--text-muted)",
              whiteSpace: "nowrap",
            }}
          >
            {t("dataset.fileToolsExtTarget")}
          </label>
          <select
            className="form-input"
            value={targetExtension}
            disabled={blockDisabled || extensionBusy}
            aria-label={t("dataset.fileToolsExtTarget")}
            onChange={(ev) => onChangeTargetExtension(ev.target.value as DatasetTargetExtension)}
            style={{ flex: "1 1 6rem", fontSize: "0.74rem", padding: "0.35rem 0.5rem" }}
          >
            <option value="png">{t("dataset.fileToolsExt.png")}</option>
            <option value="jpg">{t("dataset.fileToolsExt.jpg")}</option>
            <option value="webp">{t("dataset.fileToolsExt.webp")}</option>
          </select>
          <button
            type="button"
            className="btn btn-primary"
            disabled={blockDisabled || extensionBusy || targetCount === 0}
            onClick={onApplyExtension}
            style={{ padding: "0.28rem 0.55rem", fontSize: "0.72rem" }}
          >
            {extensionBusy ? t("common.working") : t("dataset.fileToolsExtApply")}
          </button>
        </div>
        <div className="lf-trigger-hint">{t("dataset.fileToolsExtHint")}</div>
      </div>
    </div>
  );
}
