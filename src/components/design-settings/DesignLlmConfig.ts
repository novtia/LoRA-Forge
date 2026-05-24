import { Activity, Cpu, Key, type LucideIcon } from "lucide-react";
import enDefaultSystemPrompt from "../../../prompts/system-prompt.en.md?raw";
import zhCnDefaultSystemPrompt from "../../../prompts/system-prompt.zh-CN.md?raw";
import animeSdPromptGenSystemPrompt from "../../../prompts/system-prompt-anime-sd-prompt-gen.md?raw";
import enStyleLoraSystemPrompt from "../../../prompts/system-prompt-style-lora.en.md?raw";
import zhCnStyleLoraSystemPrompt from "../../../prompts/system-prompt-style-lora.zh-CN.md?raw";
import type { SupportedLanguage } from "../../lib/i18n";
import type { LlmSettings } from "../../lib/types";

export const DEFAULT_LLM_ENDPOINT = "https://api.openai.com/v1";
export const DEFAULT_LLM_MODEL = "gpt-4o";
export const DEFAULT_LLM_KEY_PLACEHOLDER = "sk-...";
export const DEFAULT_LLM_TEMPERATURE = 1;
export const DEFAULT_LLM_MAX_TOKENS = 8096;
export const DEFAULT_LLM_CAPTION_RETRY_MAX = 3;

const DEFAULT_SYSTEM_PROMPTS: Record<SupportedLanguage, string> = {
  en: enDefaultSystemPrompt.trim(),
  "zh-CN": zhCnDefaultSystemPrompt.trim(),
};

const STYLE_LORA_SYSTEM_PROMPTS: Record<SupportedLanguage, string> = {
  en: enStyleLoraSystemPrompt.trim(),
  "zh-CN": zhCnStyleLoraSystemPrompt.trim(),
};

const ANIME_SD_PROMPT_GEN_BUILTIN = animeSdPromptGenSystemPrompt.trim();

interface LlmConnectionFieldConfig {
  id: "endpoint" | "apiKey" | "model";
  field: "endpointUrl" | "apiKey" | "modelId";
  icon: LucideIcon;
  labelKey: "design.llmUrl" | "design.llmKey" | "design.llmModel";
  descriptionKey: "design.llmUrlDesc" | "design.llmKeyDesc" | "design.llmModelDesc";
  inputType: "text" | "password";
  placeholder: string;
}

export const LLM_CONNECTION_FIELDS: LlmConnectionFieldConfig[] = [
  {
    id: "endpoint",
    field: "endpointUrl",
    icon: Activity,
    labelKey: "design.llmUrl",
    descriptionKey: "design.llmUrlDesc",
    inputType: "text",
    placeholder: DEFAULT_LLM_ENDPOINT,
  },
  {
    id: "apiKey",
    field: "apiKey",
    icon: Key,
    labelKey: "design.llmKey",
    descriptionKey: "design.llmKeyDesc",
    inputType: "password",
    placeholder: DEFAULT_LLM_KEY_PLACEHOLDER,
  },
  {
    id: "model",
    field: "modelId",
    icon: Cpu,
    labelKey: "design.llmModel",
    descriptionKey: "design.llmModelDesc",
    inputType: "text",
    placeholder: DEFAULT_LLM_MODEL,
  },
];

export function getDefaultSystemPrompt(language: SupportedLanguage): string {
  return DEFAULT_SYSTEM_PROMPTS[language];
}

/** Sync with UI language: use this content when the user wants the template to follow the app language. */
export const BUILTIN_PROMPT_FOLLOW_UI = "__builtin_follow_ui__";

/** Fixed English template from `system-prompt.en.md`. */
export const BUILTIN_PROMPT_EN = "__builtin_en__";

/** Fixed Simplified Chinese template from `system-prompt.zh-CN.md`. */
export const BUILTIN_PROMPT_ZH_CN = "__builtin_zh_cn__";

/** 固定 Anime / SD 提示词生成助手（tag + 自然语言，`system-prompt-anime-sd-prompt-gen.md`）。 */
export const BUILTIN_PROMPT_ANIME_SD = "__builtin_anime_sd_prompt_gen__";

/** 画风 / 画师 LoRA 打标（仅逗号 tag，禁止风格/媒介词，`system-prompt-style-lora.*.md`）。 */
export const BUILTIN_PROMPT_STYLE_LORA = "__builtin_style_lora__";

/** User edited the textarea; selection no longer matches a preset row. */
export const LLM_PROMPT_AD_HOC = "__ad_hoc__";

