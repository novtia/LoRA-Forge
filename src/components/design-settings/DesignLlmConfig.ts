import { Activity, Cpu, Key, type LucideIcon } from "lucide-react";
import enDefaultSystemPrompt from "../../../prompts/system-prompt.en.md?raw";
import zhCnDefaultSystemPrompt from "../../../prompts/system-prompt.zh-CN.md?raw";
import type { SupportedLanguage } from "../../lib/i18n";
import type { LlmSettings } from "../../lib/types";

export const DEFAULT_LLM_ENDPOINT = "https://api.openai.com/v1";
export const DEFAULT_LLM_MODEL = "gpt-4o";
export const DEFAULT_LLM_KEY_PLACEHOLDER = "sk-...";
export const DEFAULT_LLM_TEMPERATURE = 1;
export const DEFAULT_LLM_MAX_TOKENS = 8096;

const DEFAULT_SYSTEM_PROMPTS: Record<SupportedLanguage, string> = {
  en: enDefaultSystemPrompt.trim(),
  "zh-CN": zhCnDefaultSystemPrompt.trim(),
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
  return DEFAULT_SYSTEM_PROMPTS[language];
}

export function isBuiltInSystemPrompt(prompt: string): boolean {
  const normalizedPrompt = prompt.trim();
  return Object.values(DEFAULT_SYSTEM_PROMPTS).includes(normalizedPrompt);
}

export function resolveSystemPrompt(prompt: string, language: SupportedLanguage): string {
  const defaultPrompt = getDefaultSystemPrompt(language);
  const normalizedPrompt = prompt.trim();

  if (!normalizedPrompt || isBuiltInSystemPrompt(normalizedPrompt)) {
    return defaultPrompt;
  }

  return prompt;
}

export function createDefaultLlmSettings(language: SupportedLanguage): LlmSettings {
  return {
    endpointUrl: DEFAULT_LLM_ENDPOINT,
    apiKey: "",
    modelId: DEFAULT_LLM_MODEL,
    systemPrompt: getDefaultSystemPrompt(language),
    temperature: DEFAULT_LLM_TEMPERATURE,
    maxTokens: DEFAULT_LLM_MAX_TOKENS,
  };
}
