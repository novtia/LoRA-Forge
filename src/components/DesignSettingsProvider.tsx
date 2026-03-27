import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_DESIGN_SETTINGS,
  DESIGN_PRESET_MAP,
  DESIGN_SETTINGS_STORAGE_KEY,
  sanitizeDesignSettings,
  type DesignPreset,
  type DesignPresetId,
  type DesignSettings,
} from "../lib/designSystem";

interface DesignSettingsContextValue {
  settings: DesignSettings;
  activePreset: DesignPreset;
  updateSettings: (partial: Partial<DesignSettings>) => void;
  setPreset: (presetId: DesignPresetId) => void;
  resetSettings: () => void;
}

const DesignSettingsContext = createContext<DesignSettingsContextValue | null>(null);

function readStoredSettings(): DesignSettings {
  if (typeof window === "undefined") {
    return DEFAULT_DESIGN_SETTINGS;
  }

  try {
    const stored = window.localStorage.getItem(DESIGN_SETTINGS_STORAGE_KEY);
    return stored ? sanitizeDesignSettings(JSON.parse(stored)) : DEFAULT_DESIGN_SETTINGS;
  } catch {
    return DEFAULT_DESIGN_SETTINGS;
  }
}

export function DesignSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<DesignSettings>(readStoredSettings);

  const updateSettings = useCallback((partial: Partial<DesignSettings>) => {
    setSettings((current) => sanitizeDesignSettings({ ...current, ...partial }));
  }, []);

  const setPreset = useCallback((presetId: DesignPresetId) => {
    setSettings((current) => ({ ...current, presetId }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_DESIGN_SETTINGS);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(DESIGN_SETTINGS_STORAGE_KEY, JSON.stringify(settings));

    const root = document.documentElement;
    const body = document.body;
    const preset = DESIGN_PRESET_MAP[settings.presetId];

    Object.entries(preset.variables).forEach(([name, value]) => {
      root.style.setProperty(name, value);
    });

    const density =
      settings.densityMode === "compact"
        ? {
            "--page-padding-y": "0.75rem",
            "--page-padding-x": "1rem",
            "--page-gap": "0.6rem",
            "--grid-gap": "0.5rem",
            "--detail-grid-gap": "0.45rem",
            "--card-padding": "0.72rem",
            "--detail-card-padding": "0.55rem",
          }
        : {
            "--page-padding-y": "1rem",
            "--page-padding-x": "1.25rem",
            "--page-gap": "0.75rem",
            "--grid-gap": "0.6rem",
            "--detail-grid-gap": "0.5rem",
            "--card-padding": "0.85rem",
            "--detail-card-padding": "0.6rem",
          };

    Object.entries(density).forEach(([name, value]) => {
      root.style.setProperty(name, value);
    });

    root.style.setProperty("--body-cursor", settings.cursorMode === "radar" ? "none" : "auto");
    root.style.setProperty("--interactive-cursor", settings.cursorMode === "radar" ? "none" : "pointer");
    root.style.setProperty("--precision-cursor", settings.cursorMode === "radar" ? "none" : "crosshair");
    root.dataset.designPreset = settings.presetId;

    body.classList.toggle("design-grid-hidden", !settings.gridVisible);
    body.classList.toggle("design-noise-hidden", !settings.noiseVisible);
    body.classList.toggle("design-motion-minimal", settings.motionMode === "minimal");

    return () => {
      body.classList.remove("design-grid-hidden", "design-noise-hidden", "design-motion-minimal");
      delete root.dataset.designPreset;
    };
  }, [settings]);

  const value = useMemo(
    () => ({
      settings,
      activePreset: DESIGN_PRESET_MAP[settings.presetId],
      updateSettings,
      setPreset,
      resetSettings,
    }),
    [settings, updateSettings, setPreset, resetSettings],
  );

  return <DesignSettingsContext.Provider value={value}>{children}</DesignSettingsContext.Provider>;
}

export function useDesignSettings() {
  const context = useContext(DesignSettingsContext);

  if (!context) {
    throw new Error("useDesignSettings must be used inside DesignSettingsProvider");
  }

  return context;
}
