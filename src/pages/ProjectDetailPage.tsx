import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ChevronLeft,
  Activity,
  Settings2,
  Edit3,
  Image,
  Play,
  Download,
  FlaskConical,
  Trash2,
  Save,
  X,
} from "lucide-react";
import ConfigEditor from "../components/project/ConfigEditor";
import DatasetEditor from "../components/project/DatasetEditor";
import SampleImageViewer from "../components/project/SampleImageViewer";
import TrainingConsolePanel from "../components/project/TrainingConsolePanel";
import {
  abortTraining,
  exportCheckpoint,
  getActiveJob,
  getDatasetPreviewAssets,
  getProject,
  listDatasetEntries,
  loadTrainingConfig,
  onTrainingLog,
  onTrainingProgress,
  onTrainingState,
  saveTrainingConfig,
  startTraining,
} from "../lib/desktopApi";
import FileAssetImage from "../components/FileAssetImage";
import { formatTimer } from "../lib/formatters";
import { useI18n, type TranslateFn } from "../lib/i18n";
import { appendTrainingLog, dedupeTrainingLogs, normalizeActiveJobLogs } from "../lib/trainingLogs";
import type {
  ActiveJobSummary,
  DatasetEntry,
  JobStatus,
  TrainingConfig,
  TrainingLogLine,
  TrainingSnapshot,
  ProjectRecord,
} from "../lib/types";

type ViewMode = "main" | "config" | "dataset" | "test";
type BadgeVariant = "orange" | "acid" | "white";
const TERMINAL_JOB_STATUSES: JobStatus[] = ["completed", "failed", "aborted", "interrupted"];

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

function chartBarsFromHistory(history: ActiveJobSummary["history"]): number[] {
  if (history.length === 0) {
    return Array.from({ length: 24 }, (_, index) => Math.max(8, 72 - index * 2));
  }

  return history.map((point) => Math.min(100, Math.max(5, (point.loss / 0.2) * 100)));
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

function configSummary(config: TrainingConfig, t: TranslateFn) {
  const summary = [
    { key: t("config.trainingScript"), val: trainingScriptSummaryLabel(config.trainingScript, t) },
    { key: t("config.pretrainedModel"), val: config.pretrainedModel },
    { key: t("config.resolution"), val: config.resolution },
    { key: t("config.datasetRepeats"), val: String(config.datasetRepeats) },
    { key: t("config.batchSize"), val: String(config.batchSize) },
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
  const [runtimeSeconds, setRuntimeSeconds] = useState(0);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualConsoleLogs, setManualConsoleLogs] = useState<TrainingLogLine[]>([]);
  const manualLogSeqRef = useRef(-1);
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
    const [projectData, configData, jobData, datasetData] = await Promise.all([
      getProject(projectId),
      loadTrainingConfig(projectId),
      getActiveJob(projectId),
      listDatasetEntries(projectId),
    ]);

    setProject(projectData);
    setConfig(configData);
    setDraftConfig(configData);
    setJob(normalizeActiveJobLogs(jobData));
    setDatasetEntries(datasetData);
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
  const chartBars = chartBarsFromHistory(job?.history ?? []);
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
  const datasetPreviewEntries = useMemo(() => imageEntries.slice(0, 11), [imageEntries]);
  const configItems = useMemo(() => (draftConfig ? configSummary(draftConfig, t) : []), [draftConfig, t]);

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
        nextJob = await startTraining(projectId);
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
      appendConsoleNotice(
        shouldStartTraining
          ? t("projectDetail.consoleStartFailed")
          : t("projectDetail.consoleAbortFailed"),
        {
          level: "warn",
          stage: shouldStartTraining ? "bootstrap" : "shutdown",
        },
      );
      setError(actionError instanceof Error ? actionError.message : t("errors.controlTrainer"));
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

  const mainActionLabel = canStartTraining
    ? t("projectDetail.start")
    : t("projectDetail.abort");

  const MainActionIcon = canStartTraining
    ? Play
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
              <button className="btn btn-primary" onClick={() => void handleExport()} disabled={busyAction !== null}>
                <Download size={16} /> {busyAction === "export" ? t("common.exporting") : t("common.export")}
              </button>
              <button className="btn" onClick={() => switchView("test")}>
                <FlaskConical size={16} /> {t("projectDetail.test")}
              </button>
            </div>
          ) : null}

          {view === "config" ? (
            <div className="header-actions" style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn btn-primary" onClick={() => void handleSaveConfig()} disabled={busyAction !== null}>
                <Save size={16} /> {busyAction === "save-config" ? t("common.applying") : t("common.apply")}
              </button>
              <button className="btn" onClick={handleDiscardConfig} disabled={busyAction !== null}>
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
                    {" "}/ {snapshot.epochTotal || draftConfig?.epochs || 0}
                  </span>
                </span>
              </div>
              <div className="prog-stat-item">
                <span className="prog-label">{t("projectDetail.globalSteps")}</span>
                <span className="prog-val highlight">
                  {snapshot.step.toLocaleString()}
                  <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>
                    {" "}/ {(snapshot.stepTotal || draftConfig?.stepsPerEpoch || 0).toLocaleString()}
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
                  width: `${snapshot.stepTotal > 0 ? (snapshot.step / snapshot.stepTotal) * 100 : 0}%`,
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
                {["0.20", "0.15", "0.10", "0.05", "0.00"].map((label, index) => (
                  <div key={label} className="chart-line" style={{ top: `${index * 25}%` }}>
                    <span className="chart-y-label">{label}</span>
                  </div>
                ))}
              </div>
              {chartBars.map((height, index) => (
                <div
                  key={`${height}-${index}`}
                  className="chart-bar"
                  style={{
                    height: `${height}%`,
                    background: index > chartBars.length - 10 ? "var(--accent-orange)" : undefined,
                  }}
                />
              ))}
            </div>
          </div>

          <div
            className="card config-card clickable-card"
            onClick={() => switchView("config")}
            title={t("projectDetail.clickToEdit")}
            style={{ animationDelay: "0.2s" }}
          >
            <div className="card-header">
              <span className="card-title-icon">
                <Settings2 size={18} /> {t("projectDetail.hyperparameters")}
              </span>
              <Edit3 size={14} style={{ color: "var(--text-muted)" }} />
            </div>
            <div className="config-list">
              {configItems.map((item) => (
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
            onClick={() => switchView("dataset")}
            style={{ animationDelay: "0.3s" }}
          >
            <div className="card-header">
              <span className="card-title-icon">
                <Image size={18} /> {t("projectDetail.datasetPreview")}
              </span>
              <span>{t("dataset.imageCount", { count: imageCount })}</span>
            </div>
            <div className="dataset-grid">
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
                  />
                ))
              ) : (
                <FileAssetImage className="data-img" alt={t("projectDetail.datasetPlaceholder")} fit="cover" showOverlay />
              )}
              {imageCount > 11 ? (
                <div
                  className="data-img"
                  style={{
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.85rem",
                  }}
                >
                  +{imageCount - 11}
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

      {view === "config" && draftConfig ? (
        <ConfigEditor config={draftConfig} onChange={setDraftConfig} />
      ) : null}
      {view === "dataset" && projectId ? <DatasetEditor projectId={projectId} /> : null}
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
