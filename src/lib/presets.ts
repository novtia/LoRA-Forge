import type { TrainingConfig } from "./types";

export interface TrainingPreset {
  id: string;
  label: string;
  labelZh: string;
  description: string;
  descriptionZh: string;
  /** Which training script this preset targets. */
  script: string;
  /** Merged onto the current session with `{ ...current, ...params }`.
   *  Built-in catalogue entries omit path fields so your open project keeps its model/VAE/etc.
   *  User presets store a **full snapshot** including all path fields so they restore exactly what was saved. */
  params: Partial<TrainingConfig>;
}

// ─── shared base layers ──────────────────────────────────────────────────────

const COMMON_BASE: Partial<TrainingConfig> = {
  optimizer: "AdamW8bit",
  optimizerArgs: "",
  lrScheduler: "cosine_with_restarts",
  lrSchedulerNumCycles: "3",
  lrSchedulerPower: "",
  lrWarmupSteps: 0,
  mixedPrecision: "bf16",
  savePrecision: "fp16",
  saveEveryNEpochs: 2,
  saveEveryNSteps: 0,
  saveLastNEpochs: 0,
  saveLastNSteps: 0,
  initialEpoch: 0,
  initialStep: 0,
  gradientCheckpointing: true,
  cacheLatents: true,
  cacheLatentsToDisk: false,
  enableBucket: true,
  datasetRepeats: 1,
  shuffleCaptions: true,
  colorJitter: false,
  captionDropoutRate: "0",
  captionTagDropoutRate: "0",
  networkDropout: "0",
  convDim: 0,
  convAlpha: 0,
  maxGradNorm: "1",
  maxDataLoaderWorkers: 2,
  persistentDataLoaderWorkers: false,
  seed: 0,
};

const SD15_BASE: Partial<TrainingConfig> = {
  ...COMMON_BASE,
  trainingScript: "train_network.py",
  resolution: "512x512",
  batchSize: 4,
  epochs: 16,
  stepsPerEpoch: 250,
  xformers: true,
  minBucketReso: 256,
  maxBucketReso: 768,
  bucketResoSteps: 64,
  clipSkip: 2,
  minSnrGamma: "5",
  noiseOffset: "0.05",
};

const SDXL_BASE: Partial<TrainingConfig> = {
  ...COMMON_BASE,
  trainingScript: "sdxl_train_network.py",
  resolution: "1024x1024",
  batchSize: 1,
  epochs: 16,
  stepsPerEpoch: 250,
  lrWarmupSteps: 50,
  xformers: false,
  minBucketReso: 512,
  maxBucketReso: 2048,
  bucketResoSteps: 32,
  clipSkip: 0,
  minSnrGamma: "5",
  noiseOffset: "0",
};

const ANIMA_BASE: Partial<TrainingConfig> = {
  ...COMMON_BASE,
  trainingScript: "anima_train_network.py",
  resolution: "1024x1024",
  batchSize: 1,
  epochs: 14,
  stepsPerEpoch: 250,
  xformers: false,
  minBucketReso: 512,
  maxBucketReso: 2048,
  bucketResoSteps: 32,
  minSnrGamma: "",
  noiseOffset: "0",
  textEncoderLr: "",
  animaLlmAdapterLr: "0",
};

// ─── default preset catalogue ─────────────────────────────────────────────────

