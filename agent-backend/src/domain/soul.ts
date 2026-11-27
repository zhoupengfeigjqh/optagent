import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { agentDir } from './dirs.js';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export type SoulToolRef =
  { kind: 'builtin'; name: string } | { kind: 'mcp'; service: string; name: string };

export interface SoulStarter {
  prompt: string;
  tools: SoulToolRef[];
}

export const NEXT_ACTION_HINTS_MIN = 1;
export const NEXT_ACTION_HINTS_MAX = 6;
export const NEXT_ACTION_HINTS_DEFAULT = 3;

export const INTENT_FOCUS_DEPTH_MIN = 0;
export const INTENT_FOCUS_DEPTH_MAX = 2;
export const INTENT_FOCUS_DEPTH_DEFAULT = 0;

export interface SoulMeta {
  intro: string;
  welcome: string;
  starters: SoulStarter[];
  /**
   * 007：是否开启「下一步动作提示」（frontmatter `next_action_hints`）。
   *
   * 与其它字段的关键差异：它是**功能开关**而非展示数据，故缺省口径是 `false`
   * （fail-closed：写错类型就关闭功能，不会因为一个笔误让数字人额外发起模型调用）。
   */
  nextActionHints: boolean;
  nextActionHintsCount: number;
  intentFocus: boolean;
  intentFocusDepth: number;
  /**
   * 027：是否开启「输入重写」（frontmatter `input_rewrite`）。
   *
   * 与 `intentFocus` 是**逻辑与**关系：平台仅在两个开关皆真时才写该键，
   * 运行侧仍按 fail-closed 读（缺键 / 非布尔 → `false`）。
   * 它是"是否多花一次模型调用"的开关，读不出来必须收敛到关。
   */
  inputRewrite: boolean;
  termNormalize: boolean;
  /**
   * 028：是否开启「任务规划」（frontmatter `task_planning`）。
   *
   * 与 `intentFocus` 是**逻辑与**关系：任一方为假即零规划调用。
   * 同样 fail-closed（缺键 / 非布尔 → `false`），因为多开一次规划就是多一次模型往返。
   */
  taskPlanning: boolean;
}

/** 空值工厂（每次返回新对象，避免调用方误改共享引用）。 */
export function emptySoulMeta(): SoulMeta {
  return {
    intro: '',
    welcome: '',
    starters: [],
    nextActionHints: false,
    nextActionHintsCount: NEXT_ACTION_HINTS_DEFAULT,
    intentFocus: false,
    intentFocusDepth: INTENT_FOCUS_DEPTH_DEFAULT,
    inputRewrite: false,
    termNormalize: false,
    taskPlanning: false,
  };
}

export function stripFrontmatter(raw: string): string {
  const match = FRONTMATTER_RE.exec(raw);
  return match ? raw.slice(match[0].length) : raw;
}

export function parseSoulMeta(raw: string): SoulMeta {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return emptySoulMeta();

  let data: unknown;
  try {
    data = parseYaml(match[1]!);
  } catch {
    return emptySoulMeta();
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return emptySoulMeta();
  }

  const record = data as Record<string, unknown>;
  return {
    intro: readText(record.intro),
    welcome: readText(record.welcome),
    starters: readStarters(record.starters),
    nextActionHints: record.next_action_hints === true,
    nextActionHintsCount: readHintCount(record.next_action_hints_count),
    intentFocus: record.intent_focus === true,
    intentFocusDepth: readDepth(record.intent_focus_depth),
    inputRewrite: record.input_rewrite === true,
    termNormalize: record.term_normalize === true,
    taskPlanning: record.task_planning === true,
  };
}

function readSoulField<T>(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  pick: (meta: SoulMeta) => T,
  fallback: T,
  failureLabel: string,
  logger?: { warn(msg: string): void },
): T {
  try {
    const raw = fs.readFileSync(
      path.join(agentDir(optAgentRoot, userId, agentName), 'SOUL.md'),
      'utf8',
    );
    return pick(parseSoulMeta(raw));
  } catch (err) {
    logger?.warn(
      `${failureLabel}（user=${userId} agent=${agentName}）：${err instanceof Error ? err.message : String(err)}`,
    );
    return fallback;
  }
}

export function isNextActionsEnabled(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  logger?: { warn(msg: string): void },
): boolean {
  return readSoulField(
    optAgentRoot,
    userId,
    agentName,
    (meta) => meta.nextActionHints,
    false,
    '读取数字人开关失败按关闭处理',
    logger,
  );
}

export function isIntentFocusEnabled(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  logger?: { warn(msg: string): void },
): boolean {
  return readSoulField(
    optAgentRoot,
    userId,
    agentName,
    (meta) => meta.intentFocus,
    false,
    '读取意图聚焦开关失败按关闭处理',
    logger,
  );
}

export function isInputRewriteEnabled(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  logger?: { warn(msg: string): void },
): boolean {
  return readSoulField(
    optAgentRoot,
    userId,
    agentName,
    (meta) => meta.inputRewrite,
    false,
    '读取输入重写开关失败按关闭处理',
    logger,
  );
}

export function isTermNormalizeEnabled(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  logger?: { warn(msg: string): void },
): boolean {
  return readSoulField(
    optAgentRoot,
    userId,
    agentName,
    (meta) => meta.termNormalize,
    false,
    '读取术语替换开关失败按关闭处理',
    logger,
  );
}

