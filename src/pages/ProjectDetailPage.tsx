import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ChevronLeft,
  Activity,
  Cpu,
  Settings2,
  Edit3,
  Image,
  Play,
  Download,
  FlaskConical,
  Trash2,
  Save,
  X,
  Layers,
} from "lucide-react";
import ConfigEditor from "../components/project/ConfigEditor";
import DatasetEditor from "../components/project/DatasetEditor";
import DiffusionPipeConfigPanel from "../components/project/DiffusionPipeConfigPanel";
import SampleImageViewer from "../components/project/SampleImageViewer";
import TrainingConsolePanel from "../components/project/TrainingConsolePanel";
import {
  abortTraining,
  exportCheckpoint,
  getActiveJob,
  getDatasetPreviewAssets,
  getLatestOutputCheckpoint,
  getProject,
  listDatasetEntries,
  loadDiffusionPipeConfig,
  loadTrainingConfig,
  onTrainingLog,
  onTrainingProgress,
  onTrainingState,
  saveDiffusionPipeConfig,
  saveTrainingConfig,
  startDiffusionPipeTraining,
  startTraining,
  startTrainingFromLatestWeights,
  resumeTraining,
} from "../lib/desktopApi";
import FileAssetImage from "../components/FileAssetImage";
import { formatTimer } from "../lib/formatters";
import { useI18n, type TranslateFn } from "../lib/i18n";
import { appendTrainingLog, dedupeTrainingLogs, normalizeActiveJobLogs } from "../lib/trainingLogs";
import type {
  ActiveJobSummary,
  DatasetEntry,
  DiffusionPipeConfig,
  JobStatus,
  TrainingConfig,
  TrainingLogLine,
  TrainingSnapshot,
  ProjectRecord,
} from "../lib/types";

type ViewMode = "main" | "config" | "dataset" | "test";
type TrainingMode = "sd-scripts" | "diffusion-pipe";
type BadgeVariant = "orange" | "acid" | "white";
const TERMINAL_JOB_STATUSES: JobStatus[] = ["completed", "failed", "aborted", "interrupted"];

/** Tauri IPC errors arrive as plain strings, not Error objects. Extract a readable message either way. */
function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string" && err.length > 0) return err;
  return fallback;
}

/** 仅用于推算行列数：格子在 CSS 中用 1fr 拉伸铺满容器 */
const DATASET_PREVIEW_MIN_CELL_PX = 56;
const DATASET_PREVIEW_GAP_PX = 4;

function datasetPreviewGridDimensions(
  innerWidthPx: number,
  innerHeightPx: number,
): { cols: number; rows: number } {
  const minCell = DATASET_PREVIEW_MIN_CELL_PX;
  const gap = DATASET_PREVIEW_GAP_PX;
  const pitch = minCell + gap;
  const cols = Math.max(1, Math.floor((innerWidthPx + gap) / pitch));
  const h = innerHeightPx >= pitch ? innerHeightPx : pitch;
  const rows = Math.max(1, Math.floor((h + gap) / pitch));
  return { cols, rows };
}

function canStartFromStatus(status: JobStatus | null | undefined) {
  return !status || TERMINAL_JOB_STATUSES.includes(status);
}

function badgeForView(view: ViewMode, t: TranslateFn): { variant: BadgeVariant; label: string } {
  if (view === "dataset") return { variant: "white", label: t("projectDetail.badge.dataset") };
  if (view === "test") return { variant: "white", label: t("projectDetail.badge.test") };
  if (view === "config") return { variant: "acid", label: t("projectDetail.badge.config") };
  return { variant: "orange", label: t("projectDetail.badge.training") };
}

function snapshotFromJob(job: ActiveJobSummary | null): TrainingSnapshot {
  return {
    epoch: job?.epoch ?? 0,
    epochTotal: job?.epochTotal ?? 0,
    step: job?.step ?? 0,
    stepTotal: job?.stepTotal ?? 0,
    loss: job?.loss ?? 0,
    lr: job?.lr ?? 0.00015,
    runtimeSeconds: job?.runtimeSeconds ?? 0,
    pid: job?.pid ?? null,
    status: job?.status ?? "interrupted",
  };
}

interface LossChartBar {
  height: number;
  step: number | null;
  loss: number | null;
}

function lossChartBarsFromHistory(history: ActiveJobSummary["history"]): LossChartBar[] {
  if (history.length === 0) {
    return Array.from({ length: 24 }, (_, index) => ({
      height: Math.max(8, 72 - index * 2),
      step: null,
      loss: null,
    }));
  }

  return history.map((point) => ({
    height: Math.min(100, Math.max(5, (point.loss / 0.2) * 100)),
    step: point.step,
    loss: point.loss,
  }));
}

function trainingScriptSummaryLabel(script: string, t: TranslateFn): string {
  switch (script.trim()) {
    case "sdxl_train_network.py":
      return "SDXL";
    case "anima_train_network.py":
      return t("config.animaTrainNetworkScript");
    default:
      return t("config.trainNetworkScript");
  }
}

