import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Zap } from "lucide-react";
import { useI18n } from "../lib/i18n";

const appWindow = getCurrentWindow();

export function Titlebar() {
  const { t } = useI18n();

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <div className="titlebar-logo-mark">
          <Zap size={12} />
        </div>
        <span className="titlebar-label">{t("app.name")}</span>
      </div>

      <div className="titlebar-controls">
        <button
          className="titlebar-btn"
          onClick={() => appWindow.minimize()}
          aria-label={t("common.minimize")}
          title={t("common.minimize")}
        >
          <Minus size={14} />
        </button>
        <button
          className="titlebar-btn"
          onClick={() => appWindow.toggleMaximize()}
          aria-label={t("common.maximize")}
          title={t("common.maximize")}
        >
          <Square size={11} />
        </button>
        <button
          className="titlebar-btn titlebar-btn-close"
          onClick={() => appWindow.close()}
          aria-label={t("common.close")}
          title={t("common.close")}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
