import { LayoutPanelTop, Sparkles } from "lucide-react";
import type { DesignPreset, DesignSettings } from "../../lib/designSystem";
import type { TranslateFn } from "../../lib/i18n";
import type { DesignPresetCopy, SignalSummaryItem } from "./types";

interface DesignProfileTabProps {
  activePreset: DesignPreset;
  activePresetCopy: DesignPresetCopy;
  settings: DesignSettings;
  signalSummary: SignalSummaryItem[];
  t: TranslateFn;
}

export function DesignProfileTab({
  activePreset,
  activePresetCopy,
  settings,
  signalSummary,
  t,
}: DesignProfileTabProps) {
  const motionLabel = t(settings.motionMode === "cinematic" ? "common.cinematic" : "common.minimal");
  const cursorLabel = t(settings.cursorMode === "radar" ? "common.radar" : "common.system");
  const densityLabel = t(settings.densityMode === "compact" ? "common.compact" : "common.comfortable");
  const densityFeelLabel = settings.densityMode === "compact" ? t("design.tight") : t("design.roomy");
  const overlayLabel = settings.gridVisible ? t("design.visible") : t("design.muted");
  const pointerLabel = settings.cursorMode === "radar" ? t("design.customOrbit") : t("design.nativeSystem");
  const motionFeelLabel = settings.motionMode === "cinematic" ? t("design.fullSignal") : t("design.reducedMotion");

  return (
    <>
      <section className="card design-hero-card fade-in-section" style={{ gridColumn: "span 7", animationDelay: "0.2s" }}>
        <div className="card-header">
          <span className="card-title-icon">
            <Sparkles size={18} /> {t("design.signalProfile")}
          </span>
          <span>{activePresetCopy.eyebrow}</span>
        </div>
        <div className="design-hero-body">
          <div className="design-hero-copy">
            <div className="design-hero-kicker">{t("design.currentPalette")}</div>
            <h1 className="design-hero-title">{activePresetCopy.name}</h1>
            <p className="design-hero-text">{activePresetCopy.description}</p>
            <div className="design-pill-row">
              <span className="design-pill">{t("design.realtimePreview")}</span>
              <span className="design-pill">{t("design.persistedLocally")}</span>
              <span className="design-pill">{t("design.cssVariables")}</span>
            </div>
          </div>

          <div className="design-swatch-stack" aria-hidden="true">
            {activePreset.swatches.map((swatch, index) => (
              <div
                key={swatch}
                className="design-swatch-strip"
                style={{
                  background: swatch,
                  transform: `translateX(${index * 10}px)`,
                }}
              />
            ))}
          </div>
        </div>

        <div className="design-signal-row">
          {signalSummary.map((item) => (
            <div key={item.label} className="design-signal-chip">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="card design-preview-card fade-in-section" style={{ gridColumn: "span 5", animationDelay: "0.3s" }}>
        <div className="card-header">
          <span className="card-title-icon">
            <LayoutPanelTop size={18} /> {t("design.hudMock")}
          </span>
          <span>{t("common.live")}</span>
        </div>
        <div className="design-preview-shell">
          <div className="design-preview-topbar">
            <span className="design-preview-dots">
              <i />
              <i />
              <i />
            </span>
            <span className="design-preview-tag">{t("design.previewActive")}</span>
          </div>
          <div className="design-preview-canvas">
            <div className="design-preview-chip">{t("design.preset")}</div>
            <div className="design-preview-title">{activePresetCopy.name}</div>
            <div className="design-preview-meter">
              <span>{t("design.visualEnergy")}</span>
              <div className="design-preview-track">
                <div className="design-preview-fill" />
              </div>
            </div>
            <div className="design-preview-stats">
              <div>
                <span>{t("design.motion")}</span>
                <strong>{motionLabel}</strong>
              </div>
              <div>
                <span>{t("design.cursor")}</span>
                <strong>{cursorLabel}</strong>
              </div>
              <div>
                <span>{t("design.density")}</span>
                <strong>{densityLabel}</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="card design-stage-card fade-in-section" style={{ gridColumn: "span 12", animationDelay: "0.4s" }}>
        <div className="card-header">
          <span className="card-title-icon">
            <Sparkles size={18} /> {t("design.liveStage")}
          </span>
          <span>{t("design.instantFeedback")}</span>
        </div>
        <div className="design-stage">
          <aside className="design-stage-rail">
            {signalSummary.map((item) => (
              <div key={item.label} className="design-stage-stat">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </aside>

          <div className="design-stage-grid">
            <div className="design-stage-panel large">
              <div className="design-stage-eyebrow">{t("design.studioFeel")}</div>
              <div className="design-stage-title">{t("design.studioFeelTitle")}</div>
              <p>{t("design.studioFeelDesc")}</p>
            </div>

            <div className="design-stage-panel">
              <div className="design-stage-eyebrow">{t("design.surface")}</div>
              <div className="design-stage-mini-row">
                <span>{t("design.cardPadding")}</span>
                <strong>{densityFeelLabel}</strong>
              </div>
              <div className="design-stage-mini-row">
                <span>{t("design.overlay")}</span>
                <strong>{overlayLabel}</strong>
              </div>
            </div>

            <div className="design-stage-panel">
              <div className="design-stage-eyebrow">{t("design.inputFeel")}</div>
              <div className="design-stage-mini-row">
                <span>{t("design.pointerMode")}</span>
                <strong>{pointerLabel}</strong>
              </div>
              <div className="design-stage-mini-row">
                <span>{t("design.motionMode")}</span>
                <strong>{motionFeelLabel}</strong>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
