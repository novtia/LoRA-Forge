import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Pencil, X } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import type { ProjectRecord } from "../../lib/types";

export type EditProjectPayload = {
  name: string;
  rootPath: string;
};

type EditProjectModalProps = {
  project: ProjectRecord;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: EditProjectPayload) => void | Promise<void>;
  onError?: (message: string) => void;
};

export function EditProjectModal({
  project,
  saving,
  onClose,
  onSave,
  onError,
}: EditProjectModalProps) {
  const { t } = useI18n();
  const [name, setName] = useState(project.name);
  const [rootPath, setRootPath] = useState(project.rootPath);

  const handleSelectPath = async () => {
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: t("projectMenu.selectProjectRoot"),
      });
      if (selectedPath) {
        setRootPath(selectedPath as string);
      }
    } catch (dialogError) {
      onError?.(
        dialogError instanceof Error ? dialogError.message : t("errors.openDialog"),
      );
    }
  };

  const canSave = name.trim().length > 0 && rootPath.trim().length > 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <Pencil size={24} style={{ color: "var(--accent-acid)" }} />
            {t("projectMenu.editProject")}
          </div>
          <button className="modal-close" type="button" onClick={onClose}>
            <X size={24} />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">{t("dashboard.projectName")}</label>
            <input
              type="text"
              className="form-input"
              placeholder={t("dashboard.projectNamePlaceholder")}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t("projectMenu.projectRootPath")}</label>
            <div className="input-with-button">
              <input
                type="text"
                className="form-input"
                placeholder={t("projectMenu.projectRootPathPlaceholder")}
                value={rootPath}
                onChange={(event) => setRootPath(event.target.value)}
              />
              <button className="btn" type="button" onClick={() => void handleSelectPath()}>
                <FolderOpen size={16} /> {t("dashboard.browse")}
              </button>
            </div>
            <p
              style={{
                margin: "0.5rem 0 0",
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                lineHeight: 1.4,
              }}
            >
              {t("projectMenu.projectRootPathHint")}
            </p>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={saving || !canSave}
            onClick={() => void onSave({ name: name.trim(), rootPath: rootPath.trim() })}
            style={{
              opacity: saving || !canSave ? 0.5 : 1,
              cursor: saving || !canSave ? "not-allowed" : "pointer",
            }}
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