export const DEFAULT_PRESETS: TrainingPreset[] = [
  // ── SD 1.x / 2.x ────────────────────────────────────────────────────────
  {
    id: "sd15-character-balanced",
    label: "SD 1.x · Character / Identity (Balanced)",
    labelZh: "SD 1.x · 人物 / 身份（均衡）",
    description:
      "Production-safe character LoRA for 15-80 curated images. Trains text encoder lightly, keeps the trigger token stable, and uses minSNR to reduce noisy low-value steps.",
    descriptionZh:
      "适合 15-80 张精选图的人物 LoRA：轻训文本编码器、保留触发词，并用 minSNR 降低低价值噪声步影响。",
    script: "train_network.py",
    params: {
      ...SD15_BASE,
      networkDim: 128,
      networkAlpha: 64,
      baseLr: "1e-4",
      unetLr: "1e-4",
      textEncoderLr: "5e-5",
      keepTokens: 1,
      captionTagDropoutRate: "0.03",
    },
  },
  {
    id: "sd15-character-small-dataset",
    label: "SD 1.x · Character / Small Dataset",
    labelZh: "SD 1.x · 人物 / 小数据集",
    description:
      "Conservative identity preset for 8-25 images. Lower LR, batch 2, mild network dropout, and more epochs help avoid burning small datasets.",
    descriptionZh:
      "适合 8-25 张图的小数据集人物：更低学习率、batch 2、轻微 network dropout 和更长训练，降低过拟合与烧图风险。",
    script: "train_network.py",
    params: {
      ...SD15_BASE,
      batchSize: 2,
      epochs: 24,
      stepsPerEpoch: 160,
      networkDim: 96,
      networkAlpha: 64,
      baseLr: "8e-5",
      unetLr: "8e-5",
      textEncoderLr: "2e-5",
      keepTokens: 2,
      networkDropout: "0.05",
      captionTagDropoutRate: "0.05",
    },
  },
  {
    id: "sd15-style-artist",
    label: "SD 1.x · Style / Artist",
    labelZh: "SD 1.x · 画风 / 画师",
    description:
      "Style-focused LoRA for consistent aesthetics. Freezes text encoder, uses lower rank, and adds tag dropout so the style transfers beyond the training captions.",
    descriptionZh:
      "面向稳定画风迁移：冻结文本编码器、较低 rank，并加入标签 dropout，让风格不被训练标签锁死。",
    script: "train_network.py",
    params: {
      ...SD15_BASE,
      epochs: 14,
      stepsPerEpoch: 300,
      networkDim: 64,
      networkAlpha: 32,
      baseLr: "8e-5",
      unetLr: "8e-5",
      textEncoderLr: "0",
      keepTokens: 0,
      captionDropoutRate: "0.05",
      captionTagDropoutRate: "0.15",
      networkDropout: "0.03",
    },
  },
  {
    id: "sd15-concept-clothing-object",
    label: "SD 1.x · Concept / Outfit / Object",
    labelZh: "SD 1.x · 概念 / 服饰 / 物体",
    description:
      "General concept preset for outfits, props, products, poses, and recurring visual motifs. Balanced rank with a small text encoder LR for reliable trigger binding.",
    descriptionZh:
      "适合服装、道具、产品、姿势和视觉元素：中等 rank，少量训练文本编码器，让触发词绑定更稳定。",
    script: "train_network.py",
    params: {
      ...SD15_BASE,
      epochs: 16,
      stepsPerEpoch: 260,
      networkDim: 64,
      networkAlpha: 64,
      baseLr: "1e-4",
      unetLr: "1e-4",
      textEncoderLr: "3e-5",
      keepTokens: 1,
      captionTagDropoutRate: "0.05",
    },
  },
  {
    id: "sd15-detail-quality-tuning",
    label: "SD 1.x · Detail / Quality Adapter",
    labelZh: "SD 1.x · 细节 / 质感适配",
    description:
      "Low-rank tuning for line quality, lighting, rendering texture, or dataset-wide polish. Keeps LR low and freezes text encoder to avoid changing prompt semantics.",
    descriptionZh:
      "用于线条、光影、质感和整体精修：低 rank、低学习率、冻结文本编码器，避免改变提示词语义。",
    script: "train_network.py",
    params: {
      ...SD15_BASE,
      epochs: 10,
      stepsPerEpoch: 300,
      networkDim: 32,
      networkAlpha: 16,
      baseLr: "5e-5",
      unetLr: "5e-5",
      textEncoderLr: "0",
      keepTokens: 0,
      captionDropoutRate: "0.03",
      captionTagDropoutRate: "0.1",
      networkDropout: "0.08",
      noiseOffset: "0",
    },
  },

  // ── SDXL ────────────────────────────────────────────────────────────────
  {
    id: "sdxl-character-balanced",
    label: "SDXL · Character / Identity (Balanced)",
    labelZh: "SDXL · 人物 / 身份（均衡）",
    description:
      "SDXL character LoRA for high-resolution datasets. Uses rank 64, low text encoder LR, warmup, and minSNR for stable identity learning.",
    descriptionZh:
      "SDXL 高清人物 LoRA：rank 64、低文本编码器学习率、预热步数与 minSNR，兼顾身份稳定和画面质量。",
    script: "sdxl_train_network.py",
    params: {
      ...SDXL_BASE,
      epochs: 18,
      stepsPerEpoch: 240,
      networkDim: 64,
      networkAlpha: 32,
      baseLr: "8e-5",
      unetLr: "8e-5",
      textEncoderLr: "2e-5",
      keepTokens: 1,
      captionTagDropoutRate: "0.03",
    },
  },
  {
    id: "sdxl-style-artist",
    label: "SDXL · Style / Artist",
    labelZh: "SDXL · 画风 / 画师",
    description:
      "Style preset for SDXL. Lower rank and frozen text encoder preserve prompt understanding while capturing composition, palette, and rendering habits.",
    descriptionZh:
      "SDXL 画风预设：低 rank 且冻结文本编码器，保留原模型提示词理解，同时学习构图、配色和渲染习惯。",
    script: "sdxl_train_network.py",
    params: {
      ...SDXL_BASE,
      epochs: 14,
      stepsPerEpoch: 280,
      networkDim: 32,
      networkAlpha: 16,
      baseLr: "6e-5",
      unetLr: "6e-5",
      textEncoderLr: "0",
      keepTokens: 0,
      captionDropoutRate: "0.05",
      captionTagDropoutRate: "0.15",
      networkDropout: "0.05",
    },
  },
  {
    id: "sdxl-concept-product",
    label: "SDXL · Concept / Product / Outfit",
    labelZh: "SDXL · 概念 / 产品 / 服饰",
    description:
      "For a concrete object, costume, prop, product design, or repeatable motif. Balanced rank and very light text encoder training improve trigger reliability.",
    descriptionZh:
      "用于具体物体、服装、道具、产品设计或可复现元素：中等 rank，极轻文本编码器学习以提高触发可靠性。",
    script: "sdxl_train_network.py",
    params: {
      ...SDXL_BASE,
      epochs: 16,
      stepsPerEpoch: 250,
      networkDim: 64,
      networkAlpha: 32,
      baseLr: "7e-5",
      unetLr: "7e-5",
      textEncoderLr: "1e-5",
      keepTokens: 1,
      captionTagDropoutRate: "0.05",
    },
  },
  {
    id: "sdxl-detail-quality-tuning",
    label: "SDXL · Detail / Aesthetic Adapter",
    labelZh: "SDXL · 细节 / 审美适配",
    description:
      "A subtle adapter for texture, lighting, line quality, or a dataset-wide finishing pass. Very low rank/LR and frozen text encoder keep it composable.",
    descriptionZh:
      "轻量细节与审美适配：极低 rank / 学习率，冻结文本编码器，适合与其他 LoRA 叠加使用。",
    script: "sdxl_train_network.py",
    params: {
      ...SDXL_BASE,
      epochs: 10,
      stepsPerEpoch: 300,
      networkDim: 16,
      networkAlpha: 8,
      baseLr: "4e-5",
      unetLr: "4e-5",
      textEncoderLr: "0",
      keepTokens: 0,
      captionDropoutRate: "0.03",
      captionTagDropoutRate: "0.1",
      networkDropout: "0.08",
    },
  },

  // ── Anima ────────────────────────────────────────────────────────────────
  {
    id: "anima-character-balanced",
    label: "Anima · Anime Character / Identity",
    labelZh: "Anima · 动漫人物 / 身份",
    description:
      "Character LoRA for Anima Preview. Follows the model author's low-LR guidance, freezes the LLM adapter, and uses rank 32 for identity capacity.",
    descriptionZh:
      "Anima Preview 人物 LoRA：遵循作者低学习率建议，冻结 LLM Adapter，使用 rank 32 保留足够身份容量。",
    script: "anima_train_network.py",
    params: {
      ...ANIMA_BASE,
      epochs: 16,
      stepsPerEpoch: 240,
      networkDim: 32,
      networkAlpha: 16,
      baseLr: "2e-5",
      unetLr: "2e-5",
      keepTokens: 1,
      captionTagDropoutRate: "0.03",
      animaLlmAdapterLr: "0",
    },
  },
  {
    id: "anima-style-artist",
    label: "Anima · Anime Style / Artist",
    labelZh: "Anima · 动漫画风 / 画师",
    description:
      "Only for Anima (anime DiT). Style LoRA tuned like strong diffusion-pipe runs: rank 32, LR 2e-5, 100 warmup steps, frozen LLM adapter, caption/tag dropout — do not reuse these numbers for SD 1.x or SDXL.",
    descriptionZh:
      "仅适用于 Anima 等动漫 DiT 模型。画风 LoRA 对齐成熟 diffusion-pipe 类训练：rank 32、2e-5、预热 100 步、冻结 LLM Adapter、caption/tag dropout；勿将此类参数照搬到 SD 1.x / SDXL。",
    script: "anima_train_network.py",
    params: {
      ...ANIMA_BASE,
      epochs: 14,
      stepsPerEpoch: 280,
      networkDim: 32,
      networkAlpha: 16,
      baseLr: "2e-5",
      unetLr: "2e-5",
      lrWarmupSteps: 100,
      keepTokens: 0,
      captionDropoutRate: "0.05",
      captionTagDropoutRate: "0.12",
      networkDropout: "0.05",
      animaLlmAdapterLr: "0",
    },
  },
  {
    id: "anima-concept-outfit-prop",
    label: "Anima · Outfit / Prop / Concept",
    labelZh: "Anima · 服饰 / 道具 / 概念",
    description:
      "For anime outfits, accessories, props, and repeatable visual concepts. Rank 24 and very low LR balance learnability with Anima's sensitive adapter stack.",
    descriptionZh:
      "用于动漫服饰、配件、道具和可复现概念：rank 24 与极低学习率兼顾可学习性和 Anima 适配器栈稳定性。",
    script: "anima_train_network.py",
    params: {
      ...ANIMA_BASE,
      epochs: 15,
      stepsPerEpoch: 250,
      networkDim: 24,
      networkAlpha: 12,
      baseLr: "1.5e-5",
      unetLr: "1.5e-5",
      keepTokens: 1,
      captionTagDropoutRate: "0.05",
      animaLlmAdapterLr: "0",
    },
  },
  {
    id: "anima-detail-aesthetic",
    label: "Anima · Linework / Aesthetic Polish",
    labelZh: "Anima · 线条 / 审美微调",
    description:
      "A minimal Anima adapter for linework, color taste, cel-shading, or finishing polish. Very low rank/LR keeps the adapter stack composable.",
    descriptionZh:
      "Anima 线条、配色、赛璐璐质感与审美微调：极低 rank / 学习率，适合做可叠加的轻量适配器。",
    script: "anima_train_network.py",
    params: {
      ...ANIMA_BASE,
      epochs: 10,
      stepsPerEpoch: 300,
      networkDim: 8,
      networkAlpha: 4,
      baseLr: "8e-6",
      unetLr: "8e-6",
      keepTokens: 0,
      captionDropoutRate: "0.03",
      captionTagDropoutRate: "0.08",
      networkDropout: "0.08",
      animaLlmAdapterLr: "0",
    },
  },
];

