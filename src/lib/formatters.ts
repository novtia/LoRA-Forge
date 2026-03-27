import type { JobStatus, ProjectRecord, ProjectStatus } from "./types";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 MB";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  const fixed = size >= 100 || index === 0 ? 0 : 1;
  return `${size.toFixed(fixed)}${units[index]}`;
}

export function formatRelativeTime(timestamp: number): string {
  const diffSeconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (diffSeconds < 3600) {
    return `${Math.max(1, Math.floor(diffSeconds / 60) || 1)} MIN AGO`;
  }
  if (diffSeconds < 86400) {
    return `${Math.floor(diffSeconds / 3600)} HRS AGO`;
  }
  if (diffSeconds < 604800) {
    return `${Math.floor(diffSeconds / 86400)} DAYS AGO`;
  }
  return `${Math.floor(diffSeconds / 604800)} WKS AGO`;
}

export function formatTimer(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export function statusLabel(status: ProjectStatus | JobStatus): string {
  switch (status) {
    case "running":
      return "TRAINING";
    case "paused":
      return "PAUSED";
    case "completed":
      return "COMPLETE";
    case "error":
    case "failed":
      return "ERROR";
    case "interrupted":
      return "INTERRUPTED";
    case "aborted":
      return "ABORTED";
    default:
      return "READY";
  }
}

export function projectAccent(project: ProjectRecord, index: number): string {
  if (project.status === "error" || project.status === "aborted") {
    return "card-orange";
  }
  return index % 2 === 1 ? "card-white" : "";
}

export function canResume(status: JobStatus | ProjectStatus | undefined): boolean {
  return status === "paused";
}

export function canAbort(status: JobStatus | ProjectStatus | undefined): boolean {
  return status === "running" || status === "paused";
}
