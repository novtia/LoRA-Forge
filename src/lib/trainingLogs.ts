import type { ActiveJobSummary, TrainingLogLine } from "./types";

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

export function normalizeActiveJobLogs(job: ActiveJobSummary | null) {
  if (!job) return job;
  return {
    ...job,
    recentLogs: dedupeTrainingLogs(job.recentLogs),
  };
}
