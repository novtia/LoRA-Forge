/** SD 风格标签：英文逗号或全角逗号分隔（与打标页一致） */
export function splitCaptionTags(raw: string): string[] {
  return raw
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export type CommaSegmentSpan = { start: number; end: number; content: string };

/**
 * 在原始字符串中标出每个「逗号分隔片段」的起止（trim 后内容，索引对应可视字符）。
 * 用于将 textarea 内选区映射到第几个标签。
 */
export function commaSegmentSpans(text: string): CommaSegmentSpan[] {
  const out: CommaSegmentSpan[] = [];
  const re = /[^,，]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const trimmed = raw.trim();
    if (!trimmed.length) {
      continue;
    }
    const lead = raw.length - raw.trimStart().length;
    const start = m.index + lead;
    const end = start + trimmed.length;
    out.push({ start, end, content: trimmed });
  }
  return out;
}

/**
 * 选区必须落在「连续若干整段标签」上（不能只隔段选中 0 与 2 而跳过 1）。
 * 若选区仅触及某段的一部分，仍视为覆盖这些段（与译文子串一起译回后整段替换）。
 */
export function contiguousTagRangeForSelection(
  text: string,
  selStart: number,
  selEnd: number,
): { lo: number; hi: number } | null {
  const spans = commaSegmentSpans(text);
  if (!spans.length) {
    return null;
  }
  const a = Math.min(selStart, selEnd);
  const b = Math.max(selStart, selEnd);
  if (a === b) {
    return null;
  }
  const hit: number[] = [];
  for (let i = 0; i < spans.length; i++) {
    const { start, end } = spans[i];
    if (b > start && a < end) {
      hit.push(i);
    }
  }
  if (!hit.length) {
    return null;
  }
  const lo = hit[0];
  const hi = hit[hit.length - 1];
  if (hit.length !== hi - lo + 1) {
    return null;
  }
  return { lo, hi };
}

/** 连续片段标签下标 → 在原始字符串中的字符区间（含首尾字符）。 */
export function charRangeForContiguousTagIndices(
  text: string,
  lo: number,
  hi: number,
): { start: number; end: number } | null {
  const spans = commaSegmentSpans(text);
  if (!spans.length || lo < 0 || hi >= spans.length || lo > hi) {
    return null;
  }
  return { start: spans[lo].start, end: spans[hi].end };
}
