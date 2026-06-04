import { Activity, Cpu, Key, type LucideIcon } from "lucide-react";
import type { SupportedLanguage } from "../../lib/i18n";
import {
  findPromptDocByBody,
  getPromptDocByFileName,
  getPromptDocById,
  isPromptDocId,
  PROMPT_DOCS,
} from "../../lib/promptDocs";
import type { LlmSettings } from "../../lib/types";

export const DEFAULT_LLM_ENDPOINT = "https://api.openai.com/v1";
export const DEFAULT_LLM_MODEL = "gpt-4o";
export const DEFAULT_LLM_KEY_PLACEHOLDER = "sk-...";
export const DEFAULT_LLM_TEMPERATURE = 1;
export const DEFAULT_LLM_MAX_TOKENS = 8096;
export const DEFAULT_LLM_CAPTION_RETRY_MAX = 3;

/**
 * Markdown files (without extension) used as the per-language default template
 * behind the "follow UI language" preset.
 */
const DEFAULT_DOC_FILENAMES: Record<SupportedLanguage, string> = {
  en: "system-prompt.en",
  "zh-CN": "system-prompt.zh-CN",
};

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
  const doc =
    getPromptDocByFileName(DEFAULT_DOC_FILENAMES[language]) ??
    getPromptDocByFileName(DEFAULT_DOC_FILENAMES.en) ??
    PROMPT_DOCS[0];
  return doc ? doc.body : "";
}

/** Sync with UI language: use this content when the user wants the template to follow the app language. */
export const BUILTIN_PROMPT_FOLLOW_UI = "__builtin_follow_ui__";

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
  if (selectionId === BUILTIN_PROMPT_FOLLOW_UI) {
    return getDefaultSystemPrompt(language);
  }
  if (isPromptDocId(selectionId)) {
    const doc = getPromptDocById(selectionId);
    return doc ? doc.body : null;
  }
  return null;
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

  const doc = findPromptDocByBody(t);
  if (doc) {
    // The active language's default doc is represented by the "follow UI" row so
    // the selection stays sticky when the UI language changes.
    return doc.fileName === DEFAULT_DOC_FILENAMES[language] ? BUILTIN_PROMPT_FOLLOW_UI : doc.id;
  }

  return LLM_PROMPT_AD_HOC;
}

export function isKnownLlmPromptPresetId(
  id: string | undefined | null,
  customPresets: Array<{ id: string }>,
): boolean {
  if (!id) return false;
  if (id === BUILTIN_PROMPT_FOLLOW_UI || id === LLM_PROMPT_AD_HOC) return true;
  if (isPromptDocId(id)) return getPromptDocById(id) !== undefined;
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