/** Preset group labels shown in the UI select dropdown. */
export const PRESET_GROUPS: Array<{ label: string; labelZh: string; scriptMatch: string }> = [
  { label: "SD 1.x / 2.x", labelZh: "SD 1.x / 2.x", scriptMatch: "train_network.py" },
  { label: "SDXL", labelZh: "SDXL", scriptMatch: "sdxl_train_network.py" },
  { label: "Anima (anime)", labelZh: "Anima（动漫）", scriptMatch: "anima_train_network.py" },
];

/**
 * Merge a preset on top of the current config.
 * Built-in presets do not specify path keys, so unchanged fields (including paths) carry over from `current`.
 * Custom presets embed a full snapshot, so applying them also restores saved model/VAE/Qwen/network/resume paths.
 */
export function applyPreset(
  current: TrainingConfig,
  preset: TrainingPreset,
): TrainingConfig {
  return {
    ...current,
    ...preset.params,
  };
}

const CUSTOM_PRESET_STORAGE_KEY = "lora-forge.customTrainingPresets";

/** Full training snapshot for user presets (every field, including all path strings). */
export function configToPresetParams(config: TrainingConfig): Partial<TrainingConfig> {
  return { ...config };
}

export function createUserTrainingPreset(name: string, config: TrainingConfig): TrainingPreset {
  const trimmed = name.trim();
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    label: trimmed,
    labelZh: trimmed,
    description: "User-saved preset.",
    descriptionZh: "用户保存的预设。",
    script: config.trainingScript,
    params: configToPresetParams(config),
  };
}

export function loadCustomPresetsFromStorage(): TrainingPreset[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_PRESET_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is TrainingPreset => {
      if (!p || typeof p !== "object") return false;
      const id = (p as TrainingPreset).id;
      return typeof id === "string" && id.startsWith("custom-") && (p as TrainingPreset).params != null;
    });
  } catch {
    return [];
  }
}

export function saveCustomPresetsToStorage(presets: TrainingPreset[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(CUSTOM_PRESET_STORAGE_KEY, JSON.stringify(presets));
}