export function isTaskPlanningEnabled(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  logger?: { warn(msg: string): void },
): boolean {
  return readSoulField(
    optAgentRoot,
    userId,
    agentName,
    (meta) => meta.taskPlanning && meta.intentFocus,
    false,
    '读取任务规划开关失败按关闭处理',
    logger,
  );
}

export function intentFocusDepth(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  logger?: { warn(msg: string): void },
): number {
  return readSoulField(
    optAgentRoot,
    userId,
    agentName,
    (meta) => meta.intentFocusDepth,
    INTENT_FOCUS_DEPTH_DEFAULT,
    `读取聚焦阶数失败按缺省 ${INTENT_FOCUS_DEPTH_DEFAULT} 处理`,
    logger,
  );
}

/**
 * 007：读取某数字人「每轮最多几条下一步动作提示」。
 *
 * 与开关的**失败口径刻意不同**：读不出来时返回缺省 3，而不是 0——
 * 条数只是"生成几条"的上限，只有开关才是非开即关的硬判据。
 */
export function nextActionHintsCount(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  logger?: { warn(msg: string): void },
): number {
  return readSoulField(
    optAgentRoot,
    userId,
    agentName,
    (meta) => meta.nextActionHintsCount,
    NEXT_ACTION_HINTS_DEFAULT,
    `读取数字人提示条数失败按缺省 ${NEXT_ACTION_HINTS_DEFAULT} 处理`,
    logger,
  );
}

/**
 * 工具**暴露给模型**的名字。
 *
 * 与 `infra/mcp/mcp-tool-adapter.ts:120` 的命名规则同口径：MCP 工具带服务前缀
 * `{server}__{tool}`（避免多服务重名），内置工具即目录中的 `name`。
 * 引导文本必须写"模型实际看到的工具名"，否则模型对不上工具表。
 */
export function toolExposedName(tool: SoulToolRef): string {
  return tool.kind === 'builtin' ? tool.name : `${tool.service}__${tool.name}`;
}

export function parseExposedName(exposed: string): SoulToolRef {
  const name = exposed.trim();
  const sep = name.indexOf('__');
  if (sep <= 0 || sep >= name.length - 2) return { kind: 'builtin', name };
  return { kind: 'mcp', service: name.slice(0, sep), name: name.slice(sep + 2) };
}

/**
 * 生成问题实例的**隐藏工具引导**（经请求级 `systemExtra` 注入本轮系统提示词，
 * 不改动用户消息正文，故对用户不可见）。
 *
 * 无关联工具时返回空串——调用方据此不下发该字段（避免空引导占用 token）。
 */
export function buildStarterGuidance(tools: readonly SoulToolRef[]): string {
  if (tools.length === 0) return '';
  const names = tools.map(toolExposedName);
  return `本轮请优先使用以下工具完成任务：${names.join('、')}`;
}


function readText(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * 提示条数：**收敛式**读取（与 `parseSoulMeta` 的其它容错字段同口径）。
 *
 * 平台侧（`normalizeSoulDesign`）是拒绝式——非法值根本存不下去；这里面对的是
 * 磁盘上可能被人手改过的文件，收敛到缺省比抛错或取 0 都更符合"少给建议也不能多花 token"。
 */
function readHintCount(raw: unknown): number {
  if (
    typeof raw === 'number' &&
    Number.isInteger(raw) &&
    raw >= NEXT_ACTION_HINTS_MIN &&
    raw <= NEXT_ACTION_HINTS_MAX
  ) {
    return raw;
  }
  return NEXT_ACTION_HINTS_DEFAULT;
}

/**
 * 聚焦阶数：**收敛式**读取（与 `readHintCount` 同口径）。
 *
 * 平台侧是拒绝式（越界值存不下去）；这里面对磁盘上可能被手改的文件，
 * 收敛到 0（不发散）比抛错或放大都安全——阶数只影响"多带几条上下文"，
 * 读错时宁可退回 016 的既有行为。
 */
function readDepth(raw: unknown): number {
  if (
    typeof raw === 'number' &&
    Number.isInteger(raw) &&
    raw >= INTENT_FOCUS_DEPTH_MIN &&
    raw <= INTENT_FOCUS_DEPTH_MAX
  ) {
    return raw;
  }
  return INTENT_FOCUS_DEPTH_DEFAULT;
}

function readStarters(raw: unknown): SoulStarter[] {
  if (!Array.isArray(raw)) return [];
  const starters: SoulStarter[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const prompt = readText(record.prompt);
    if (prompt === '') continue;
    starters.push({ prompt, tools: readTools(record.tools) });
  }
  return starters;
}

function readTools(raw: unknown): SoulToolRef[] {
  if (!Array.isArray(raw)) return [];
  const tools: SoulToolRef[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const name = readText(record.name);
    if (name === '') continue;
    if (record.kind === 'builtin') {
      tools.push({ kind: 'builtin', name });
      continue;
    }
    if (record.kind === 'mcp') {
      const service = readText(record.service);
      if (service === '') continue;
      tools.push({ kind: 'mcp', service, name });
    }
  }
  return tools;
}
