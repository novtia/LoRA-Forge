import { Palette } from "lucide-react";
import { DESIGN_PRESETS, type DesignPresetId } from "../../lib/designSystem";
import { getDesignPresetCopy, type TranslateFn } from "../../lib/i18n";

interface DesignPaletteTabProps {
  activePresetId: DesignPresetId;
  onPresetChange: (presetId: DesignPresetId) => void;
  t: TranslateFn;
}

export function DesignPaletteTab({
  activePresetId,
  onPresetChange,
  t,
}: DesignPaletteTabProps) {
  return (
    <section className="card fade-in-section" style={{ gridColumn: "span 12", animationDelay: "0.2s" }}>
      <div className="card-header">
        <span className="card-title-icon">
          <Palette size={18} /> {t("design.paletteTransmissions")}
        </span>
        <span>{t("design.presetsCount", { count: DESIGN_PRESETS.length })}</span>
      </div>
      <div className="design-preset-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
        {DESIGN_PRESETS.map((preset) => {
          const active = preset.id === activePresetId;
          const presetCopy = getDesignPresetCopy(t, preset.id);

          return (
            <button
              key={preset.id}
              type="button"
              className={`design-preset-card${active ? " active" : ""}`}
              onClick={() => onPresetChange(preset.id)}
            >
              <div className="design-preset-meta">
                <span>{presetCopy.eyebrow}</span>
                <strong>{presetCopy.name}</strong>
              </div>
              <p>{presetCopy.description}</p>
              <div className="design-preset-swatches">
                {preset.swatches.map((swatch) => (
                  <i key={swatch} style={{ background: swatch }} />
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
