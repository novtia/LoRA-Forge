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
  stepsPerEpoch: number;
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
}

export interface TrainingEnvSettings {
  sdScriptsPath: string;
  pythonExecutable: string;
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

export interface DatasetEntry {
  relativePath: string;
  name: string;
  kind: DatasetEntryKind;
  depth: number;
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
