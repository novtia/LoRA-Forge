export function formatApiLogTime(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString(undefined, {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return fallback;
}

export function isCaptionCancelledError(error: unknown): boolean {
  return /LLM caption cancelled/i.test(getErrorMessage(error, ""));
}

/** 1-based image indices, inclusive; clamped to [1, total]. Returns null if input cannot be interpreted. */
export function parseBatchImageRange(
  raw: string,
  total: number,
): { start: number; end: number } | null {
  if (total <= 0) return null;
  const s = raw.trim();
  if (!s) return null;

  const full = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (full) {
    let a = parseInt(full[1], 10);
    let b = parseInt(full[2], 10);
    if (a > b) [a, b] = [b, a];
    const start = Math.max(1, Math.min(a, total));
    const end = Math.max(1, Math.min(b, total));
    return start <= end ? { start, end } : { start: end, end: start };
  }

  const startOpen = s.match(/^(\d+)\s*-\s*$/);
  if (startOpen) {
    const a = Math.max(1, Math.min(parseInt(startOpen[1], 10), total));
    return { start: a, end: total };
  }

  const endOpen = s.match(/^-\s*(\d+)$/);
  if (endOpen) {
    const b = Math.max(1, Math.min(parseInt(endOpen[1], 10), total));
    return { start: 1, end: b };
  }

  const single = s.match(/^(\d+)$/);
  if (single) {
    const i = Math.max(1, Math.min(parseInt(single[1], 10), total));
    return { start: i, end: i };
  }

  return null;
}

/**
 * Parses the raw user-entered position string into a normalized insertion index.
 *
 * The returned index is the slot (0-based) where the trigger should be inserted into the
 * tag list, so the resulting tag becomes the (index+1)-th tag.
 *
 * Rules:
 * - Empty / non-numeric / `0` / negative-but-not -1 → `0` (front).
 * - Positive integer `N` → `N` (insert after the N-th existing tag).
 * - `-1` → `Number.POSITIVE_INFINITY`, which the caller clamps to the tag count (append).
 *
 * The infinity sentinel keeps the call sites branch-free: they simply `Math.min` against
 * `parts.length` to land at the end without an extra special case.
 */
export function parseTriggerWordPosition(raw: string): number {
  const s = raw.trim();
  if (!s) return 0;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return 0;
  if (n === -1) return Number.POSITIVE_INFINITY;
  if (n <= 0) return 0;
  return n;
}

/**
 * Splits a comma/ideographic-comma-separated caption into trimmed, non-empty tags.
 * Mirrors the split used by `buildCaptionWithTriggerAt` so previews stay in sync with writes.
 */
export function splitCaptionTagsForPreview(caption: string): string[] {
  const trimmed = caption.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Resolves the displayed insertion slot (0..tags.length) from the raw user input
 * and the tag count of the current caption. Mirrors the semantics of
 * `parseTriggerWordPosition` + `Math.min(parts.length, …)` used by the writer,
 * so the preview lines up exactly with what would be written.
 */
export function resolveTriggerInsertSlot(raw: string, tagCount: number): number {
  const idx = parseTriggerWordPosition(raw);
  if (!Number.isFinite(idx)) return tagCount;
  return Math.max(0, Math.min(idx, tagCount));
}

/**
 * Returns new caption text, or null if `tw` already occupies the resolved insertion slot.
 *
 * `positionIndex` is the 0-based slot in the comma-separated tag list where the trigger
 * should land (so `0` means "front" and `parts.length` means "end"). When the caption is
 * empty the trigger is returned as-is regardless of `positionIndex`.
 */
export function buildCaptionWithTriggerAt(
  existingTrimmed: string,
  tw: string,
  positionIndex: number,
): string | null {
  if (!tw) return null;
  if (!existingTrimmed) {
    return tw;
  }
  const parts = existingTrimmed.split(/[,，]/).map((s) => s.trim());
  const insertAt = Math.max(0, Math.min(positionIndex, parts.length));
  if ((parts[insertAt] ?? "") === tw) {
    return null;
  }
  const next = [...parts.slice(0, insertAt), tw, ...parts.slice(insertAt)];
  return next.filter((segment) => segment.length > 0).join(", ");
}

/**
 * Removes every comma/ideographic-comma–separated segment that exactly equals `tw` (after trim).
 * Returns null if the trigger does not appear as its own tag (file unchanged).
 */
export function removeTriggerWordFromCaptionAllSegments(
  existingTrimmed: string,
  tw: string,
): string | null {
  if (!tw || !existingTrimmed) {
    return null;
  }
  const parts = existingTrimmed.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  const filtered = parts.filter((segment) => segment !== tw);
  if (filtered.length === parts.length) {
    return null;
  }
  return filtered.join(", ");
}
