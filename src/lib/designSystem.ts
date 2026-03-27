export type DesignPresetId =
  | "acid-forge"
  | "ember-tape"
  | "glacier-signal"
  | "velvet-reactor";

export type MotionMode = "cinematic" | "minimal";
export type CursorMode = "radar" | "system";
export type DensityMode = "compact" | "comfortable";

export interface DesignSettings {
  presetId: DesignPresetId;
  motionMode: MotionMode;
  cursorMode: CursorMode;
  densityMode: DensityMode;
  gridVisible: boolean;
  noiseVisible: boolean;
}

export interface DesignPreset {
  id: DesignPresetId;
  name: string;
  eyebrow: string;
  description: string;
  swatches: [string, string, string, string];
  variables: Record<string, string>;
}

export const DESIGN_SETTINGS_STORAGE_KEY = "lora-forge.design-settings";

export const DESIGN_PRESETS: DesignPreset[] = [
  {
    id: "acid-forge",
    name: "Acid Forge",
    eyebrow: "Factory Default",
    description: "High-contrast studio HUD with acid lime signal bands and deep graphite surfaces.",
    swatches: ["#101010", "#1a1a1a", "#d4ff00", "#ff5500"],
    variables: {
      "--bg-base": "#111111",
      "--bg-surface": "#1a1a1a",
      "--bg-surface-alt": "#262626",
      "--border-dim": "#3a3a3a",
      "--border-glow": "#666666",
      "--text-main": "#ffffff",
      "--text-muted": "#b8b8b8",
      "--text-dark": "#000000",
      "--accent-acid": "#d4ff00",
      "--accent-acid-dim": "rgba(212, 255, 0, 0.12)",
      "--accent-orange": "#ff5500",
      "--accent-orange-dim": "rgba(255, 85, 0, 0.14)",
      "--accent-white": "#ffffff",
      "--scrollbar-track": "rgba(255, 255, 255, 0.04)",
      "--scrollbar-thumb": "rgba(212, 255, 0, 0.3)",
      "--scrollbar-thumb-hover": "rgba(255, 85, 0, 0.5)",
      "--scrollbar-thumb-border": "rgba(17, 17, 17, 0.92)",
      "--ambient-primary": "rgba(212, 255, 0, 0.16)",
      "--ambient-secondary": "rgba(255, 85, 0, 0.14)",
      "--ambient-opacity": "0.34",
      "--overlay-line": "rgba(255, 255, 255, 0.08)",
      "--overlay-opacity": "0.12",
      "--noise-opacity": "0.035",
      "--preview-gradient": "linear-gradient(135deg, rgba(212, 255, 0, 0.18), rgba(255, 85, 0, 0.12))",
      "--hero-ribbon": "linear-gradient(90deg, #d4ff00, #ff5500)",
    },
  },
  {
    id: "ember-tape",
    name: "Ember Tape",
    eyebrow: "Analog Burn",
    description: "Smoked cassette deck palette with toasted amber highlights and warm terminal glass.",
    swatches: ["#14100f", "#201815", "#ffcf70", "#ff7b39"],
    variables: {
      "--bg-base": "#14100f",
      "--bg-surface": "#201815",
      "--bg-surface-alt": "#2a201c",
      "--border-dim": "#4a3429",
      "--border-glow": "#7a5542",
      "--text-main": "#fff3da",
      "--text-muted": "#cfbba2",
      "--text-dark": "#140e0a",
      "--accent-acid": "#ffcf70",
      "--accent-acid-dim": "rgba(255, 207, 112, 0.14)",
      "--accent-orange": "#ff7b39",
      "--accent-orange-dim": "rgba(255, 123, 57, 0.16)",
      "--accent-white": "#fff3da",
      "--scrollbar-track": "rgba(255, 243, 218, 0.04)",
      "--scrollbar-thumb": "rgba(255, 207, 112, 0.34)",
      "--scrollbar-thumb-hover": "rgba(255, 123, 57, 0.52)",
      "--scrollbar-thumb-border": "rgba(20, 16, 15, 0.92)",
      "--ambient-primary": "rgba(255, 123, 57, 0.16)",
      "--ambient-secondary": "rgba(255, 207, 112, 0.12)",
      "--ambient-opacity": "0.3",
      "--overlay-line": "rgba(255, 207, 112, 0.1)",
      "--overlay-opacity": "0.11",
      "--noise-opacity": "0.04",
      "--preview-gradient": "linear-gradient(135deg, rgba(255, 123, 57, 0.18), rgba(255, 207, 112, 0.1))",
      "--hero-ribbon": "linear-gradient(90deg, #ff7b39, #ffcf70)",
    },
  },
  {
    id: "glacier-signal",
    name: "Glacier Signal",
    eyebrow: "Cold Broadcast",
    description: "Icy blueprint panels with frozen cyan glows and crisp editorial contrast.",
    swatches: ["#071319", "#0f1f27", "#78f6ff", "#ff8f6b"],
    variables: {
      "--bg-base": "#071319",
      "--bg-surface": "#0f1f27",
      "--bg-surface-alt": "#16303c",
      "--border-dim": "#295263",
      "--border-glow": "#4f7f91",
      "--text-main": "#ecfeff",
      "--text-muted": "#9dc1cb",
      "--text-dark": "#061015",
      "--accent-acid": "#78f6ff",
      "--accent-acid-dim": "rgba(120, 246, 255, 0.14)",
      "--accent-orange": "#ff8f6b",
      "--accent-orange-dim": "rgba(255, 143, 107, 0.16)",
      "--accent-white": "#ecfeff",
      "--scrollbar-track": "rgba(236, 254, 255, 0.04)",
      "--scrollbar-thumb": "rgba(120, 246, 255, 0.34)",
      "--scrollbar-thumb-hover": "rgba(255, 143, 107, 0.52)",
      "--scrollbar-thumb-border": "rgba(7, 19, 25, 0.92)",
      "--ambient-primary": "rgba(120, 246, 255, 0.16)",
      "--ambient-secondary": "rgba(255, 143, 107, 0.12)",
      "--ambient-opacity": "0.28",
      "--overlay-line": "rgba(120, 246, 255, 0.1)",
      "--overlay-opacity": "0.1",
      "--noise-opacity": "0.025",
      "--preview-gradient": "linear-gradient(135deg, rgba(120, 246, 255, 0.16), rgba(255, 143, 107, 0.1))",
      "--hero-ribbon": "linear-gradient(90deg, #78f6ff, #ecfeff)",
    },
  },
  {
    id: "velvet-reactor",
    name: "Velvet Reactor",
    eyebrow: "Stage Lighting",
    description: "A darker theatrical mix of plum-black steel, brass glints and ember warning lights.",
    swatches: ["#130c10", "#21161d", "#f5c451", "#ff6a3d"],
    variables: {
      "--bg-base": "#130c10",
      "--bg-surface": "#21161d",
      "--bg-surface-alt": "#2d1d27",
      "--border-dim": "#533744",
      "--border-glow": "#8a5560",
      "--text-main": "#fff4eb",
      "--text-muted": "#d3b6b2",
      "--text-dark": "#120b0d",
      "--accent-acid": "#f5c451",
      "--accent-acid-dim": "rgba(245, 196, 81, 0.14)",
      "--accent-orange": "#ff6a3d",
      "--accent-orange-dim": "rgba(255, 106, 61, 0.16)",
      "--accent-white": "#fff4eb",
      "--scrollbar-track": "rgba(255, 244, 235, 0.04)",
      "--scrollbar-thumb": "rgba(245, 196, 81, 0.32)",
      "--scrollbar-thumb-hover": "rgba(255, 106, 61, 0.5)",
      "--scrollbar-thumb-border": "rgba(19, 12, 16, 0.92)",
      "--ambient-primary": "rgba(245, 196, 81, 0.13)",
      "--ambient-secondary": "rgba(255, 106, 61, 0.14)",
      "--ambient-opacity": "0.3",
      "--overlay-line": "rgba(255, 244, 235, 0.08)",
      "--overlay-opacity": "0.11",
      "--noise-opacity": "0.038",
      "--preview-gradient": "linear-gradient(135deg, rgba(245, 196, 81, 0.16), rgba(255, 106, 61, 0.12))",
      "--hero-ribbon": "linear-gradient(90deg, #f5c451, #ff6a3d)",
    },
  },
];