const DP_MODEL_LABELS: Record<string, string> = {
  "hunyuan-video": "HunyuanVideo",
  "hunyuan_video_15": "HunyuanVideo 1.5",
  "hunyuan_image": "HunyuanImage 2.1",
  "wan": "Wan 2.1 / 2.2",
  "flux": "Flux",
  "flux2": "Flux 2",
  "ltx-video": "LTX-Video",
  "ltx2": "LTX 2.3",
  "sdxl": "SDXL",
  "sd3": "Stable Diffusion 3",
  "cosmos": "Cosmos",
  "cosmos_predict2": "Cosmos-Predict2",
  "anima": "Anima (动漫)",
  "lumina_2": "Lumina Image 2.0",
  "chroma": "Chroma",
  "hidream": "HiDream",
  "omnigen2": "OmniGen2",
  "qwen_image": "Qwen-Image",
  "auraflow": "AuraFlow",
  "z_image": "Z-Image",
  "ernie_image": "Ernie-Image",
};

function dpConfigSummary(config: DiffusionPipeConfig) {
  const modelLabel = DP_MODEL_LABELS[config.modelType] ?? config.modelType;
  const trainingLen = config.maxSteps > 0
    ? `总步数 (--max_steps) · ${config.maxSteps}`
    : `Epochs · ${config.epochs}`;

  const summary: { key: string; val: string; plain?: boolean }[] = [
    { key: "模型类型", val: modelLabel },
    { key: "预训练模型", val: config.modelPath || "—" },
    { key: "分辨率", val: config.datasetResolutions || "—" },
    { key: "数据集重复次数", val: String(config.numRepeats) },
    { key: "批大小", val: String(config.microBatchSizePerGpu) },
    { key: "训练长度", val: trainingLen },
    { key: "学习率", val: config.lr || "—" },
  ];

  if (config.adapterType === "lora") {
    summary.push({ key: "LoRA Rank", val: String(config.loraRank) });
    if (config.loraDtype) summary.push({ key: "LoRA dtype", val: config.loraDtype });
  } else if (!config.adapterType) {
    summary.push({ key: "Adapter", val: "全量微调 (FFT)", plain: true });
  }

  summary.push({ key: "优化器", val: config.optimizerType || "—" });
  summary.push({ key: "模型 dtype", val: config.modelDtype || "—" });
  summary.push({ key: "Transformer dtype", val: config.transformerDtype || "—" });
  summary.push({ key: "激活检查点", val: config.activationCheckpointing || "false", plain: true });

  if (config.saveEveryNEpochs > 0) {
    summary.push({ key: "每 N Epoch 保存", val: String(config.saveEveryNEpochs) });
  }
  if (config.saveEveryNSteps > 0) {
    summary.push({ key: "每 N 步保存", val: String(config.saveEveryNSteps) });
  }
  if (config.resumeFromCheckpoint.trim()) {
    summary.push({ key: "恢复训练", val: config.resumeFromCheckpoint });
  }

  return summary;
}

function configSummary(config: TrainingConfig, t: TranslateFn) {
  const summary = [
    { key: t("config.trainingScript"), val: trainingScriptSummaryLabel(config.trainingScript, t) },
    { key: t("config.pretrainedModel"), val: config.pretrainedModel },
    { key: t("config.resolution"), val: config.resolution },
    { key: t("config.datasetRepeats"), val: String(config.datasetRepeats) },
    { key: t("config.batchSize"), val: String(config.batchSize) },
    {
      key: t("config.trainingLengthMode"),
      val:
        (config.trainingLengthMode ?? "steps") === "epochs"
          ? `${t("config.trainingLengthByEpochs")} · ${config.epochs}`
          : `${t("config.trainingLengthBySteps")} · ${config.maxTrainSteps}`,
    },
    { key: t("config.baseLr"), val: config.baseLr },
    { key: t("config.networkDimRank"), val: String(config.networkDim) },
    { key: t("config.networkAlpha"), val: String(config.networkAlpha) },
    { key: t("config.optimizer"), val: config.optimizer },
    { key: t("config.lrScheduler"), val: config.lrScheduler },
    { key: t("config.mixedPrecision"), val: config.mixedPrecision },
    {
      key: t("config.gradientCheckpointing"),
      val: config.gradientCheckpointing ? t("common.true") : t("common.false"),
      plain: true,
    },
    {
      key: t("config.cacheLatents"),
      val: config.cacheLatents ? t("common.true") : t("common.false"),
      plain: true,
    },
    { key: t("config.seed"), val: String(config.seed) },
  ];

  if (config.trainingScript.trim() === "anima_train_network.py") {
    if (config.animaQwen3.trim()) {
      summary.push({ key: t("config.animaQwen3"), val: config.animaQwen3 });
    }
    if (config.animaLlmAdapterLr.trim()) {
      summary.push({ key: t("config.animaLlmAdapterLr"), val: config.animaLlmAdapterLr });
    }
  }

  if (config.enableBucket) {
    summary.push({
      key: t("config.enableBucket"),
      val: `${config.minBucketReso}-${config.maxBucketReso} / ${config.bucketResoSteps}`,
    });
  }
  if (config.saveEveryNSteps > 0) {
    summary.push({ key: t("config.saveEveryNSteps"), val: String(config.saveEveryNSteps) });
  }
  if (config.sampleEveryNSteps > 0) {
    summary.push({ key: t("config.sampleEveryNSteps"), val: String(config.sampleEveryNSteps) });
  }
  if (config.sampleEveryNEpochs > 0) {
    summary.push({ key: t("config.sampleEveryNEpochs"), val: String(config.sampleEveryNEpochs) });
  }
  if (config.sampleAtFirst) {
    summary.push({
      key: t("config.sampleAtFirst"),
      val: t("common.true"),
      plain: true,
    });
  }
  if (config.samplePrompts.trim()) {
    const firstPrompt = config.samplePrompts
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (firstPrompt) {
      summary.push({ key: t("config.samplePrompts"), val: firstPrompt });
    }
  }
  if (config.sampleEveryNSteps > 0 || config.sampleEveryNEpochs > 0 || config.sampleAtFirst) {
    summary.push({
      key: t("config.sampleSteps"),
      val: String(config.sampleSteps),
    });
    summary.push({
      key: t("config.sampleCfgScale"),
      val: config.sampleCfgScale,
    });
    summary.push({
      key: t("config.sampleSize"),
      val: `${config.sampleWidth}x${config.sampleHeight}`,
    });
  }
  if (config.networkWeights.trim()) {
    summary.push({ key: t("config.networkWeights"), val: config.networkWeights });
  }
  if (config.resume.trim()) {
    summary.push({ key: t("config.resume"), val: config.resume });
  }

  return summary;
}

