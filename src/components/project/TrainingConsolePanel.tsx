import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { TerminalSquare } from "lucide-react";
import type { TrainingLogLine } from "../../lib/types";

function toneForLevel(level: string) {
  const normalized = level.toLowerCase();
  if (normalized === "warning") return "warn";
  if (normalized === "completed") return "success";
  if (normalized === "failed") return "error";
  return normalized;
}

export function trainingLogPlainText(log: TrainingLogLine) {
  const text = log.rawLine ?? log.line ?? log.message ?? "";
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : "(empty)";
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
  const tone = toneForLevel(log.level);
  const body = trainingLogPlainText(log);

  if (compact) {
    return (
      <div className={`log-line log-line-raw log-line-${tone} log-line-compact`}>
        <span className={`log-raw-message ${tone}`}>{body}</span>
      </div>
    );
  }

  return (
    <div className={`log-line log-line-raw log-line-${tone}`}>
      <span className="time">{formatClock(log.createdAt)}</span>
      <span className="log-raw-stream">{log.stream}</span>
      <span className={`log-raw-message ${tone}`}>{body}</span>
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
  const logRef = useRef<HTMLDivElement>(null);
  const visibleLogs = useMemo(() => (maxLines ? logs.slice(-maxLines) : logs), [logs, maxLines]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [visibleLogs]);

  return (
    <div className={className} style={style}>
      <div
        className="card-header"
        style={{ borderBottom: "none", marginBottom: 0, paddingBottom: 0 }}
      >
        <span className="card-title-icon">
          <TerminalSquare size={18} /> {title}
        </span>
      </div>
      <div className="terminal-content-wrapper">
        <div className="terminal-content" ref={logRef}>
          {visibleLogs.length > 0 ? (
            visibleLogs.map((log, index) => (
              <TrainingConsoleLine
                key={`${log.seq}-${log.createdAt}-${index}`}
                log={log}
                formatClock={formatClock}
              />
            ))
          ) : (
            <div className="log-line">
              <span className="time">--:--:--</span> <span className="info">{emptyLabel}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
