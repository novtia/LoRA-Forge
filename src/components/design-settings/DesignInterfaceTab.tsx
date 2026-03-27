import { Grid3X3, LayoutPanelTop, Monitor, MousePointer2, Palette, Sparkles, Waves } from "lucide-react";
import type { CursorMode, DensityMode, DesignSettings, MotionMode } from "../../lib/designSystem";
import type { SupportedLanguage, TranslateFn } from "../../lib/i18n";
import { SegmentControl, ToggleRow } from "./DesignSettingsControls";

interface DesignInterfaceTabProps {
  language: SupportedLanguage;
  onLanguageChange: (language: SupportedLanguage) => void;
  settings: DesignSettings;
  updateSettings: (partial: Partial<DesignSettings>) => void;
  t: TranslateFn;
}

export function DesignInterfaceTab({
  language,
  onLanguageChange,
  settings,
  updateSettings,
  t,
}: DesignInterfaceTabProps) {
  return (
    <>
      <section className="card fade-in-section" style={{ gridColumn: "span 6", animationDelay: "0.2s" }}>
        <div className="card-header">
          <span className="card-title-icon">
            <Monitor size={18} /> {t("design.generalDisplay") || "General Display"}
          </span>
        </div>
        <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <SegmentControl<SupportedLanguage>
            icon={<Palette size={16} />}
            label={t("design.language")}
            value={language}
            options={[
              { value: "en", label: t("language.en") },
              { value: "zh-CN", label: t("language.zh-CN") },
            ]}
            onChange={onLanguageChange}
          />
          <SegmentControl<MotionMode>
            icon={<Sparkles size={16} />}
            label={t("design.motionMode")}
            value={settings.motionMode}
            options={[
              { value: "cinematic", label: t("common.cinematic") },
              { value: "minimal", label: t("common.minimal") },
            ]}
            onChange={(value) => updateSettings({ motionMode: value })}
          />
        </div>
      </section>

      <section className="card fade-in-section" style={{ gridColumn: "span 6", animationDelay: "0.3s" }}>
        <div className="card-header">
          <span className="card-title-icon">
            <MousePointer2 size={18} /> {t("design.interaction") || "Interaction & Layout"}
          </span>
        </div>
        <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <SegmentControl<CursorMode>
            icon={<MousePointer2 size={16} />}
            label={t("design.cursor")}
            value={settings.cursorMode}
            options={[
              { value: "radar", label: t("common.radar") },
              { value: "system", label: t("common.system") },
            ]}
            onChange={(value) => updateSettings({ cursorMode: value })}
          />
          <SegmentControl<DensityMode>
            icon={<LayoutPanelTop size={16} />}
            label={t("design.density")}
            value={settings.densityMode}
            options={[
              { value: "comfortable", label: t("common.comfortable") },
              { value: "compact", label: t("common.compact") },
            ]}
            onChange={(value) => updateSettings({ densityMode: value })}
          />
        </div>
      </section>

      <section className="card fade-in-section" style={{ gridColumn: "span 12", animationDelay: "0.4s" }}>
        <div className="card-header">
          <span className="card-title-icon">
            <Grid3X3 size={18} /> {t("design.visualEffects") || "Visual Effects & Overlays"}
          </span>
        </div>
        <div
          className="design-toggle-bank"
          style={{
            padding: "1.5rem",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "1.5rem",
            border: "none",
          }}
        >
          <ToggleRow
            icon={<Grid3X3 size={16} />}
            label={t("design.gridMatrix")}
            description={t("design.gridMatrixDesc")}
            checked={settings.gridVisible}
            onToggle={() => updateSettings({ gridVisible: !settings.gridVisible })}
          />
          <ToggleRow
            icon={<Waves size={16} />}
            label={t("design.noiseBloom")}
            description={t("design.noiseBloomDesc")}
            checked={settings.noiseVisible}
            onToggle={() => updateSettings({ noiseVisible: !settings.noiseVisible })}
          />
        </div>
      </section>
    </>
  );
}
