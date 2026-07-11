export type ProjectStatus =
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "error"
  | "interrupted"
  | "aborted";

export type JobStatus =
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "interrupted"
  | "aborted";

export interface ProjectRecord {
  id: string;
  name: string;
  rootPath: string;
  datasetPath: string;
  outputPath: string;
  status: ProjectStatus;
  tags: string[];
  sizeBytes: number;
  updatedAt: number;
}

export interface TrainingConfig {
  trainingScript: string;
  pretrainedModel: string;
  resolution: string;
  vae: string;
  /** Qwen3-0.6B path (HF dir or `.safetensors`). Required for `anima_train_network.py`. */
  animaQwen3: string;
  /** Maps to `--llm_adapter_lr`. Use `0` to freeze (recommended). Empty = omit (sd-scripts default). */
  animaLlmAdapterLr: string;
  clipSkip: number;
  networkDim: number;
  networkAlpha: number;
  convDim: number;
  convAlpha: number;
  networkDropout: string;
  batchSize: number;
  /** Mutually exclusive with epoch-based length: `steps` → `--max_train_steps`, `epochs` → `--max_train_epochs`. */
  trainingLengthMode: "steps" | "epochs";
  /** Optimizer steps cap when `trainingLengthMode === "steps"`. */
  maxTrainSteps: number;
  epochs: number;
  saveEveryNEpochs: number;
  mixedPrecision: string;
  savePrecision: string;
  optimizer: string;
  optimizerArgs: string;
  lrScheduler: string;
  lrSchedulerNumCycles: string;
  lrSchedulerPower: string;
  baseLr: string;
  unetLr: string;
  textEncoderLr: string;
  lrWarmupSteps: number;
  minSnrGamma: string;
  noiseOffset: string;
  maxGradNorm: string;
  seed: number;
  keepTokens: number;
  captionDropoutRate: string;
  captionTagDropoutRate: string;
  datasetRepeats: number;
  enableBucket: boolean;
  minBucketReso: number;
  maxBucketReso: number;
  bucketResoSteps: number;
  cacheLatents: boolean;
  cacheLatentsToDisk: boolean;
  maxDataLoaderWorkers: number;
  persistentDataLoaderWorkers: boolean;
  gradientCheckpointing: boolean;
  xformers: boolean;
  shuffleCaptions: boolean;
  colorJitter: boolean;
  saveEveryNSteps: number;
  saveLastNEpochs: number;
  saveLastNSteps: number;
  sampleEveryNSteps: number;
  sampleAtFirst: boolean;
  sampleEveryNEpochs: number;
  samplePrompts: string;
  sampleNegativePrompt: string;
  sampleWidth: number;
  sampleHeight: number;
  sampleSteps: number;
  sampleCfgScale: string;
  sampleSeed: number;
  sampleSampler: string;
  networkWeights: string;
  resume: string;
  initialEpoch: number;
  initialStep: number;
  v2: boolean;
  vParameterization: boolean;
  tokenizerCacheDir: string;
  networkModule: string;
  networkArgs: string;
  networkTrainUnetOnly: boolean;
  networkTrainTextEncoderOnly: boolean;
  dimFromWeights: boolean;
  scaleWeightNorms: string;
  baseWeights: string;
  baseWeightsMultiplier: string;
  trainingComment: string;
  noMetadata: boolean;
  saveModelAs: string;
  gradientAccumulationSteps: number;
  fullFp16: boolean;
  fullBf16: boolean;
  fp8Base: boolean;
  fp8BaseUnet: boolean;
  memEffAttn: boolean;
  sdpa: boolean;
  torchCompile: boolean;
  dynamoBackend: string;
  lowram: boolean;
  highvram: boolean;
  noHalfVae: boolean;
  cpuOffloadCheckpointing: boolean;
  cacheTextEncoderOutputs: boolean;
  cacheTextEncoderOutputsToDisk: boolean;
  textEncoderBatchSize: number;
  disableMmapLoadSafetensors: boolean;
  blocksToSwap: number;
  fusedBackwardPass: boolean;
  lrSchedulerType: string;
  lrSchedulerArgs: string;
  lrDecaySteps: string;
  lrSchedulerTimescale: string;
  lrSchedulerMinLrRatio: string;
  saveNEpochRatio: number;
  saveLastNEpochsState: number;
  saveLastNStepsState: number;
  saveState: boolean;
  saveStateOnTrainEnd: boolean;
  skipUntilInitialStep: boolean;
  maxTokenLength: number;
  noiseOffsetRandomStrength: boolean;
  multiresNoiseIterations: number;
  multiresNoiseDiscount: string;
  ipNoiseGamma: string;
  ipNoiseGammaRandomStrength: boolean;
  adaptiveNoiseScale: string;
  zeroTerminalSnr: boolean;
  minTimestep: number;
  maxTimestep: number;
  lossType: string;
  huberSchedule: string;
  huberC: string;
  huberScale: string;
  priorLossWeight: string;
  maskedLoss: boolean;
  conditioningDataDir: string;
  captionSeparator: string;
  keepTokensSeparator: string;
  secondarySeparator: string;
  enableWildcard: boolean;
  captionPrefix: string;
  captionSuffix: string;
  flipAug: boolean;
  faceCropAugRange: string;
  randomCrop: boolean;
  vaeBatchSize: number;
  skipCacheCheck: boolean;
  skipImageResolution: string;
  bucketNoUpscale: boolean;
  resizeInterpolation: string;
  tokenWarmupMin: number;
  tokenWarmupStep: string;
  alphaMask: boolean;
  trainInpainting: boolean;
  captionDropoutEveryNEpochs: number;
  weightingScheme: string;
  logitMean: string;
  logitStd: string;
  modeScale: string;
  validationSeed: number;
  validationSplit: string;
  validateEveryNSteps: number;
  validateEveryNEpochs: number;
  maxValidationSteps: number;
  logWith: string;
  loggingDir: string;
  logPrefix: string;
  logTrackerName: string;
  wandbRunName: string;
  wandbApiKey: string;
  logConfig: boolean;
}

