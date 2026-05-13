import type { TrainingConfig } from "./types";

export interface TrainingPreset {
  id: string;
  label: string;
  labelZh: string;
  description: string;
  descriptionZh: string;
  /** Which training script this preset targets. */
  script: string;
  /** Partial training params applied on top of the current config.
   *  Path fields (pretrainedModel, vae, animaQwen3, networkWeights, resume)
   *  are intentionally omitted so the user's paths are always preserved. */
  params: Partial<TrainingConfig>;
}

// ─── shared base layers ──────────────────────────────────────────────────────

const SD15_BASE: Partial<TrainingConfig> = {
  trainingScript: "train_network.py",
  resolution: "512x512",
  batchSize: 4,
  epochs: 20,
  stepsPerEpoch: 300,
  saveEveryNEpochs: 5,
  mixedPrecision: "bf16",
  savePrecision: "",
  optimizer: "AdamW8bit",
  optimizerArgs: "",
  lrScheduler: "cosine_with_restarts",
  lrSchedulerNumCycles: "3",
  lrSchedulerPower: "",
  lrWarmupSteps: 0,
  gradientCheckpointing: true,
  xformers: true,
  cacheLatents: true,
  cacheLatentsToDisk: false,
  enableBucket: true,
  minBucketReso: 256,
  maxBucketReso: 768,
  bucketResoSteps: 64,
  datasetRepeats: 1,
  shuffleCaptions: true,
  colorJitter: false,
  noiseOffset: "0.1",
  maxGradNorm: "1",
  captionDropoutRate: "0",
  captionTagDropoutRate: "0",
  networkDropout: "0",
  convDim: 0,
  convAlpha: 0,
  maxDataLoaderWorkers: 2,
  persistentDataLoaderWorkers: false,
};

const SDXL_BASE: Partial<TrainingConfig> = {
  trainingScript: "sdxl_train_network.py",
  resolution: "1024x1024",
  batchSize: 2,
  epochs: 20,
  stepsPerEpoch: 300,
  saveEveryNEpochs: 5,
  mixedPrecision: "bf16",
  savePrecision: "fp16",
  optimizer: "AdamW8bit",
  optimizerArgs: "",
  lrScheduler: "cosine_with_restarts",
  lrSchedulerNumCycles: "3",
  lrSchedulerPower: "",
  lrWarmupSteps: 50,
  gradientCheckpointing: true,
  xformers: false,
  cacheLatents: true,
  cacheLatentsToDisk: false,
  enableBucket: true,
  minBucketReso: 512,
  maxBucketReso: 2048,
  bucketResoSteps: 32,
  datasetRepeats: 1,
  shuffleCaptions: true,
  colorJitter: false,
  noiseOffset: "0",
  maxGradNorm: "1",
  captionDropoutRate: "0",
  captionTagDropoutRate: "0",
  networkDropout: "0",
  convDim: 0,
  convAlpha: 0,
  clipSkip: 0,
  maxDataLoaderWorkers: 2,
  persistentDataLoaderWorkers: false,
};

const ANIMA_BASE: Partial<TrainingConfig> = {
  trainingScript: "anima_train_network.py",
  resolution: "1024x1024",
  batchSize: 2,
  epochs: 20,
  stepsPerEpoch: 300,
  saveEveryNEpochs: 5,
  mixedPrecision: "bf16",
  savePrecision: "fp16",
  optimizer: "AdamW8bit",
  optimizerArgs: "",
  lrScheduler: "cosine_with_restarts",
  lrSchedulerNumCycles: "3",
  lrSchedulerPower: "",
  lrWarmupSteps: 0,
  gradientCheckpointing: true,
  xformers: false,
  cacheLatents: true,
  cacheLatentsToDisk: false,
  enableBucket: true,
  minBucketReso: 512,
  maxBucketReso: 2048,
  bucketResoSteps: 32,
  datasetRepeats: 1,
  shuffleCaptions: true,
  colorJitter: false,
  noiseOffset: "0",
  maxGradNorm: "1",
  captionDropoutRate: "0",
  captionTagDropoutRate: "0",
  networkDropout: "0",
  convDim: 0,
  convAlpha: 0,
  animaLlmAdapterLr: "0",
  textEncoderLr: "",
  minSnrGamma: "",
  maxDataLoaderWorkers: 2,
  persistentDataLoaderWorkers: false,
};

