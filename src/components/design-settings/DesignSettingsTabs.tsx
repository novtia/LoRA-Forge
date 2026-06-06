import { Bot, Monitor, Palette, Server, Sparkles, type LucideIcon } from "lucide-react";
import type { TranslateFn } from "../../lib/i18n";
import type { DesignTab } from "./types";

interface DesignSettingsTabsProps {
  activeTab: DesignTab;
  onTabChange: (tab: DesignTab) => void;
  t: TranslateFn;
}

export function DesignSettingsTabs({
  activeTab,
  onTabChange,
  t,
}: DesignSettingsTabsProps) {
  const tabs: Array<{ id: DesignTab; icon: LucideIcon; label: string }> = [
    {
      id: "profile",
      icon: Sparkles,
      label: t("design.signalProfile"),
    },
    {
      id: "palette",
      icon: Palette,
      label: t("design.paletteTransmissions"),
    },
    {
      id: "interface",
      icon: Monitor,
      label: t("design.interfaceTuning"),
    },
    {
      id: "env",
      icon: Server,
      label: t("env.title"),
    },
    {
      id: "llm",
      icon: Bot,
      label: t("design.llmSettings") || "LLM Settings",
    },
  ];

  return (
    <div className="design-tabs-container fade-in-section" style={{ animationDelay: "0.1s" }}>
      <div className="design-tab-list">
        {tabs.map((tab) => {
          const Icon = tab.icon;

          return (
            <button
              key={tab.id}
              type="button"
              className={`design-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => onTabChange(tab.id)}
            >
              <Icon size={16} /> {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