export interface TrainingEnvSettings {
  sdScriptsPath: string;
  pythonExecutable: string;
  wslDistro: string;
  diffusionPipeWslPath: string;
  diffusionPipeVenvPath: string;
  numGpus: number;
}

/** Where a training repo lives: native Windows git vs WSL bash git. */
export type TrainingRepoTarget = "windows" | "wsl";

export interface TrainingRepoStatus {
  id: string;
  name: string;
  description: string;
  target: TrainingRepoTarget;
  gitUrl: string;
  installPath: string;
  installed: boolean;
  currentBranch: string | null;
  currentCommit: string | null;
  isCustom: boolean;
}

export interface CustomRepoInput {
  name: string;
  gitUrl: string;
  target: TrainingRepoTarget;
  installPath: string;
}

export type RepoTaskKind = "download" | "update" | "delete";
export type RepoTaskStatus = "running" | "completed" | "failed";

export interface RepoTaskLogEvent {
  repoId: string;
  taskId: string;
  line: string;
  level: string;
}

export interface RepoTaskStateEvent {
  repoId: string;
  taskId: string;
  kind: RepoTaskKind;
  status: RepoTaskStatus;
  message: string | null;
}

export interface PythonRuntime {
  label: string;
  version: string;
  path: string;
  /** `windows` | `wsl`. */
  source: string;
}

export interface WslDistroInfo {
  name: string;
  state: string;
  version: string;
  isDefault: boolean;
}

export interface CudaInfo {
  available: boolean;
  driverVersion: string;
  cudaVersion: string;
  gpuName: string;
  nvccVersion: string;
}

export interface DiskInfo {
  name: string;
  usedGb: number;
  totalGb: number;
  freeGb: number;
}

export interface EnvironmentReport {
  pythons: PythonRuntime[];
  wslDistros: WslDistroInfo[];
  gitVersion: string;
  cuda: CudaInfo;
  disks: DiskInfo[];
  detectedAt: number;
}

