/**
 * Auto-discovery of built-in system-prompt presets from the `prompts/` folder.
 *
 * Every `*.md` file under `frontend/prompts/` becomes a selectable preset. The
 * preset's display name comes from a small frontmatter block at the top of the
 * file, so adding a new markdown doc automatically adds a new preset — no code
 * change required.
 *
 * Supported frontmatter (fence may be 3+ dashes, e.g. `---` or `----`):
 *
 *   ---
 *   name: 显示名称
 *   description: 简短描述（可选）
 *   order: 10
 *   ---
 *   <markdown body...>
 */

const rawPromptModules = import.meta.glob("../../prompts/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const PROMPT_DOC_ID_PREFIX = "doc:";

export interface PromptDoc {
  /** Stable id used as the preset selection value, e.g. `doc:system-prompt.en`. */
  id: string;
  /** File name without extension, e.g. `system-prompt.en`. */
  fileName: string;
  /** Display name from frontmatter `name`, falling back to the file name. */
  name: string;
  /** Optional description from frontmatter `description`. */
  description: string;
  /** Markdown body with the frontmatter block stripped, trimmed. */
  body: string;
  /** Sort weight from frontmatter `order` (lower comes first; default 1000). */
  order: number;
}

interface ParsedFrontmatter {
  data: Record<string, string>;
  body: string;
}

function parseFrontmatter(raw: string): ParsedFrontmatter {
  const text = raw.replace(/^\uFEFF/, "");
  // Opening fence must be the very first line; closing fence is the next
  // dashes-only line. Both accept 3+ dashes so `----` keeps working too.
  const match = text.match(/^-{3,}[ \t]*\r?\n([\s\S]*?)\r?\n-{3,}[ \t]*(?:\r?\n|$)/);
  if (!match) {
    return { data: {}, body: text.trim() };
  }
  const data: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2].trim().replace(/^["']|["']$/g, "");
    data[key] = value;
  }
  const body = text.slice(match[0].length).trim();
  return { data, body };
}

function fileNameFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "");
}

export const PROMPT_DOCS: PromptDoc[] = Object.entries(rawPromptModules)
  .map(([path, raw]) => {
    const fileName = fileNameFromPath(path);
    const { data, body } = parseFrontmatter(raw);
    const orderValue = data.order !== undefined ? Number(data.order) : Number.NaN;
    return {
      id: `${PROMPT_DOC_ID_PREFIX}${fileName}`,
      fileName,
      name: data.name?.trim() || fileName,
      description: data.description?.trim() ?? "",
      body,
      order: Number.isFinite(orderValue) ? orderValue : 1000,
    } satisfies PromptDoc;
  })
  .sort((a, b) => a.order - b.order || a.fileName.localeCompare(b.fileName));

export function isPromptDocId(id: string | null | undefined): id is string {
  return typeof id === "string" && id.startsWith(PROMPT_DOC_ID_PREFIX);
}

export function getPromptDocById(id: string): PromptDoc | undefined {
  return PROMPT_DOCS.find((doc) => doc.id === id);
}

export function getPromptDocByFileName(fileName: string): PromptDoc | undefined {
  return PROMPT_DOCS.find((doc) => doc.fileName === fileName);
}

export function findPromptDocByBody(body: string): PromptDoc | undefined {
  const trimmed = body.trim();
  if (!trimmed) return undefined;
  return PROMPT_DOCS.find((doc) => doc.body === trimmed);
}
