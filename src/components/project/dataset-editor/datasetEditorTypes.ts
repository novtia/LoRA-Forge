export type BatchProgress = {
  /** 1-based position in batch (currently running) */
  current: number;
  total: number;
  currentName: string;
  relativePath: string;
};
