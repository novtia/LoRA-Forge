import type { TranslateFn, TranslationParams } from "./i18n";
import type { ActiveJobSummary, TrainingLogLine } from "./types";

type MetricValue = string | number | boolean | null | undefined;

export interface TrainingMetricChip {
  key: string;
  label: string;
  value: string;
}

const DISPLAY_METRIC_KEYS = [
  "epoch",
  "step",
  "loss",
  "lr",
  "trainImages",
  "validationImages",
  "regImages",
  "optimizer",
  "lrScheduler",
  "networkModule",
  "networkDim",
  "networkAlpha",
  "modelVersion",
  "mixedPrecision",
  "resolution",
  "seed",
  "batchSize",
  "outputName",
  "checkpoint",
  "errorType",
  "cacheLatents",
  "cacheToDisk",
] as const;

const METRIC_LABEL_KEYS: Record<string, string> = {
  epoch: "training.metric.epoch",
  step: "training.metric.step",
  loss: "training.metric.loss",
  lr: "training.metric.lr",
  trainImages: "training.metric.trainImages",
  validationImages: "training.metric.validationImages",
  regImages: "training.metric.regImages",
  optimizer: "training.metric.optimizer",
  lrScheduler: "training.metric.lrScheduler",
  networkModule: "training.metric.networkModule",
  networkDim: "training.metric.networkDim",
  networkAlpha: "training.metric.networkAlpha",
  modelVersion: "training.metric.modelVersion",
  mixedPrecision: "training.metric.mixedPrecision",
  resolution: "training.metric.resolution",
  seed: "training.metric.seed",
  batchSize: "training.metric.batchSize",
  outputName: "training.metric.outputName",
  checkpoint: "training.metric.checkpoint",
  errorType: "training.metric.errorType",
  cacheLatents: "training.metric.cacheLatents",
  cacheToDisk: "training.metric.cacheToDisk",
};

function logIdentity(log: TrainingLogLine) {
  return `${log.seq}:${log.createdAt}:${log.stream}`;
}

export function dedupeTrainingLogs(logs: TrainingLogLine[]) {
  const seen = new Set<string>();
  return logs.filter((log) => {
    const identity = logIdentity(log);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function appendTrainingLog(
  logs: TrainingLogLine[],
  entry: TrainingLogLine,
  maxSize: number,
) {
  const identity = logIdentity(entry);
  if (logs.some((log) => logIdentity(log) === identity)) {
    return logs;
  }

  return [...logs.slice(-(maxSize - 1)), entry];
}

export function isRichTrainingLog(log: TrainingLogLine) {
  if (log.channel === "rich") return true;
  return Boolean(log.kind || log.stage || log.code);
}

export function isRawTrainingLog(log: TrainingLogLine) {
  return !isRichTrainingLog(log);
}

export function splitTrainingLogs(logs: TrainingLogLine[]) {
  const rich: TrainingLogLine[] = [];
  const raw: TrainingLogLine[] = [];

  logs.forEach((log) => {
    if (isRichTrainingLog(log)) {
      rich.push(log);
      return;
    }
    raw.push(log);
  });

  return { rich, raw };
}

export function selectPrimaryTrainingLogs(logs: TrainingLogLine[], limit: number) {
  const { rich, raw } = splitTrainingLogs(logs);
  const preferred = rich.length > 0 ? rich : raw;
  return preferred.slice(-limit);
}

function metricMap(log: TrainingLogLine) {
  return log.metrics ?? null;
}

function isFiniteNumber(value: MetricValue) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatMetricValue(t: TranslateFn, key: string, value: MetricValue, metrics: NonNullable<TrainingLogLine["metrics"]>) {
  if (value === null || value === undefined) {
    return null;
  }

  if (key === "epoch") {
    const current = isFiniteNumber(value);
    if (current === null) return null;
    const total = isFiniteNumber(metrics.epochTotal);
    return total !== null ? `${current}/${total}` : String(current);
  }

  if (key === "step") {
    const current = isFiniteNumber(value);
    if (current === null) return null;
    const total = isFiniteNumber(metrics.stepTotal);
    const formattedCurrent = current.toLocaleString();
    return total !== null ? `${formattedCurrent}/${total.toLocaleString()}` : formattedCurrent;
  }

  if (key === "loss") {
    const numeric = isFiniteNumber(value);
    return numeric === null ? null : numeric.toFixed(4);
  }

  if (key === "lr") {
    const numeric = isFiniteNumber(value);
    return numeric === null ? null : numeric.toExponential(2);
  }

  if (typeof value === "boolean") {
    return value ? t("common.true") : t("common.false");
  }

  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return value.toLocaleString();
    }
    return value.toString();
  }

  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function translationParamsFromLog(t: TranslateFn, log: TrainingLogLine): TranslationParams | undefined {
  const metrics = metricMap(log);
  if (!metrics) return undefined;

  const params: TranslationParams = {};

  Object.entries(metrics).forEach(([key, value]) => {
    const formatted = formatMetricValue(t, key, value, metrics);
    if (formatted !== null) {
      params[key] = formatted;
    }
  });

  return Object.keys(params).length > 0 ? params : undefined;
}

function translatedOrNull(t: TranslateFn, key: string, params?: TranslationParams) {
  const translated = t(key, params);
  return translated === key ? null : translated;
}

export function trainingStageLabel(t: TranslateFn, log: TrainingLogLine) {
  if (!log.stage) return null;
  const translated = translatedOrNull(t, `training.stage.${log.stage}`);
  return translated ?? log.stage.replace(/_/g, " ");
}

export function trainingLogMessage(t: TranslateFn, log: TrainingLogLine) {
  if (log.code) {
    const translated = translatedOrNull(t, `training.log.${log.code}`, translationParamsFromLog(t, log));
    if (translated) {
      return translated;
    }
  }

  return log.message ?? log.line;
}

export function trainingMetricChips(t: TranslateFn, log: TrainingLogLine): TrainingMetricChip[] {
  const metrics = metricMap(log);
  if (!metrics) return [];

  return DISPLAY_METRIC_KEYS.flatMap((key) => {
    const labelKey = METRIC_LABEL_KEYS[key];
    const value = formatMetricValue(t, key, metrics[key], metrics);
    if (!value) {
      return [];
    }

    const label = translatedOrNull(t, labelKey) ?? key;
    return [{ key, label, value }];
  });
}

export function normalizeActiveJobLogs(job: ActiveJobSummary | null) {
  if (!job) return job;
  return {
    ...job,
    recentLogs: dedupeTrainingLogs(job.recentLogs),
  };
}
