import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Activity,
  Archive,
  Boxes,
  Bug,
  ChevronDown,
  Database,
  Gauge,
  HardDriveDownload,
  Power,
  Settings2,
  ShieldCheck,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "../../lib/i18n";
import {
  splitTrainingLogs,
  trainingLogMessage,
  trainingMetricChips,
  trainingStageLabel,
} from "../../lib/trainingLogs";
import type { TrainingLogLine } from "../../lib/types";

const STAGE_ICONS: Record<string, LucideIcon> = {
  bootstrap: Power,
  dataset_scan: Database,
  model_load: Boxes,
  network_build: Settings2,
  optimizer_init: Settings2,
  cache_latents: HardDriveDownload,
  train_loop: Activity,
  validation: ShieldCheck,
  checkpoint_save: Archive,
  shutdown: Gauge,
};

function toneForLevel(level: string) {
  const normalized = level.toLowerCase();
  if (normalized === "warning") return "warn";
  if (normalized === "completed") return "success";
  if (normalized === "failed") return "error";
  return normalized;
}

function rawLogText(log: TrainingLogLine) {
  return log.rawLine ?? log.line;
}

export interface TrainingConsoleLineProps {
  log: TrainingLogLine;
  formatClock: (timestampSeconds: number) => string;
  compact?: boolean;
}

export function TrainingConsoleLine({
  log,
  formatClock,
  compact = false,
}: TrainingConsoleLineProps) {
  const { t } = useI18n();
  const tone = toneForLevel(log.level);
  const stageLabel = trainingStageLabel(t, log);
  const message = trainingLogMessage(t, log);
  const metricChips = trainingMetricChips(t, log);
  const visibleMetricChips = compact ? metricChips.slice(0, 2) : metricChips;
  const StageIcon = log.stage ? STAGE_ICONS[log.stage] ?? TerminalSquare : TerminalSquare;

  return (
    <div className={`log-line log-line-rich log-line-${tone}${compact ? " log-line-compact" : ""}`}>
      {!compact ? <span className="time">{formatClock(log.createdAt)}</span> : null}
      {stageLabel ? (
        <span className={`log-stage-icon log-stage-icon-${tone}`}>
          <StageIcon size={12} />
        </span>
      ) : null}
      {stageLabel ? <span className={`log-stage log-stage-${tone}`}>{stageLabel}</span> : null}
      <span className={`log-message ${tone}`}>{message}</span>
      {visibleMetricChips.length > 0 ? (
        <span className="log-chip-group">
          {visibleMetricChips.map((chip) => (
            <span key={chip.key} className="log-metric-chip">
              <strong>{chip.label}</strong>
              <span>{chip.value}</span>
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

function TrainingRawLine({
  log,
  formatClock,
}: {
  log: TrainingLogLine;
  formatClock: (timestampSeconds: number) => string;
}) {
  const tone = toneForLevel(log.level);

  return (
    <div className={`log-line log-line-raw log-line-${tone}`}>
      <span className="time">{formatClock(log.createdAt)}</span>
      <span className="log-raw-stream">{log.stream}</span>
      <span className={`log-raw-message ${tone}`}>{rawLogText(log)}</span>
    </div>
  );
}

export interface TrainingConsolePanelProps {
  logs: TrainingLogLine[];
  title: string;
  emptyLabel: string;
  formatClock: (timestampSeconds: number) => string;
  className?: string;
  style?: CSSProperties;
  maxLines?: number;
}

export default function TrainingConsolePanel({
  logs,
  title,
  emptyLabel,
  formatClock,
  className = "card terminal-card",
  style,
  maxLines,
}: TrainingConsolePanelProps) {
  const { t } = useI18n();
  const [showRawFeed, setShowRawFeed] = useState(false);
  const richLogRef = useRef<HTMLDivElement>(null);
  const rawLogRef = useRef<HTMLDivElement>(null);
  const { rich: richLogs, raw: rawLogs } = useMemo(() => splitTrainingLogs(logs), [logs]);
  const visibleRichLogs = useMemo(
    () => (maxLines ? richLogs.slice(-maxLines) : richLogs),
    [maxLines, richLogs],
  );
  const visibleRawLogs = useMemo(
    () => rawLogs.slice(-(maxLines ? Math.max(maxLines, 32) : 80)),
    [maxLines, rawLogs],
  );
  const emptyStateLabel =
    visibleRawLogs.length > 0 ? t("training.console.awaitingCurated") : emptyLabel;

  useEffect(() => {
    richLogRef.current?.scrollTo({ top: richLogRef.current.scrollHeight });
  }, [visibleRichLogs]);

  useEffect(() => {
    if (showRawFeed) {
      rawLogRef.current?.scrollTo({ top: rawLogRef.current.scrollHeight });
    }
  }, [showRawFeed, visibleRawLogs]);

  return (
    <div className={className} style={style}>
      <div
        className="card-header"
        style={{ borderBottom: "none", marginBottom: 0, paddingBottom: 0 }}
      >
        <span className="card-title-icon">
          <TerminalSquare size={18} /> {title}
        </span>
        <span className="terminal-feed-stats">
          <span className="terminal-feed-pill">{t("training.console.richFeedCount", { count: richLogs.length })}</span>
          {rawLogs.length > 0 ? (
            <span className="terminal-feed-pill terminal-feed-pill-muted">
              {t("training.console.rawFeedCount", { count: rawLogs.length })}
            </span>
          ) : null}
        </span>
      </div>
      <div className="terminal-content-wrapper">
        <div className="terminal-content terminal-rich-feed" ref={richLogRef}>
          {visibleRichLogs.length > 0 ? (
            visibleRichLogs.map((log, index) => (
              <TrainingConsoleLine
                key={`${log.seq}-${log.createdAt}-${index}`}
                log={log}
                formatClock={formatClock}
              />
            ))
          ) : (
            <div className="log-line">
              <span className="time">--:--:--</span> <span className="info">{emptyStateLabel}</span>
            </div>
          )}
        </div>
      </div>
      {visibleRawLogs.length > 0 ? (
        <div className={`raw-feed-shell${showRawFeed ? " open" : ""}`}>
          <button
            type="button"
            className="raw-feed-toggle"
            onClick={() => setShowRawFeed((current) => !current)}
          >
            <span className="raw-feed-toggle-copy">
              <Bug size={14} />
              {showRawFeed ? t("training.console.hideRawFeed") : t("training.console.showRawFeed")}
            </span>
            <span className="raw-feed-toggle-meta">
              {t("training.console.diagnosticFeedCount", { count: visibleRawLogs.length })}
            </span>
            <ChevronDown size={14} className="raw-feed-toggle-icon" />
          </button>
          {showRawFeed ? (
            <div className="raw-feed-panel">
              <div className="terminal-content raw-feed-content" ref={rawLogRef}>
                {visibleRawLogs.map((log, index) => (
                  <TrainingRawLine
                    key={`${log.seq}-${log.createdAt}-${index}-raw`}
                    log={log}
                    formatClock={formatClock}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