export default function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, formatClock } = useI18n();
  const [searchParams] = useSearchParams();
  const initialView = (searchParams.get("view") as ViewMode) || "main";
  const [view, setView] = useState<ViewMode>(initialView);
  const [{ label: badgeLabel, variant: badgeVariant }, setBadge] = useState(badgeForView(initialView, t));
  const [titleGlitch, setTitleGlitch] = useState(false);
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [config, setConfig] = useState<TrainingConfig | null>(null);
  const [draftConfig, setDraftConfig] = useState<TrainingConfig | null>(null);
  const [job, setJob] = useState<ActiveJobSummary | null>(null);
  const [datasetEntries, setDatasetEntries] = useState<DatasetEntry[]>([]);
  const [datasetPreviewPaths, setDatasetPreviewPaths] = useState<Record<string, string | null>>({});
  const [initialDatasetImagePath, setInitialDatasetImagePath] = useState<string | null>(null);
  const [runtimeSeconds, setRuntimeSeconds] = useState(0);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualConsoleLogs, setManualConsoleLogs] = useState<TrainingLogLine[]>([]);
  const manualLogSeqRef = useRef(-1);
  const datasetPreviewGridRef = useRef<HTMLDivElement>(null);
  const [datasetPreviewGridDims, setDatasetPreviewGridDims] = useState({ cols: 6, rows: 2 });
  /** Newest `.safetensors` in project output dir (mtime); drives “continue from latest”. */
  const [latestCheckpointPath, setLatestCheckpointPath] = useState<string | null>(null);
  const [trainingMode, setTrainingMode] = useState<TrainingMode>("sd-scripts");
  const [configTab, setConfigTab] = useState<TrainingMode>("sd-scripts");
  const [dpConfig, setDpConfig] = useState<DiffusionPipeConfig | null>(null);
  const [draftDpConfig, setDraftDpConfig] = useState<DiffusionPipeConfig | null>(null);
  const projectId = id ?? "";
  const projectName = project?.name ?? projectId.replace(/-/g, "_");

  const triggerScan = useCallback(() => {
    const fx = document.getElementById("scan-fx");
    if (fx) {
      fx.classList.remove("scan-active");
      void (fx as HTMLElement).offsetWidth;
      fx.classList.add("scan-active");
    }
  }, []);

  const switchView = useCallback(
    (target: ViewMode) => {
      triggerScan();
      setTitleGlitch(true);
      const nextBadge = badgeForView(target, t);
      setTimeout(() => {
        setView(target);
        setBadge(nextBadge);
        setTimeout(() => setTitleGlitch(false), 400);
      }, 250);
    },
    [t, triggerScan],
  );

  const appendConsoleNotice = useCallback(
    (
      message: string,
      options?: {
        level?: TrainingLogLine["level"];
        stage?: TrainingLogLine["stage"];
      },
    ) => {
      const entry: TrainingLogLine = {
        seq: manualLogSeqRef.current,
        stream: "ui",
        level: options?.level ?? "info",
        channel: "rich",
        kind: "ui_action",
        stage: options?.stage ?? null,
        code: null,
        message,
        metrics: null,
        rawLine: null,
        line: message,
        createdAt: Math.floor(Date.now() / 1000),
      };
      manualLogSeqRef.current -= 1;
      setManualConsoleLogs((current) => appendTrainingLog(current, entry, 40));
    },
    [],
  );

  const loadProjectData = useCallback(async () => {
    if (!projectId) return;
    const [projectData, configData, jobData, datasetData, latestCkpt, dpCfg] = await Promise.all([
      getProject(projectId),
      loadTrainingConfig(projectId),
      getActiveJob(projectId),
      listDatasetEntries(projectId),
      getLatestOutputCheckpoint(projectId).catch(() => null),
      loadDiffusionPipeConfig(projectId).catch(() => null),
    ]);

    setProject(projectData);
    setConfig(configData);
    setDraftConfig(configData);
    if (dpCfg) { setDpConfig(dpCfg); setDraftDpConfig(dpCfg); }
    setJob(normalizeActiveJobLogs(jobData));
    setDatasetEntries(datasetData);
    setLatestCheckpointPath(typeof latestCkpt === "string" && latestCkpt.length > 0 ? latestCkpt : null);
    setRuntimeSeconds(jobData?.runtimeSeconds ?? 0);
  }, [projectId]);

  useEffect(() => {
    let mounted = true;
    void loadProjectData().catch((loadError) => {
      if (mounted) {
        setError(loadError instanceof Error ? loadError.message : t("errors.loadProject"));
      }
    });

    let unlistenProgress: (() => void) | undefined;
    let unlistenLog: (() => void) | undefined;
    let unlistenState: (() => void) | undefined;

    void onTrainingProgress((event) => {
      if (event.projectId !== projectId) return;
      setJob((current) => {
        const base = current ?? {
          jobId: event.jobId,
          projectId,
          projectName: event.projectId.replace(/-/g, "_"),
          checkpointName: `${event.projectId.replace(/-/g, "_")}.safetensors`,
          status: event.snapshot.status,
          pid: event.snapshot.pid,
          runtimeSeconds: event.snapshot.runtimeSeconds,
          epoch: event.snapshot.epoch,
          epochTotal: event.snapshot.epochTotal,
          step: event.snapshot.step,
          stepTotal: event.snapshot.stepTotal,
          loss: event.snapshot.loss,
          lr: event.snapshot.lr,
          recentLogs: [],
          history: [],
        };

        return {
          ...base,
          status: event.snapshot.status,
          pid: event.snapshot.pid,
          runtimeSeconds: event.snapshot.runtimeSeconds,
          epoch: event.snapshot.epoch,
          epochTotal: event.snapshot.epochTotal,
          step: event.snapshot.step,
          stepTotal: event.snapshot.stepTotal,
          loss: event.snapshot.loss,
          lr: event.snapshot.lr,
          history: [...base.history.slice(-59), { step: event.snapshot.step, loss: event.snapshot.loss }],
        };
      });
      setRuntimeSeconds(event.snapshot.runtimeSeconds);
    }).then((fn) => {
      unlistenProgress = fn;
    });

    void onTrainingLog((event) => {
      if (event.projectId !== projectId) return;
      setJob((current) =>
        current
          ? {
              ...current,
              recentLogs: appendTrainingLog(current.recentLogs, event.entry, 200),
            }
          : current,
      );
    }).then((fn) => {
      unlistenLog = fn;
    });

    void onTrainingState((event) => {
      if (event.projectId !== projectId) return;
      setJob((current) => (current ? { ...current, status: event.status } : current));
      void loadProjectData().catch(() => undefined);
    }).then((fn) => {
      unlistenState = fn;
    });

    return () => {
      mounted = false;
      unlistenProgress?.();
      unlistenLog?.();
      unlistenState?.();
    };
  }, [loadProjectData, projectId, t]);

  useEffect(() => {
    setManualConsoleLogs([]);
    manualLogSeqRef.current = -1;
  }, [projectId]);

  useEffect(() => {
    setBadge(badgeForView(view, t));
  }, [t, view]);

  useEffect(() => {
    const active = job?.status === "running";
    if (!active) return;
    const interval = window.setInterval(() => {
      setRuntimeSeconds((seconds) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [job?.status]);

  const snapshot = snapshotFromJob(job);
  const lengthMode = draftConfig?.trainingLengthMode ?? "steps";
  const stepTotalForUi =
    snapshot.stepTotal ||
    (trainingMode === "diffusion-pipe"
      ? draftDpConfig?.maxSteps ?? 0
      : draftConfig
        ? lengthMode === "steps"
          ? draftConfig.maxTrainSteps
          : 0
        : 0) ||
    0;
  const epochTotalForUi =
    snapshot.epochTotal ||
    (trainingMode === "diffusion-pipe"
      ? draftDpConfig?.epochs ?? 0
      : draftConfig?.epochs ?? 0);
  const lossChartBars = lossChartBarsFromHistory(job?.history ?? []);
  const consoleLogs = useMemo(
    () =>
      dedupeTrainingLogs(
        [...(job?.recentLogs ?? []), ...manualConsoleLogs].sort((left, right) =>
          left.createdAt === right.createdAt
            ? left.seq - right.seq
            : left.createdAt - right.createdAt,
        ),
      ),
    [job?.recentLogs, manualConsoleLogs],
  );
  const canStartTraining = canStartFromStatus(job?.status);
  const imageEntries = useMemo(
    () => datasetEntries.filter((entry) => entry.kind === "image"),
    [datasetEntries],
  );
  const imageCount = imageEntries.length;
  const datasetPreviewSlots = datasetPreviewGridDims.cols * datasetPreviewGridDims.rows;

  const datasetPreviewEntries = useMemo(() => {
    const total = imageEntries.length;
    if (total === 0) return [];
    const maxImages =
      total <= datasetPreviewSlots ? total : Math.max(0, datasetPreviewSlots - 1);
    return imageEntries.slice(0, maxImages);
  }, [imageEntries, datasetPreviewSlots]);

  const datasetPreviewOverflowCount =
    imageCount > datasetPreviewSlots ? imageCount - datasetPreviewEntries.length : 0;

  useLayoutEffect(() => {
    if (view !== "main") return;
    const node = datasetPreviewGridRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      const width = node.clientWidth;
      const height = node.clientHeight;
      const next = datasetPreviewGridDimensions(width, height);
      setDatasetPreviewGridDims((prev) =>
        prev.cols === next.cols && prev.rows === next.rows ? prev : next,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [view]);

  const configItems = useMemo(() => (draftConfig ? configSummary(draftConfig, t) : []), [draftConfig, t]);
  const dpConfigItems = useMemo(() => (draftDpConfig ? dpConfigSummary(draftDpConfig) : []), [draftDpConfig]);

  useEffect(() => {
    if (!projectId || datasetPreviewEntries.length === 0) {
      setDatasetPreviewPaths({});
      return;
    }

    let cancelled = false;
    const previewRelativePaths = datasetPreviewEntries.map((entry) => entry.relativePath);
    const loadPreviewPaths = async () => {
      try {
        const previewAssets = await getDatasetPreviewAssets(projectId, previewRelativePaths);
        if (cancelled) {
          return;
        }

        const nextPreviewPaths: Record<string, string | null> = Object.fromEntries(
          previewRelativePaths.map((relativePath) => [relativePath, null] as const),
        );
        for (const asset of previewAssets) {
          nextPreviewPaths[asset.relativePath] = asset.filePath;
        }
        setDatasetPreviewPaths(nextPreviewPaths);
      } catch {
        if (!cancelled) {
          setDatasetPreviewPaths(
            Object.fromEntries(previewRelativePaths.map((relativePath) => [relativePath, null] as const)),
          );
        }
      }
    };

    void loadPreviewPaths();
    return () => {
      cancelled = true;
    };
  }, [datasetPreviewEntries, projectId]);

  const handlePrimaryAction = async () => {
    if (!projectId) return;
    const shouldStartTraining = canStartFromStatus(job?.status);
    setBusyAction("primary");
    setError(null);
    appendConsoleNotice(
      shouldStartTraining
        ? t("projectDetail.consoleStartRequested")
        : t("projectDetail.consoleAbortRequested"),
      {
        level: shouldStartTraining ? "info" : "warn",
        stage: shouldStartTraining ? "bootstrap" : "shutdown",
      },
    );
    try {
      let nextJob: ActiveJobSummary;
      if (shouldStartTraining) {
        if (trainingMode === "diffusion-pipe") {
          // Auto-save dp config before starting, same pattern as sd-scripts below.
          if (draftDpConfig) {
            console.log("[dp-config] 启动训练前自动保存，参数：", JSON.parse(JSON.stringify(draftDpConfig)));
            const saved = await saveDiffusionPipeConfig(projectId, draftDpConfig);
            console.log("[dp-config] 自动保存完成，后端返回：", JSON.parse(JSON.stringify(saved)));
            setDpConfig(saved);
            setDraftDpConfig(saved);
          }
          nextJob = await startDiffusionPipeTraining(projectId);
        } else {
          // Backend always reads the last saved config from SQLite — unsaved edits (e.g. cleared
          // 「网络初始权重」) would otherwise be ignored and an old `network_weights` path kept.
          if (draftConfig) {
            const saved = await saveTrainingConfig(projectId, draftConfig);
            setConfig(saved);
            setDraftConfig(saved);
          }
          nextJob = await startTraining(projectId);
        }
      } else {
        nextJob = await abortTraining(projectId);
      }
      setJob(normalizeActiveJobLogs(nextJob));
      setRuntimeSeconds(nextJob.runtimeSeconds);
      appendConsoleNotice(
        shouldStartTraining
          ? t("projectDetail.consoleStartConfirmed")
          : t("projectDetail.consoleAbortConfirmed"),
        {
          level: "success",
          stage: shouldStartTraining ? "train_loop" : "shutdown",
        },
      );
      await loadProjectData();
    } catch (actionError) {
      const errMsg = extractErrorMessage(actionError, t("errors.controlTrainer"));
      appendConsoleNotice(
        shouldStartTraining
          ? `${t("projectDetail.consoleStartFailed")}: ${errMsg}`
          : `${t("projectDetail.consoleAbortFailed")}: ${errMsg}`,
        {
          level: "warn",
          stage: shouldStartTraining ? "bootstrap" : "shutdown",
        },
      );
      setError(errMsg);
    } finally {
      setBusyAction(null);
    }
  };

  const handleContinueFromLatest = async () => {
    if (!projectId || !latestCheckpointPath || !canStartTraining) return;
    setBusyAction("continue-latest");
    setError(null);
    appendConsoleNotice(
      t("projectDetail.consoleContinueFromWeightsRequested", { path: latestCheckpointPath }),
      {
        level: "info",
        stage: "bootstrap",
      },
    );
    try {
      if (draftConfig) {
        const saved = await saveTrainingConfig(projectId, draftConfig);
        setConfig(saved);
        setDraftConfig(saved);
      }
      const nextJob = await startTrainingFromLatestWeights(projectId);
      setJob(normalizeActiveJobLogs(nextJob));
      setRuntimeSeconds(nextJob.runtimeSeconds);
      appendConsoleNotice(
        t("projectDetail.consoleContinueFromWeightsConfirmed", { path: latestCheckpointPath }),
        {
          level: "success",
          stage: "train_loop",
        },
      );
      await loadProjectData();
    } catch (actionError) {
      const errMsg = extractErrorMessage(actionError, t("errors.controlTrainer"));
      appendConsoleNotice(`${t("projectDetail.consoleContinueFromWeightsFailed")}: ${errMsg}`, {
        level: "warn",
        stage: "bootstrap",
      });
      setError(errMsg);
    } finally {
      setBusyAction(null);
    }
  };

  const handleResumeProcess = async () => {
    if (!projectId || job?.status !== "paused") return;
    setBusyAction("resume-process");
    setError(null);
    appendConsoleNotice(t("projectDetail.consoleResumeRequested"), {
      level: "info",
      stage: "bootstrap",
    });
    try {
      const nextJob = await resumeTraining(projectId);
      setJob(normalizeActiveJobLogs(nextJob));
      setRuntimeSeconds(nextJob.runtimeSeconds);
      appendConsoleNotice(t("projectDetail.consoleResumeConfirmed"), {
        level: "success",
        stage: "train_loop",
      });
      await loadProjectData();
    } catch (actionError) {
      const errMsg = extractErrorMessage(actionError, t("errors.controlTrainer"));
      appendConsoleNotice(`${t("projectDetail.consoleResumeFailed")}: ${errMsg}`, {
        level: "warn",
        stage: "bootstrap",
      });
      setError(errMsg);
    } finally {
      setBusyAction(null);
    }
  };

  const handleExport = async () => {
    if (!projectId) return;
    setBusyAction("export");
    setError(null);
    try {
      const exportedPath = await exportCheckpoint(projectId);
      setError(t("projectDetail.exportSuccess", { path: exportedPath }));
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : t("errors.exportCheckpoint"));
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveConfig = async () => {
    if (!projectId || !draftConfig) return;
    setBusyAction("save-config");
    setError(null);
    try {
      const saved = await saveTrainingConfig(projectId, draftConfig);
      setConfig(saved);
      setDraftConfig(saved);
      await loadProjectData();
      switchView("main");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("errors.saveConfig"));
    } finally {
      setBusyAction(null);
    }
  };

  const handleDiscardConfig = () => {
    setDraftConfig(config);
    switchView("main");
  };

  const handleSaveDpConfig = async () => {
    if (!projectId || !draftDpConfig) return;
    setBusyAction("save-dp-config");
    setError(null);
    console.log("[dp-config] 点击应用，待保存参数：", JSON.parse(JSON.stringify(draftDpConfig)));
    try {
      const saved = await saveDiffusionPipeConfig(projectId, draftDpConfig);
      console.log("[dp-config] 后端返回已保存参数：", JSON.parse(JSON.stringify(saved)));
      setDpConfig(saved);
      setDraftDpConfig(saved);
      setTrainingMode("diffusion-pipe");
      switchView("main");
    } catch (saveError) {
      console.error("[dp-config] 保存失败：", saveError);
      setError(saveError instanceof Error ? saveError.message : "保存 dp 配置失败");
    } finally {
      setBusyAction(null);
    }
  };

  const handleDiscardDpConfig = () => {
    setDraftDpConfig(dpConfig);
    switchView("main");
  };

  const mainActionLabel = canStartTraining
    ? trainingMode === "diffusion-pipe"
      ? "dp 训练"
      : t("projectDetail.start")
    : t("projectDetail.abort");

  const MainActionIcon = canStartTraining
    ? trainingMode === "diffusion-pipe"
      ? Cpu
      : Play
    : Trash2;

  return (
    <div className="container page-detail">
      <header className="detail-header">
        <div className="header-left">
          {view === "main" ? (
            <button className="back-btn" onClick={() => navigate("/")}>
              <ChevronLeft size={18} /> {t("common.back")}
            </button>
          ) : (
            <button className="back-btn" onClick={() => switchView("main")}>
              <ChevronLeft size={18} /> {t("projectDetail.backToTraining")}
            </button>
          )}
          <div className="project-title-group">
            <div className={`project-title-main${titleGlitch ? " glitch-text" : ""}`}>
              {projectName}
              <div className={`status-badge status-badge-${badgeVariant}`}>
                <div className="status-dot" /> {badgeLabel}
              </div>
            </div>
            <div className="project-path">{project?.rootPath ?? t("common.loadingPath")}</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {view === "main" ? (
            <div className="header-actions" style={{ display: "flex", gap: "0.5rem" }}>
              <button
                className={
                  !job || ["completed", "failed", "aborted", "interrupted"].includes(job.status)
                    ? "btn"
                    : "btn btn-danger"
                }
                onClick={() => void handlePrimaryAction()}
                disabled={busyAction !== null}
              >
                <MainActionIcon size={16} /> {busyAction === "primary" ? t("common.working") : mainActionLabel}
              </button>
              <button
                type="button"
                className="btn"
                title={t("projectDetail.continueFromLatestTitle")}
                aria-label={t("projectDetail.continueFromLatest")}
                disabled={busyAction !== null || !canStartTraining || !latestCheckpointPath}
                onClick={() => void handleContinueFromLatest()}
              >
                <Layers size={16} aria-hidden />{" "}
                {busyAction === "continue-latest" ? t("common.working") : t("projectDetail.continueFromLatest")}
              </button>
              {job?.status === "paused" ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  title={t("projectDetail.resumeProcessTitle")}
                  aria-label={t("projectDetail.resume")}
                  disabled={busyAction !== null}
                  onClick={() => void handleResumeProcess()}
                >
                  <Play size={16} aria-hidden />{" "}
                  {busyAction === "resume-process" ? t("common.working") : t("projectDetail.resume")}
                </button>
              ) : null}
              <button className="btn btn-primary" onClick={() => void handleExport()} disabled={busyAction !== null}>
                <Download size={16} /> {busyAction === "export" ? t("common.exporting") : t("common.export")}
              </button>
              <button
                type="button"
                className={trainingMode === "diffusion-pipe" ? "btn btn-primary" : "btn"}
                title={trainingMode === "diffusion-pipe" ? "切换到 sd-scripts 训练" : "切换到 diffusion-pipe 训练"}
                onClick={() =>
                  setTrainingMode((m) => (m === "sd-scripts" ? "diffusion-pipe" : "sd-scripts"))
                }
                style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}
              >
                <Cpu size={16} />
                {trainingMode === "diffusion-pipe" ? "diffusion-pipe" : "sd-scripts"}
              </button>
              <button className="btn" onClick={() => switchView("test")}>
                <FlaskConical size={16} /> {t("projectDetail.test")}
              </button>
            </div>
          ) : null}

          {view === "config" && configTab === "sd-scripts" ? (
            <div className="header-actions" style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn btn-primary" onClick={() => void handleSaveConfig()} disabled={busyAction !== null}>
                <Save size={16} /> {busyAction === "save-config" ? t("common.applying") : t("common.apply")}
              </button>
              <button className="btn" onClick={handleDiscardConfig} disabled={busyAction !== null}>
                <X size={16} /> {t("common.discard")}
              </button>
            </div>
          ) : null}

          {view === "config" && configTab === "diffusion-pipe" ? (
            <div className="header-actions" style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn btn-primary" onClick={() => void handleSaveDpConfig()} disabled={busyAction !== null}>
                <Save size={16} /> {busyAction === "save-dp-config" ? t("common.applying") : t("common.apply")}
              </button>
              <button className="btn" onClick={handleDiscardDpConfig} disabled={busyAction !== null}>
                <X size={16} /> {t("common.discard")}
              </button>
            </div>
          ) : null}

          <button
            className="btn"
            onClick={() =>
              navigate("/design", {
                state: { from: `${location.pathname}${location.search}` },
              })
            }
          >
            <Settings2 size={16} /> {t("projectDetail.design")}
          </button>

          <div
            style={{
              fontFamily: "var(--font-mono)",
              color: "var(--text-muted)",
              textAlign: "right",
              marginLeft: view === "main" || view === "config" ? "0.5rem" : "0",
              paddingLeft: view === "main" || view === "config" ? "1rem" : "0",
              borderLeft: view === "main" || view === "config" ? "1px solid var(--border-dim)" : "none",
            }}
          >
            <div style={{ fontSize: "0.6rem" }}>{t("projectDetail.runtime")}</div>
            <div
              style={{
                color: "var(--accent-acid)",
                fontWeight: "bold",
                fontSize: "0.95rem",
              }}
            >
              {formatTimer(runtimeSeconds)}
            </div>
          </div>
        </div>
      </header>

      {view === "main" ? (
        <div className="bento bento-detail view-main">
          <div className="card prog-card">
            <div className="prog-stats">
              <div className="prog-stat-item">
                <span className="prog-label">{t("projectDetail.currentEpoch")}</span>
                <span className="prog-val">
                  {snapshot.epoch}
                  <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>
                    {" "}/ {epochTotalForUi}
                  </span>
                </span>
              </div>
              <div className="prog-stat-item">
                <span className="prog-label">{t("projectDetail.globalSteps")}</span>
                <span className="prog-val highlight">
                  {snapshot.step.toLocaleString()}
                  <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>
                    {" "}/ {stepTotalForUi.toLocaleString()}
                  </span>
                </span>
              </div>
              <div className="prog-stat-item">
                <span className="prog-label">{t("projectDetail.currentLoss")}</span>
                <span className="prog-val">{snapshot.loss.toFixed(4)}</span>
              </div>
              <div className="prog-stat-item">
                <span className="prog-label">{t("projectDetail.learningRate")}</span>
                <span className="prog-val">{snapshot.lr.toExponential(2)}</span>
              </div>
            </div>
            <div className="main-progress-track">
              <div
                className="main-progress-fill"
                style={{
                  width: `${stepTotalForUi > 0 ? (snapshot.step / stepTotalForUi) * 100 : 0}%`,
                }}
              />
            </div>
          </div>

          <div className="card chart-card" style={{ animationDelay: "0.1s" }}>
            <div className="card-header">
              <span className="card-title-icon">
                <Activity size={18} /> {t("projectDetail.noisePredictionLoss")}
              </span>
              <span>{t("projectDetail.liveFromSqlite")}</span>
            </div>
            <div className="chart-container">
              <div className="chart-grid-lines">
                {[0.2, 0.15, 0.1, 0.05, 0].map((value, index) => {
                  const label = value.toFixed(4);
                  return (
                    <div key={label} className="chart-line" style={{ top: `${index * 25}%` }}>
                      <span className="chart-y-label">{label}</span>
                    </div>
                  );
                })}
              </div>
              {lossChartBars.map((bar, index) => {
                const title =
                  bar.loss != null && bar.step != null
                    ? t("projectDetail.lossChartBarTooltip", {
                        loss: bar.loss.toFixed(4),
                        step: bar.step.toLocaleString(),
                      })
                    : undefined;
                return (
                  <div
                    key={`${bar.step ?? "p"}-${index}-${bar.height}`}
                    className="chart-bar"
                    title={title}
                    style={{
                      height: `${bar.height}%`,
                      background:
                        index > lossChartBars.length - 10 ? "var(--accent-orange)" : undefined,
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div
            className="card config-card clickable-card"
            onClick={() => {
              setConfigTab(trainingMode);
              switchView("config");
            }}
            title={t("projectDetail.clickToEdit")}
            style={{ animationDelay: "0.2s" }}
          >
            <div className="card-header">
              <span className="card-title-icon">
                {trainingMode === "diffusion-pipe" ? <Cpu size={18} /> : <Settings2 size={18} />}
                {trainingMode === "diffusion-pipe" ? "diffusion-pipe" : t("projectDetail.hyperparameters")}
              </span>
              <Edit3 size={14} style={{ color: "var(--text-muted)" }} />
            </div>
            <div className="config-list">
              {(trainingMode === "diffusion-pipe" ? dpConfigItems : configItems).map((item) => (
                <div key={item.key} className="config-item">
                  <span className="key">{item.key}</span>
                  <span className="val" style={item.plain ? { color: "var(--text-main)" } : undefined}>
                    {item.val}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div
            className="card dataset-card clickable-card"
            onClick={() => { setInitialDatasetImagePath(null); switchView("dataset"); }}
            style={{ animationDelay: "0.3s" }}
          >
            <div className="card-header">
              <span className="card-title-icon">
                <Image size={18} /> {t("projectDetail.datasetPreview")}
              </span>
              <span>{t("dataset.imageCount", { count: imageCount })}</span>
            </div>
            <div
              ref={datasetPreviewGridRef}
              className="dataset-grid"
              style={
                {
                  "--ds-preview-cols": datasetPreviewGridDims.cols,
                  "--ds-preview-rows": datasetPreviewGridDims.rows,
                  "--ds-preview-gap": `${DATASET_PREVIEW_GAP_PX}px`,
                } as CSSProperties
              }
            >
              {datasetPreviewEntries.length > 0 ? (
                datasetPreviewEntries.map((entry) => (
                  <FileAssetImage
                    key={entry.relativePath}
                    className="data-img"
                    filePath={datasetPreviewPaths[entry.relativePath]}
                    alt={entry.name}
                    title={entry.relativePath}
                    fit="cover"
                    showOverlay
                    onClick={(e) => {
                      e.stopPropagation();
                      setInitialDatasetImagePath(entry.relativePath);
                      switchView("dataset");
                    }}
                  />
                ))
              ) : (
                <FileAssetImage
                  className="data-img dataset-preview-empty"
                  alt={t("projectDetail.datasetPlaceholder")}
                  fit="cover"
                  showOverlay
                />
              )}
              {datasetPreviewOverflowCount > 0 ? (
                <div
                  className="data-img data-img-overflow-more"
                  style={{
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.85rem",
                  }}
                >
                  +{datasetPreviewOverflowCount}
                </div>
              ) : null}
            </div>
          </div>

          <TrainingConsolePanel
            logs={consoleLogs}
            title={t("projectDetail.stdout")}
            emptyLabel={t("projectDetail.trainerOutputPlaceholder")}
            formatClock={formatClock}
            style={{ animationDelay: "0.4s" }}
          />
        </div>
      ) : null}

      {view === "config" ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* Training mode tab bar */}
          <div
            style={{
              display: "flex",
              gap: "0",
              borderBottom: "1px solid var(--border)",
              marginBottom: "0",
              background: "var(--bg-card, var(--bg-surface))",
            }}
          >
            {(["sd-scripts", "diffusion-pipe"] as TrainingMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setConfigTab(mode)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  padding: "0.6rem 1.25rem",
                  fontSize: "0.82rem",
                  background: "none",
                  border: "none",
                  borderBottom:
                    configTab === mode
                      ? "2px solid var(--accent)"
                      : "2px solid transparent",
                  color: configTab === mode ? "var(--accent)" : "var(--text-muted)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  marginBottom: "-1px",
                }}
              >
                {mode === "diffusion-pipe" ? <Cpu size={14} /> : <Settings2 size={14} />}
                {mode}
              </button>
            ))}
          </div>

          {configTab === "sd-scripts" && draftConfig ? (
            <ConfigEditor config={draftConfig} onChange={setDraftConfig} />
          ) : null}

          {configTab === "diffusion-pipe" ? (
            <DiffusionPipeConfigPanel
              config={draftDpConfig}
              onChange={setDraftDpConfig}
            />
          ) : null}
        </div>
      ) : null}
      {view === "dataset" && projectId ? (
        <DatasetEditor
          projectId={projectId}
          initialImagePath={initialDatasetImagePath ?? undefined}
        />
      ) : null}
      {view === "test" && projectId && draftConfig ? (
        <SampleImageViewer
          projectId={projectId}
          config={draftConfig}
          isTrainingActive={job?.status === "running"}
        />
      ) : null}

      {error ? (
        <div style={{ marginTop: "1rem", color: "var(--accent-orange)", fontFamily: "var(--font-mono)" }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
