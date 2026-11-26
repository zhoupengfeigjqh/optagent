export const VIEW_URL_FIELD = 'viewUrl';
export const VIEW_URL_NAME_FIELD = 'viewUrlName';
export const FILE_PATH_FIELD = 'filePath';
export const FILE_PATH_NAME_FIELD = 'filePathName';

export interface ViewLink {
  url: string;
  name?: string;
  kind?: 'url' | 'file';
}

/**
 * 单次结果最多抽取几条（**防病态**上限，不是展示上限）。
 *
 * 展示上限在前端（显示前 3 个 + 「另有 N 个」）。这里只防"某次结果返回上千条"
 * 把 JSONL 那一行撑爆。
 */
export const VIEW_LINK_MAX_ITEMS = 50;
/** 单个地址的字符上限（超出视为脏数据，丢弃该条）。 */
export const VIEW_URL_MAX_CHARS = 2048;
/** 单个名称的字符上限（超出视为脏数据，**只丢名字、留地址**）。 */
export const VIEW_URL_NAME_MAX_CHARS = 120;
export const VIEW_LINK_PARSE_MAX_CHARS = 256 * 1024;
/** 递归深度上限（与正文结构化渲染同判据，防病态深链）。 */
export const VIEW_LINK_MAX_DEPTH = 8;

export function extractViewLinks(resultText: string): ViewLink[] | undefined {
  if (resultText.length === 0 || resultText.length > VIEW_LINK_PARSE_MAX_CHARS) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(resultText);
  } catch {
    return undefined;
  }
  if (!isContainer(parsed)) return undefined;

  const collected = new Map<string, ViewLink>();
  walk(parsed, 0, collected);
  return collected.size > 0 ? [...collected.values()] : undefined;

  function walk(node: unknown, depth: number, out: Map<string, ViewLink>): void {
    if (depth > VIEW_LINK_MAX_DEPTH) return;

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1, out);
      return;
    }
    if (!isRecord(node)) return;

    for (const [key, value] of Object.entries(node)) {
      if (fieldMatches(key, VIEW_URL_FIELD)) {
        collect(value, node, out, VIEW_URL_NAME_FIELD, 'url');
        continue;
      }
      if (fieldMatches(key, FILE_PATH_FIELD)) {
        collect(value, node, out, FILE_PATH_NAME_FIELD, 'file');
        continue;
      }
      walk(value, depth + 1, out);
    }
  }

  /**
   * 同层配对：值在外层已确认命中，名称在**同一个对象**里按 `nameField` 找。
   *
   * 去重键 = `kind` + 原值：外部地址与文件路径各按自己的命名空间去重，
   * 避免两处恰好同值被误并成一条。
   */
  function collect(
    rawValue: unknown,
    sibling: Record<string, unknown>,
    out: Map<string, ViewLink>,
    nameField: string,
    kind: 'url' | 'file',
  ): void {
    const url = sanitizeString(rawValue, VIEW_URL_MAX_CHARS);
    if (url === undefined) return;

    const key = `${kind}\u0000${url}`;
    const existing = out.get(key);
    const name = nameOf(sibling, nameField);

    if (existing) {
      if (existing.name === undefined && name !== undefined) existing.name = name;
      return;
    }
    if (out.size >= VIEW_LINK_MAX_ITEMS) return;

    const entry: ViewLink = kind === 'file' ? { url, kind } : { url };
    out.set(key, name === undefined ? entry : { ...entry, name });
  }
}

function nameOf(sibling: Record<string, unknown>, nameField: string): string | undefined {
  for (const [key, value] of Object.entries(sibling)) {
    if (!fieldMatches(key, nameField)) continue;
    return sanitizeString(value, VIEW_URL_NAME_MAX_CHARS);
  }
  return undefined;
}

function sanitizeString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > maxChars) return undefined;
  for (const char of trimmed) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || char === '\\') return undefined;
  }
  return trimmed;
}

function fieldMatches(key: string, field: string): boolean {
  return key.trim().toLowerCase() === field.toLowerCase();
}

function isContainer(value: unknown): boolean {
  return Array.isArray(value) || isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