export interface DiffusionPipeConfig {
  modelType: string;
  modelPath: string;
  transformerPath: string;
  vaePath: string;
  llmPath: string;
  clipPath: string;
  modelDtype: string;
  transformerDtype: string;
  timestepSampleMethod: string;
  adapterType: string;
  loraRank: number;
  loraDtype: string;
  optimizerType: string;
  lr: string;
  weightDecay: string;
  epochs: number;
  maxSteps: number;
  microBatchSizePerGpu: number;
  gradientAccumulationSteps: number;
  gradientClipping: string;
  warmupSteps: number;
  activationCheckpointing: string;
  blocksToSwap: number;
  saveDtype: string;
  saveEveryNEpochs: number;
  saveEveryNSteps: number;
  evalEveryNEpochs: number;
  checkpointEveryNMinutes: number;
  datasetResolutions: string;
  enableArBucket: boolean;
  numArBuckets: number;
  frameBuckets: string;
  numRepeats: number;
  resumeFromCheckpoint: string;
  ncclDisable: boolean;
  stepsPerPrint: number;
  imageMicroBatchSizePerGpu: number;
  forceConstantLr: string;
  lrScheduler: string;
  pseudoHuberC: string;
  evalEveryNSteps: number;
  evalEveryNExamples: number;
  evalBeforeFirstStep: boolean;
  evalMicroBatchSizePerGpu: number;
  imageEvalMicroBatchSizePerGpu: number;
  evalGradientAccumulationSteps: number;
  disableBlockSwapForEval: boolean;
  saveEveryNExamples: number;
  checkpointEveryNEpochs: number;
  reentrantActivationCheckpointing: boolean;
  compile: boolean;
  videoClipMode: string;
  xAxisExamples: boolean;
  uncondFraction: string;
  loggingSteps: number;
  adapterInitFromExisting: string;
  adapterDropout: string;
  lokrDecomposeFactor: number;
  lokrRankDropout: string;
  optimizerBetas: string;
  optimizerEps: string;
  optimizerStabilize: boolean;
  optimizerGradientRelease: boolean;
  optimizerArgs: string;
  enableWandb: boolean;
  wandbApiKey: string;
  wandbTrackerName: string;
  wandbRunName: string;
  minAr: string;
  maxAr: string;
  arBuckets: string;
  cacheShuffleNum: number;
  cacheShuffleDelimiter: string;
  skipEmptyCaption: boolean;
  maskPath: string;
  modelGuidance: string;
  sigmoidScale: string;
  diffusionModelDtype: string;
  regenerateCache: boolean;
  trustCache: boolean;
  resetDataloader: boolean;
  resetOptimizer: boolean;
  resetOptimizerParams: boolean;
}

export interface TrainingConfigPreview {
  mainToml: string;
  datasetToml: string;
  command: string;
}

/**
 * Upstream protocol dialect. `auto` sniffs from `endpointUrl` (openrouter.ai → openRouter,
 * api.anthropic.com → anthropicCompat, otherwise → openAi).
 */
export type LlmEndpointKind = "auto" | "openAi" | "openRouter" | "anthropicCompat";

/**
 * Reasoning effort dial for thinking-capable models. `default` = let the backend pick a sensible
 * fallback (typically `high` on thinking models). `none` = explicitly disable thinking when the
 * provider supports it.
 */
export type LlmReasoningEffort =
  | "default"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "none";

/**
 * How prior assistant captions are injected when iterating through a dataset:
 *  - `injectAsConversation` (default): synthesize a legal multi-turn dialogue
 *    `user(prompt text only) → assistant(prior caption) → user(current image + prompt)`. The
 *    prior `user` turn does **not** re-attach the previous image — that keeps the token / safety
 *    budget low and avoids re-triggering content-safety reviews of the prior image (which on
 *    NSFW LoRA datasets causes thinking models like Gemini to burn all tokens on reasoning and
 *    return PROHIBITED_CONTENT).
 *  - `injectAsAssistant`: legacy — push the previous caption as a bare assistant turn before the
 *    current user message (structurally invalid but tolerated by many providers).
 *  - `injectAsUserExample`: embed the previous caption inside the current user message under a
 *    clear "do not copy" reference label.
 *  - `off`: never reuse the previous caption.
 */
export type LlmPriorCaptionMode =
  | "off"
  | "injectAsConversation"
  | "injectAsAssistant"
  | "injectAsUserExample";

/** Single-image LLM tagging interaction mode. */
export type CaptionTagMode = "direct" | "conversationModify";

export type LlmModelSource = "manual" | "fetched";

export interface LlmProviderModelEntry {
  id: string;
  modelId: string;
  label?: string | null;
  source?: LlmModelSource;
}

