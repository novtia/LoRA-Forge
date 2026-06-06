import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, GitBranch, X } from "lucide-react";
import type { TranslateFn } from "../../lib/i18n";
import type { CustomRepoInput, TrainingRepoTarget } from "../../lib/types";

interface AddCustomRepoModalProps {
  saving: boolean;
  t: TranslateFn;
  onClose: () => void;
  onSubmit: (input: CustomRepoInput) => void | Promise<void>;
  onError?: (message: string) => void;
}

export function AddCustomRepoModal({ saving, t, onClose, onSubmit, onError }: AddCustomRepoModalProps) {
  const [name, setName] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [target, setTarget] = useState<TrainingRepoTarget>("windows");
  const [installPath, setInstallPath] = useState("");

  const canSave =
    name.trim().length > 0 && gitUrl.trim().length > 0 && installPath.trim().length > 0;

  const handleBrowse = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: t("env.installPath") });
      if (selected) setInstallPath(selected as string);
    } catch (dialogError) {
      onError?.(dialogError instanceof Error ? dialogError.message : t("errors.openDialog"));
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <GitBranch size={24} style={{ color: "var(--accent-acid)" }} />
            {t("env.addCustomRepo")}
          </div>
          <button className="modal-close" type="button" onClick={onClose}>
            <X size={24} />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">{t("env.repoName")}</label>
            <input
              type="text"
              className="form-input"
              placeholder={t("env.repoNamePlaceholder")}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t("env.gitUrl")}</label>
            <input
              type="text"
              className="form-input"
              placeholder="https://github.com/owner/repo"
              value={gitUrl}
              onChange={(event) => setGitUrl(event.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t("env.target")}</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {(["windows", "wsl"] as TrainingRepoTarget[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`btn ${target === value ? "btn-primary" : ""}`}
                  onClick={() => setTarget(value)}
                >
                  {value === "windows" ? t("env.targetWindows") : t("env.targetWsl")}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">{t("env.installPath")}</label>
            <div className="input-with-button">
              <input
                type="text"
                className="form-input"
                placeholder={
                  target === "wsl"
                    ? t("env.installPathWslPlaceholder")
                    : t("env.installPathWindowsPlaceholder")
                }
                value={installPath}
                onChange={(event) => setInstallPath(event.target.value)}
              />
              {target === "windows" ? (
                <button className="btn" type="button" onClick={() => void handleBrowse()}>
                  <FolderOpen size={16} /> {t("common.browse")}
                </button>
              ) : null}
            </div>
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
            style={{
              opacity: saving || !canSave ? 0.5 : 1,
              cursor: saving || !canSave ? "not-allowed" : "pointer",
            }}
            onClick={() =>
              void onSubmit({
                name: name.trim(),
                gitUrl: gitUrl.trim(),
                target,
                installPath: installPath.trim(),
              })
            }
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
