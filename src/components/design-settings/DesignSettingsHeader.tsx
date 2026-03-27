import { ChevronLeft, RotateCcw } from "lucide-react";
import type { TranslateFn } from "../../lib/i18n";

interface DesignSettingsHeaderProps {
  onBack: () => void;
  onReset: () => void;
  t: TranslateFn;
}

export function DesignSettingsHeader({ onBack, onReset, t }: DesignSettingsHeaderProps) {
  return (
    <header className="detail-header design-header">
      <div className="header-left">
        <button type="button" className="back-btn" onClick={onBack}>
          <ChevronLeft size={18} /> {t("common.back")}
        </button>
        <div className="project-title-group">
          <div className="project-title-main">
            {t("design.title")}
            <div className="status-badge status-badge-acid">
              <div className="status-dot" /> {t("common.live")}
            </div>
          </div>
          <div className="project-path">{t("design.subtitle")}</div>
        </div>
      </div>
      <div className="header-actions" style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" className="btn" onClick={onReset}>
          <RotateCcw size={16} /> {t("common.restoreFactory")}
        </button>
      </div>
    </header>
  );
}
