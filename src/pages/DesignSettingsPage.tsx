import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { DesignInterfaceTab } from "../components/design-settings/DesignInterfaceTab";
import { DesignLlmTab } from "../components/design-settings/DesignLlmTab";
import { DesignTrainingEnvTab } from "../components/design-settings/DesignTrainingEnvTab";
import { DesignPaletteTab } from "../components/design-settings/DesignPaletteTab";
import { DesignProfileTab } from "../components/design-settings/DesignProfileTab";
import { DesignSettingsHeader } from "../components/design-settings/DesignSettingsHeader";
import { DesignSettingsTabs } from "../components/design-settings/DesignSettingsTabs";
import type { DesignTab, SignalSummaryItem } from "../components/design-settings/types";
import { useDesignSettings } from "../components/DesignSettingsProvider";
import { getDesignPresetCopy, useI18n } from "../lib/i18n";

type RouteState = {
  from?: string;
};

export default function DesignSettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { settings, activePreset, updateSettings, setPreset, resetSettings } = useDesignSettings();
  const { language, setLanguage, t } = useI18n();

  const [activeTab, setActiveTab] = useState<DesignTab>("profile");

  const backTarget = (location.state as RouteState | null)?.from ?? "/";
  const activePresetCopy = useMemo(() => getDesignPresetCopy(t, activePreset.id), [activePreset.id, t]);

  const signalSummary = useMemo<SignalSummaryItem[]>(
    () => [
      {
        label: t("design.motion"),
        value: t(settings.motionMode === "cinematic" ? "common.cinematic" : "common.minimal"),
      },
      {
        label: t("design.density"),
        value: t(settings.densityMode === "compact" ? "common.compact" : "common.comfortable"),
      },
      {
        label: t("design.field"),
        value: `${t(settings.gridVisible ? "design.grid" : "design.plain")} / ${t(
          settings.noiseVisible ? "design.noise" : "design.clean",
        )}`,
      },
    ],
    [settings, t],
  );

  return (
    <div className="container page-design">
      <DesignSettingsHeader
        onBack={() => navigate(backTarget)}
        onReset={resetSettings}
        t={t}
      />

      <DesignSettingsTabs activeTab={activeTab} onTabChange={setActiveTab} t={t} />

      <div className="bento design-bento">
        {activeTab === "profile" && (
          <DesignProfileTab
            activePreset={activePreset}
            activePresetCopy={activePresetCopy}
            settings={settings}
            signalSummary={signalSummary}
            t={t}
          />
        )}

        {activeTab === "palette" && (
          <DesignPaletteTab
            activePresetId={settings.presetId}
            onPresetChange={setPreset}
            t={t}
          />
        )}

        {activeTab === "interface" && (
          <DesignInterfaceTab
            language={language}
            onLanguageChange={setLanguage}
            settings={settings}
            updateSettings={updateSettings}
            t={t}
          />
        )}

        {activeTab === "training" && <DesignTrainingEnvTab t={t} />}

        {activeTab === "llm" && <DesignLlmTab language={language} t={t} />}
      </div>
    </div>
  );
}