export function resolveSystemPrompt(prompt: string, language: SupportedLanguage): string {
  const defaultPrompt = getDefaultSystemPrompt(language);
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    return defaultPrompt;
  }
  return prompt;
}

export function applyBuiltinPromptSelection(
  selectionId: string,
  language: SupportedLanguage,
): string | null {
  switch (selectionId) {
    case BUILTIN_PROMPT_FOLLOW_UI:
      return getDefaultSystemPrompt(language);
    case BUILTIN_PROMPT_EN:
      return DEFAULT_SYSTEM_PROMPTS.en;
    case BUILTIN_PROMPT_ZH_CN:
      return DEFAULT_SYSTEM_PROMPTS["zh-CN"];
    case BUILTIN_PROMPT_ANIME_SD:
      return ANIME_SD_PROMPT_GEN_BUILTIN;
    case BUILTIN_PROMPT_STYLE_LORA:
      return STYLE_LORA_SYSTEM_PROMPTS[language];
    default:
      return null;
  }
}

export function inferLlmPromptPresetSelection(
  prompt: string,
  language: SupportedLanguage,
  customPresets: Array<{ id: string; systemPrompt: string }>,
): string {
  const t = prompt.trim();
  if (!t) {
    return BUILTIN_PROMPT_FOLLOW_UI;
  }

  const custom = customPresets.find((p) => p.systemPrompt.trim() === t);
  if (custom) {
    return custom.id;
  }

  const animeB = ANIME_SD_PROMPT_GEN_BUILTIN;
  if (t === animeB) {
    return BUILTIN_PROMPT_ANIME_SD;
  }

  const styleEn = STYLE_LORA_SYSTEM_PROMPTS.en.trim();
  const styleZh = STYLE_LORA_SYSTEM_PROMPTS["zh-CN"].trim();
  if (t === styleEn || t === styleZh) {
    return BUILTIN_PROMPT_STYLE_LORA;
  }

  const enD = DEFAULT_SYSTEM_PROMPTS.en.trim();
  const zhD = DEFAULT_SYSTEM_PROMPTS["zh-CN"].trim();

  if (t === enD) {
    return language === "en" ? BUILTIN_PROMPT_FOLLOW_UI : BUILTIN_PROMPT_EN;
  }
  if (t === zhD) {
    return language === "zh-CN" ? BUILTIN_PROMPT_FOLLOW_UI : BUILTIN_PROMPT_ZH_CN;
  }

  return LLM_PROMPT_AD_HOC;
}

const BUILTIN_PROMPT_IDS = new Set([
  BUILTIN_PROMPT_FOLLOW_UI,
  BUILTIN_PROMPT_EN,
  BUILTIN_PROMPT_ZH_CN,
  BUILTIN_PROMPT_ANIME_SD,
  BUILTIN_PROMPT_STYLE_LORA,
  LLM_PROMPT_AD_HOC,
]);

export function isKnownLlmPromptPresetId(
  id: string | undefined | null,
  customPresets: Array<{ id: string }>,
): boolean {
  if (!id) return false;
  if (BUILTIN_PROMPT_IDS.has(id)) return true;
  return customPresets.some((p) => p.id === id);
}

/** Prefer persisted preset id; fall back to inferring from prompt text. */
export function resolveLlmPromptPresetSelection(
  loadedId: string | undefined,
  prompt: string,
  language: SupportedLanguage,
  customPresets: Array<{ id: string; systemPrompt: string }>,
): string {
  if (isKnownLlmPromptPresetId(loadedId, customPresets)) {
    return loadedId!;
  }
  return inferLlmPromptPresetSelection(prompt, language, customPresets);
}

export function createDefaultLlmSettings(language: SupportedLanguage): LlmSettings {
  return {
    endpointUrl: DEFAULT_LLM_ENDPOINT,
    apiKey: "",
    modelId: DEFAULT_LLM_MODEL,
    systemPrompt: getDefaultSystemPrompt(language),
    temperature: DEFAULT_LLM_TEMPERATURE,
    maxTokens: DEFAULT_LLM_MAX_TOKENS,
    captionRetryMax: DEFAULT_LLM_CAPTION_RETRY_MAX,
    thinkingEnabled: false,
    endpointKind: "auto",
    maxCompletionTokens: 0,
    reasoningBudget: 0,
    reasoningEffort: "default",
    priorCaptionMode: "injectAsConversation",
    systemPromptPresetId: BUILTIN_PROMPT_FOLLOW_UI,
  };
}
