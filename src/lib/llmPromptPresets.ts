import type { LlmSettings } from "./types";

export interface LlmPromptPreset {
  id: string;
  name: string;
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export const CUSTOM_LLM_PROMPT_PRESET_STORAGE_KEY = "lora-forge.customLlmPromptPresets";

export const LLM_PROMPT_PRESET_EXPORT_KIND = "lora-forge-llm-prompt-presets";

export const LLM_PROMPT_PRESET_EXPORT_VERSION = 1;

export function loadCustomLlmPromptPresets(): LlmPromptPreset[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_LLM_PROMPT_PRESET_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is LlmPromptPreset => {
      if (!p || typeof p !== "object") return false;
      const o = p as LlmPromptPreset;
      return (
        typeof o.id === "string" &&
        o.id.startsWith("custom-") &&
        typeof o.name === "string" &&
        typeof o.systemPrompt === "string"
      );
    });
  } catch {
    return [];
  }
}

export function saveCustomLlmPromptPresets(presets: LlmPromptPreset[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(CUSTOM_LLM_PROMPT_PRESET_STORAGE_KEY, JSON.stringify(presets));
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function createUserLlmPromptPreset(
  name: string,
  snapshot: Pick<LlmSettings, "systemPrompt" | "temperature" | "maxTokens">,
): LlmPromptPreset {
  const trimmed = name.trim();
  const id = `custom-${Date.now()}-${randomSuffix()}`;
  return {
    id,
    name: trimmed,
    systemPrompt: snapshot.systemPrompt,
    temperature: snapshot.temperature,
    maxTokens: snapshot.maxTokens,
  };
}

export function applyLlmPromptPresetToSettings(settings: LlmSettings, preset: LlmPromptPreset): LlmSettings {
  return {
    ...settings,
    systemPrompt: preset.systemPrompt,
    ...(preset.temperature !== undefined ? { temperature: preset.temperature } : {}),
    ...(preset.maxTokens !== undefined ? { maxTokens: preset.maxTokens } : {}),
  };
}

export function serializeLlmPromptPresetsForExport(presets: LlmPromptPreset[]): string {
  const body = {
    kind: LLM_PROMPT_PRESET_EXPORT_KIND,
    version: LLM_PROMPT_PRESET_EXPORT_VERSION,
    presets: presets.map(({ name, systemPrompt, temperature, maxTokens }) => {
      const row: {
        name: string;
        systemPrompt: string;
        temperature?: number;
        maxTokens?: number;
      } = { name, systemPrompt };
      if (temperature !== undefined) row.temperature = temperature;
      if (maxTokens !== undefined) row.maxTokens = maxTokens;
      return row;
    }),
  };
  return JSON.stringify(body, null, 2);
}

function makeImportedId(index: number): string {
  return `custom-${Date.now()}-${index}-${randomSuffix()}`;
}

export function importLlmPromptPresetsFromJson(text: string): LlmPromptPreset[] {
  const data = JSON.parse(text) as unknown;
  if (!data || typeof data !== "object") {
    throw new Error("invalid");
  }
  const o = data as Record<string, unknown>;
  if (o.kind !== LLM_PROMPT_PRESET_EXPORT_KIND) {
    throw new Error("wrong kind");
  }
  if (o.version !== LLM_PROMPT_PRESET_EXPORT_VERSION) {
    throw new Error("wrong version");
  }
  if (!Array.isArray(o.presets)) {
    throw new Error("no presets");
  }
  const out: LlmPromptPreset[] = [];
  let index = 0;
  for (const item of o.presets) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const name = typeof p.name === "string" ? p.name.trim() : "";
    const systemPrompt = typeof p.systemPrompt === "string" ? p.systemPrompt : "";
    if (!name || !systemPrompt.trim()) continue;
    const temperature = typeof p.temperature === "number" ? p.temperature : undefined;
    const maxTokens = typeof p.maxTokens === "number" ? p.maxTokens : undefined;
    out.push({
      id: makeImportedId(index),
      name,
      systemPrompt,
      temperature,
      maxTokens,
    });
    index += 1;
  }
  return out;
}

export function mergeImportedLlmPromptPresets(
  existing: LlmPromptPreset[],
  imported: LlmPromptPreset[],
): LlmPromptPreset[] {
  return [...existing, ...imported];
}