export interface LlmProviderSummary {
  id: string;
  name: string;
  endpointUrl: string;
  endpointKind: LlmEndpointKind;
  models: LlmProviderModelEntry[];
  hasApiKey: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface LlmProvider extends Omit<LlmProviderSummary, "hasApiKey"> {
  apiKey: string;
}

export interface LlmGlobalSettings {
  activeProviderId: string;
  activeModelId: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  captionRetryMax: number;
  thinkingEnabled: boolean;
  maxCompletionTokens?: number;
  reasoningBudget?: number;
  reasoningEffort?: LlmReasoningEffort;
  priorCaptionMode?: LlmPriorCaptionMode;
  systemPromptPresetId?: string;
  textOnlyModelIds?: string[];
}

export interface LlmSettings {
  endpointUrl: string;
  apiKey: string;
  modelId: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  /** Extra attempts after the first failed LLM caption (0 = no retry). Max 20. */
  captionRetryMax: number;
  /**
   * Sent as `thinking.type` on chat/completions: `"enabled"` vs `"disabled"`.
   * Providers that ignore unknown fields are unaffected.
   */
  thinkingEnabled: boolean;
  /** Override the auto-sniffed upstream protocol dialect. */
  endpointKind?: LlmEndpointKind;
  /**
   * OpenAI o-series / GPT-5 use `max_completion_tokens` instead of `max_tokens` for the visible
   * output budget. `0` = omit (fall back to `maxTokens`).
   */
  maxCompletionTokens?: number;
  /**
   * Thinking-token budget. Maps to Anthropic `thinking.budget_tokens` or OpenRouter
   * `reasoning.max_tokens`. `0` = no explicit budget.
   */
  reasoningBudget?: number;
  /** Reasoning effort dial; `default` lets the backend choose. */
  reasoningEffort?: LlmReasoningEffort;
  /** Prior-caption injection strategy; defaults to `off`. */
  priorCaptionMode?: LlmPriorCaptionMode;
  /** Selected system-prompt preset row id (builtin/custom/ad-hoc). */
  systemPromptPresetId?: string;
  /** Active LLM provider id (effective settings). */
  activeProviderId?: string;
  /** Models that rejected image input; matched by modelId string. */
  textOnlyModelIds?: string[];
}

/** Baidu FanYi / translate open platform (stored locally in app DB). */
export interface BaiduTranslateSettings {
  appId: string;
  secretKey: string;
}

/** Backend outbound API diary (LLM, Baidu translate, …). */
export interface ApiLogEntry {
  createdAt: number;
  source: string;
  level: string;
  message: string;
}

export interface TrainingSnapshot {
  epoch: number;
  epochTotal: number;
  step: number;
  stepTotal: number;
  loss: number;
  lr: number;
  runtimeSeconds: number;
  pid: number | null;
  status: JobStatus;
}

export interface TrainingLogLine {
  seq: number;
  stream: string;
  level: "info" | "warn" | "success" | string;
  channel?: "rich" | "raw";
  kind?: string | null;
  stage?: string | null;
  code?: string | null;
  message?: string | null;
  metrics?: Record<string, string | number | boolean | null> | null;
  rawLine?: string | null;
  line: string;
  createdAt: number;
}

export interface LossPoint {
  step: number;
  loss: number;
}

export interface ActiveJobSummary {
  jobId: string;
  projectId: string;
  projectName: string;
  checkpointName: string;
  status: JobStatus;
  pid: number | null;
  runtimeSeconds: number;
  epoch: number;
  epochTotal: number;
  step: number;
  stepTotal: number;
  loss: number;
  lr: number;
  recentLogs: TrainingLogLine[];
  history: LossPoint[];
}

export interface SystemStats {
  cpuPercent: number;
  memoryUsedGb: number;
  memoryTotalGb: number;
  gpuName: string;
  gpuTempC: number;
  gpuUtilPercent: number;
  vramUsedGb: number;
  vramTotalGb: number;
}

export type DatasetEntryKind = "directory" | "image" | "file";

/** Logical role of a directory group. `"reg"` = regularization dataset (is_reg=true in sd-scripts). */
export type DatasetGroupType = "normal" | "reg";

export interface DatasetEntry {
  relativePath: string;
  name: string;
  kind: DatasetEntryKind;
  depth: number;
  /** Only present for `"directory"` kind entries. Omitted when `"normal"` (default). */
  groupType?: DatasetGroupType;
}

export interface DatasetAsset {
  relativePath: string;
  name: string;
  filePath: string;
  caption: string;
  width: number | null;
  height: number | null;
}

export interface DatasetPreviewAsset {
  relativePath: string;
  name: string;
  filePath: string;
}

export interface DatasetImagePathMapping {
  oldRelativePath: string;
  newRelativePath: string;
}

export interface BatchDatasetImageMutationResult {
  entries: DatasetEntry[];
  pathMappings: DatasetImagePathMapping[];
}

export interface SampleImageEntry {
  relativePath: string;
  name: string;
  filePath: string;
  depth: number;
  modifiedAt: number;
}

export interface TrainingProgressEvent {
  projectId: string;
  jobId: string;
  snapshot: TrainingSnapshot;
}

export interface TrainingLogEvent {
  projectId: string;
  jobId: string;
  entry: TrainingLogLine;
}

export interface TrainingStateChangedEvent {
  projectId: string;
  jobId: string;
  status: JobStatus;
}