export const DESIGN_PRESET_MAP = Object.fromEntries(
  DESIGN_PRESETS.map((preset) => [preset.id, preset]),
) as Record<DesignPresetId, DesignPreset>;

export const DEFAULT_DESIGN_SETTINGS: DesignSettings = {
  presetId: "acid-forge",
  motionMode: "cinematic",
  cursorMode: "radar",
  densityMode: "comfortable",
  gridVisible: true,
  noiseVisible: true,
};

export function sanitizeDesignSettings(input: unknown): DesignSettings {
  const candidate = typeof input === "object" && input ? (input as Partial<DesignSettings>) : {};

  return {
    presetId:
      candidate.presetId && candidate.presetId in DESIGN_PRESET_MAP
        ? candidate.presetId
        : DEFAULT_DESIGN_SETTINGS.presetId,
    motionMode:
      candidate.motionMode === "minimal" || candidate.motionMode === "cinematic"
        ? candidate.motionMode
        : DEFAULT_DESIGN_SETTINGS.motionMode,
    cursorMode:
      candidate.cursorMode === "system" || candidate.cursorMode === "radar"
        ? candidate.cursorMode
        : DEFAULT_DESIGN_SETTINGS.cursorMode,
    densityMode:
      candidate.densityMode === "compact" || candidate.densityMode === "comfortable"
        ? candidate.densityMode
        : DEFAULT_DESIGN_SETTINGS.densityMode,
    gridVisible:
      typeof candidate.gridVisible === "boolean"
        ? candidate.gridVisible
        : DEFAULT_DESIGN_SETTINGS.gridVisible,
    noiseVisible:
      typeof candidate.noiseVisible === "boolean"
        ? candidate.noiseVisible
        : DEFAULT_DESIGN_SETTINGS.noiseVisible,
  };
}