// ─── default preset catalogue ─────────────────────────────────────────────────

export const DEFAULT_PRESETS: TrainingPreset[] = [
  // ── SD 1.x ──────────────────────────────────────────────────────────────
  {
    id: "sd15-character",
    label: "SD 1.x · Character LoRA",
    labelZh: "SD 1.x · 人物 LoRA",
    description:
      "Recommended for training a specific character. High rank, keep trigger token, minSNR loss weighting.",
    descriptionZh:
      "适合训练特定角色：高秩、保留触发词、使用 minSNR 损失加权。",
    script: "train_network.py",
    params: {
      ...SD15_BASE,
      networkDim: 128,
      networkAlpha: 64,
      baseLr: "1.5e-4",
      unetLr: "1.5e-4",
      textEncoderLr: "5e-5",
      minSnrGamma: "5",
      keepTokens: 1,
      clipSkip: 2,
      seed: 0,
    },
  },
  {
    id: "sd15-style",
    label: "SD 1.x · Style / Artist LoRA",
    labelZh: "SD 1.x · 画风 / 画师 LoRA",
    description:
      "Art style or artist LoRA. Lower rank, tag dropout for better generalization.",
    descriptionZh:
      "艺术风格 / 画师 LoRA：低秩，启用标签 dropout 提升泛化。",
    script: "train_network.py",
    params: {
      ...SD15_BASE,
      networkDim: 64,
      networkAlpha: 32,
      baseLr: "1e-4",
      unetLr: "1e-4",
      textEncoderLr: "2e-5",
      minSnrGamma: "5",
      keepTokens: 0,
      clipSkip: 1,
      captionTagDropoutRate: "0.1",
      noiseOffset: "0.05",
      seed: 0,
    },
  },
  {
    id: "sd15-concept",
    label: "SD 1.x · Concept / Object LoRA",
    labelZh: "SD 1.x · 概念 / 物体 LoRA",
    description:
      "General-purpose preset for objects, clothing, or abstract concepts.",
    descriptionZh:
      "适合物体、服装或抽象概念的通用预设。",
    script: "train_network.py",
    params: {
      ...SD15_BASE,
      networkDim: 64,
      networkAlpha: 32,
      baseLr: "1.2e-4",
      unetLr: "1.2e-4",
      textEncoderLr: "4e-5",
      minSnrGamma: "5",
      keepTokens: 1,
      clipSkip: 2,
      seed: 0,
    },
  },
  {
    id: "sd15-dreambooth-style",
    label: "SD 1.x · DreamBooth Style",
    labelZh: "SD 1.x · DreamBooth 风格",
    description:
      "Full fine-tune approach with small dataset, high repeats, and strong LR.",
    descriptionZh:
      "小数据集全量微调思路：高重复次数、较强学习率。",
    script: "train_network.py",
    params: {
      ...SD15_BASE,
      networkDim: 128,
      networkAlpha: 128,
      batchSize: 2,
      epochs: 30,
      stepsPerEpoch: 100,
      datasetRepeats: 10,
      baseLr: "1e-4",
      unetLr: "1e-4",
      textEncoderLr: "5e-5",
      minSnrGamma: "",
      keepTokens: 1,
      clipSkip: 1,
      noiseOffset: "0",
      seed: 42,
    },
  },

  // ── SDXL ────────────────────────────────────────────────────────────────
  {
    id: "sdxl-character",
    label: "SDXL · Character LoRA",
    labelZh: "SDXL · 人物 LoRA",
    description:
      "Character LoRA for SDXL. Moderate rank, warm-up steps, minSNR.",
    descriptionZh:
      "SDXL 人物 LoRA：中等秩，带预热步数，minSNR 加权。",
    script: "sdxl_train_network.py",
    params: {
      ...SDXL_BASE,
      networkDim: 64,
      networkAlpha: 32,
      baseLr: "1e-4",
      unetLr: "1e-4",
      textEncoderLr: "5e-5",
      minSnrGamma: "5",
      keepTokens: 1,
      seed: 0,
    },
  },
  {
    id: "sdxl-style",
    label: "SDXL · Style / Artist LoRA",
    labelZh: "SDXL · 画风 / 画师 LoRA",
    description:
      "Art style LoRA for SDXL. Lower rank, tag dropout enabled.",
    descriptionZh:
      "SDXL 画风 / 画师 LoRA：低秩，启用标签 dropout。",
    script: "sdxl_train_network.py",
    params: {
      ...SDXL_BASE,
      networkDim: 32,
      networkAlpha: 16,
      baseLr: "8e-5",
      unetLr: "8e-5",
      textEncoderLr: "2e-5",
      minSnrGamma: "5",
      keepTokens: 0,
      captionTagDropoutRate: "0.1",
      seed: 0,
    },
  },
  {
    id: "sdxl-concept",
    label: "SDXL · Concept / Object LoRA",
    labelZh: "SDXL · 概念 / 物体 LoRA",
    description:
      "Object or concept LoRA optimised for SDXL resolution.",
    descriptionZh:
      "SDXL 分辨率下的物体 / 概念 LoRA 预设。",
    script: "sdxl_train_network.py",
    params: {
      ...SDXL_BASE,
      networkDim: 64,
      networkAlpha: 32,
      baseLr: "9e-5",
      unetLr: "9e-5",
      textEncoderLr: "3e-5",
      minSnrGamma: "5",
      keepTokens: 1,
      seed: 0,
    },
  },

  // ── Anima ────────────────────────────────────────────────────────────────
  {
    id: "anima-character",
    label: "Anima · Character LoRA",
    labelZh: "Anima · 动漫人物 LoRA",
    description:
      "Anime character LoRA for Anima. Low LR per official recommendation. LLM adapter frozen.",
    descriptionZh:
      "Anima 动漫人物 LoRA：按官方建议使用低学习率，LLM Adapter 已冻结。",
    script: "anima_train_network.py",
    params: {
      ...ANIMA_BASE,
      networkDim: 32,
      networkAlpha: 16,
      baseLr: "2e-5",
      unetLr: "2e-5",
      animaLlmAdapterLr: "0",
      keepTokens: 1,
      seed: 0,
    },
  },
  {
    id: "anima-style",
    label: "Anima · Style / Artist LoRA",
    labelZh: "Anima · 动漫画风 / 艺术家 LoRA",
    description:
      "Anime art style / artist LoRA for Anima. Very low rank & LR, tag dropout.",
    descriptionZh:
      "Anima 动漫画风 / 画师 LoRA：极低秩、极低学习率，启用标签 dropout。",
    script: "anima_train_network.py",
    params: {
      ...ANIMA_BASE,
      networkDim: 16,
      networkAlpha: 8,
      baseLr: "1e-5",
      unetLr: "1e-5",
      animaLlmAdapterLr: "0",
      keepTokens: 0,
      captionTagDropoutRate: "0.1",
      seed: 0,
    },
  },
];

/** Preset group labels shown in the UI select dropdown. */
export const PRESET_GROUPS: Array<{ label: string; labelZh: string; scriptMatch: string }> = [
  { label: "SD 1.x / 2.x", labelZh: "SD 1.x / 2.x", scriptMatch: "train_network.py" },
  { label: "SDXL", labelZh: "SDXL", scriptMatch: "sdxl_train_network.py" },
  { label: "Anima (anime)", labelZh: "Anima（动漫）", scriptMatch: "anima_train_network.py" },
];

/** PATH fields that are always preserved when a preset is applied. */
export const PRESERVED_PATH_KEYS: Array<keyof TrainingConfig> = [
  "pretrainedModel",
  "vae",
  "animaQwen3",
  "networkWeights",
  "resume",
];

/**
 * Merge a preset on top of the current config, preserving all path fields
 * and user-specific state (seed, initialEpoch, initialStep) from current.
 */
export function applyPreset(
  current: TrainingConfig,
  preset: TrainingPreset,
): TrainingConfig {
  const merged: TrainingConfig = {
    ...current,
    ...preset.params,
  };
  // Always keep the user's existing paths
  for (const key of PRESERVED_PATH_KEYS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (merged as any)[key] = current[key];
  }
  return merged;
}
