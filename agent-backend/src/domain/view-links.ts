/**
 * 工具结果里的「视图链接」抽取（002 特性：同步侧视图入口，2026-10-10）。
 *
 * 只做一件窄事：把工具结果**文本**里的 `viewUrl`（或配对的 `viewUrlName`）抬出来，
 * 变成随记录下发的 sidecar（`tool-events.jsonl` 的 `view_links`），供前端在
 * 「回答正文之后」渲染成可点入口。为什么这么做、而不是让模型在正文里转写，
 * 见 `specs/002-conversation-runtime/spec.md` §4.8（`TR-44`~`TR-48`）。
 *
 * 边界（都是刻意的，改之前先读完）：
 * - **只搬运，不生成**：不拼前缀（前缀 = 用户当前访问入口，只有浏览器知道，
 *   见前端 `frontend/src/utils/view-link.ts`）、不改写值、不补名称。名称是服务给的，
 *   没有就没有 —— 界面退回显示地址（`TR-46`）。
 * - **不做 scheme 合法性判定**：`//host/…`、无前导 `/`、`javascript:` 的合法性判定
 *   是前端 `resolveViewUrl()` 的**唯一**职责（`TR-42`）。这里再判一遍就是第二个漂移点：
 *   前端改了拒绝规则，记录里还留着按老规则挑出来的值。这里只做**形态卫生**。
 * - **失败一律 `undefined`**：不是 JSON / 不是对象或数组 / 超解析上限 / 一条都没命中
 *   → 不写字段，行为与改动前完全一致（前端不出现入口行）。降级不是异常，故不抛错、不打日志
 *   （宪章原则九：返回 `undefined` 表达"没有可识别的视图链接"，不是"出错了"）。
 * - **不落路径**：只存服务给的地址与名称（与外置正文同一条安全约定：数据里不含路径）。
 * - **不进 prompt**：sidecar 与结果正文分离存放，因此不挤占 `TOOL_REPLAY_BUDGET_BYTES`
 *   的回灌预算（`tool-context.ts`）。
 */
/** 视图地址字段名（判定大小写不敏感）。 */
export const VIEW_URL_FIELD = 'viewUrl';
/** 视图名称字段名（可选；MUST 与它命名的 `viewUrl` 同层）。 */
export const VIEW_URL_NAME_FIELD = 'viewUrlName';

/**
 * 单条记录的视图链接：
 * - `url` 是服务给的**原值**（未拼前缀、未归一化）
 * - `name` 缺省 = 服务没给名字（不是 `''` / `null` —— 少一种状态就少一类误判）
 */
export interface ViewLink {
  url: string;
  name?: string;
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
/**
 * 超过该**字符数**的结果文本不尝试解析。
 *
 * 与前端结构化展示同一判据（`parseProducedContent` 的 256K），保持两侧口径一致：
 * "这条结果太大，不解析"在两处是同一个数，用户在界面上的观感也一致（无入口）。
 */
export const VIEW_LINK_PARSE_MAX_CHARS = 256 * 1024;
/** 递归深度上限（与正文结构化渲染同判据，防病态深链）。 */
export const VIEW_LINK_MAX_DEPTH = 8;

/**
 * 从工具结果文本里抽取视图链接。
 *
 * 判据与顺序（确定性）：
 * 1. 文本超 `VIEW_LINK_PARSE_MAX_CHARS` → 不解析，返回 `undefined`；
 * 2. 不是合法 JSON、或不是对象/数组 → `undefined`；
 * 3. 深度 ≤ `VIEW_LINK_MAX_DEPTH` 递归；某层键名命中 `viewUrl` 且值是字符串 → 收起一条，
 *    并在**同一对象内**找 `viewUrlName` 配对（跨层配不上 → 视同没给名字）；
 * 4. 形态卫生：地址 trim 后非空、≤ `VIEW_URL_MAX_CHARS`、无控制字符或反斜杠；
 *    名称同规则（超长/含控制字符 → **丢掉名字、保留地址**，不因名字脏而丢地址）；
 * 5. **按地址原值去重**（首次出现者胜）；同一地址重复出现时**名称取首个非空值**
 *    （第一次没给、第二次给了，就用后面那个 —— 顺着"出现顺序固定则结果固定"的确定性）；
 * 6. 条数上限 `VIEW_LINK_MAX_ITEMS`，达到后不再收新地址（已在表里的仍可补名字）。
 *
 * 返回 `undefined` = 没有任何可识别的视图链接（调用方据此不写 `view_links` 字段）。
 */
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

  /** 深度优先遍历；命中地址即收起，命中名称字段由 `collect` 在同层配对时消费 */
  function walk(node: unknown, depth: number, out: Map<string, ViewLink>): void {
    if (depth > VIEW_LINK_MAX_DEPTH) return;

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1, out);
      return;
    }
    if (!isRecord(node)) return;

    for (const [key, value] of Object.entries(node)) {
      if (fieldMatches(key, VIEW_URL_FIELD)) {
        collect(value, node, out);
        continue;
      }
      walk(value, depth + 1, out);
    }
  }

  /** 同层配对：地址在外层已确认命中，名称在**同一个对象**里找 */
  function collect(
    urlValue: unknown,
    sibling: Record<string, unknown>,
    out: Map<string, ViewLink>,
  ): void {
    const url = sanitizeString(urlValue, VIEW_URL_MAX_CHARS);
    if (url === undefined) return;

    const existing = out.get(url);
    const name = nameOf(sibling);

    if (existing) {
      // 同名地址再次出现：只补名字，不重复收
      if (existing.name === undefined && name !== undefined) existing.name = name;
      return;
    }
    if (out.size >= VIEW_LINK_MAX_ITEMS) return;

    out.set(url, name === undefined ? { url } : { url, name });
  }
}

/** 同一个对象里找配对的名称（大小写不敏感；形态不合格 = 视同没给）。 */
function nameOf(sibling: Record<string, unknown>): string | undefined {
  for (const [key, value] of Object.entries(sibling)) {
    if (!fieldMatches(key, VIEW_URL_NAME_FIELD)) continue;
    return sanitizeString(value, VIEW_URL_NAME_MAX_CHARS);
  }
  return undefined;
}

/**
 * 字符串卫生：非字符串 / trim 后为空 / 超长 / 含控制字符或反斜杠 → `undefined`。
 *
 * 反斜杠与控制字符在地址与名称里都没有合法用途，且是常见的绕过手法
 * （如用制表符骗过前缀判断）。用显式码点判断而非正则：控制字符正则会被
 * `no-control-regex` 规则挡住，而该规则的意图与本函数重合，没有理由为它禁用规则。
 */
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

/** 字段名判定：只看名字（大小写不敏感、忽略首尾空白），不看值像不像地址。 */
function fieldMatches(key: string, field: string): boolean {
  return key.trim().toLowerCase() === field.toLowerCase();
}

/** 对象或数组（`null` 不算）。 */
function isContainer(value: unknown): boolean {
  return Array.isArray(value) || isRecord(value);
}

/** 普通对象（数组与 `null` 都不算）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
