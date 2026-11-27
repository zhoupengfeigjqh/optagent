import fs from 'node:fs';
import path from 'node:path';
import { threadDir } from './dirs.js';
import { removeFileSafe } from './fs-safe.js';
import type { FocusToolTip } from './intent-focus/types.js';
import { NEXT_ACTION_HINTS_DEFAULT } from './soul.js';

/** 卡片提示词长度上限（FR-003） */
export const PROMPT_MAX_CHARS = 50;

/**
 * 单张卡片的 `tool_tips` 条数上限。
 *
 * 这是**唯一**对 `tool_tips` 施加的处理：超出直接截断，不检查来源、不比对运行时工具、
 * 不改写字段值、不因字段缺失丢条目。
 */
export const MAX_TOOL_TIPS_PER_ACTION = 5;
/**
 * 单轮卡片条数上限（FR-004）。
 *
 * 这是**缺省上限**：数字人可在 SOUL.md frontmatter 用 `next_action_hints_count`
 * （1~6）把它压得更低或抬高，运行时经装配层逐数字人注入。
 */
export const MAX_ACTIONS = NEXT_ACTION_HINTS_DEFAULT;
/** 快照文件大小上限：超限视为损坏（脏文件防护） */
const SNAPSHOT_MAX_BYTES = 64 * 1024;

export interface NextAction {
  prompt: string;
  tool_tips: FocusToolTip[];
}

export interface NextActionsSnapshot {
  message_id: string;
  agent_name: string;
  created_at: string;
  actions: NextAction[];
}

export interface NextActionsView {
  message_id: string;
  actions: NextAction[];
}

export interface NextActionsFinalizeInput {
  userId: string;
  threadId: string;
  messageId: string;
  agentName: string;
  tailText: string;
  focusToolTips: readonly FocusToolTip[];
  /** 条数上限（与提示词装配同源的 SOUL 配置） */
  max: number;
}

export interface NextActionsDeps {
  logger?: { warn(msg: string): void };
}

export class NextActionsStore {
  constructor(
    private readonly root: string,
    private readonly deps: NextActionsDeps,
  ) {}

  private filePath(userId: string, agentName: string, threadId: string): string {
    return path.join(threadDir(this.root, userId, agentName, threadId), 'next-actions.json');
  }

  clear(userId: string, agentName: string, threadId: string): void {
    this.remove(this.filePath(userId, agentName, threadId));
  }

  finalize(input: NextActionsFinalizeInput): NextActionsView | undefined {
    const text = input.tailText.trim();
    if (text === '') return undefined;
    const raw = parseActions(text);
    if (raw.length === 0) {
      if (!isExplicitEmpty(text)) {
        this.warn(
          input.userId,
          input.threadId,
          `下一步动作提示尾部块非法或为空（msg=${input.messageId}，原文节选：${excerptOf(text)}）`,
          input.agentName,
        );
      }
      return undefined;
    }
    // `tool_tips` 不做校验：这里只按 `prompt` 合规性与条数上限筛选
    const { actions, stats } = sanitizeActionsWithStats(raw, input.focusToolTips, input.max);
    if (actions.length === 0) {
      // 归因（原则九）：卡片变少必须看得出是"prompt 不合规"还是"超条数上限"
      this.warn(
        input.userId,
        input.threadId,
        `下一步动作提示尾部块条目全部被丢弃（msg=${input.messageId}，候选 ${raw.length} 条；` +
          `prompt 不合规 ${stats.droppedOther} / 超上限 ${stats.droppedOverLimit}；` +
          `原文节选：${excerptOf(text)}）`,
        input.agentName,
      );
      return undefined;
    }
    if (stats.droppedOther > 0) {
      // 部分条目因 prompt 不合规被丢：其余卡片照常下发，但必须留痕，
      // 否则"这一轮怎么少了两张卡"无从解释。
      this.warn(
        input.userId,
        input.threadId,
        `下一步动作提示部分条目 prompt 不合规被丢弃（msg=${input.messageId}；` +
          `不合规 ${stats.droppedOther} / 超上限 ${stats.droppedOverLimit}；保留 ${actions.length} 条）`,
        input.agentName,
      );
    }
    if (!this.writeSnapshot(input, actions)) return undefined;
    return { message_id: input.messageId, actions };
  }

  read(userId: string, agentName: string, threadId: string): NextActionsView | undefined {
    const snapshot = this.readSnapshot(userId, agentName, threadId);
    if (!snapshot) return undefined;
    return {
      message_id: snapshot.message_id,
      actions: snapshot.actions,
    };
  }

  /** 覆盖写：临时文件 + 原子改名（MUST NOT 出现"半个文件被读到"，原则五） */
  private writeSnapshot(input: NextActionsFinalizeInput, actions: NextAction[]): boolean {
    const file = this.filePath(input.userId, input.agentName, input.threadId);
    const tmp = `${file}.tmp`;
    const snapshot: NextActionsSnapshot = {
      message_id: input.messageId,
      agent_name: input.agentName,
      created_at: new Date().toISOString(),
      actions,
    };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
      fs.renameSync(tmp, file);
      return true;
    } catch (err) {
      this.remove(tmp);
      this.warn(
        input.userId,
        input.threadId,
        '下一步动作提示快照写入失败（保留旧快照）',
        input.agentName,
        err,
      );
      return false;
    }
  }

  private readSnapshot(
    userId: string,
    agentName: string,
    threadId: string,
  ): NextActionsSnapshot | undefined {
    const file = this.filePath(userId, agentName, threadId);
    let raw: string;
    try {
      if (fs.statSync(file).size > SNAPSHOT_MAX_BYTES) {
        this.warn(userId, threadId, 'next-actions.json 超过大小上限，按无提示处理', agentName);
        return undefined;
      }
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
    try {
      const obj = JSON.parse(raw) as Partial<NextActionsSnapshot>;
      if (
        typeof obj.message_id !== 'string' ||
        typeof obj.agent_name !== 'string' ||
        !Array.isArray(obj.actions)
      ) {
        throw new Error('字段缺失');
      }
      const actions = obj.actions.filter(isStoredAction);
      if (actions.length === 0) return undefined;
      return {
        message_id: obj.message_id,
        agent_name: obj.agent_name,
        created_at: typeof obj.created_at === 'string' ? obj.created_at : '',
        actions,
      };
    } catch {
      this.warn(userId, threadId, 'next-actions.json 损坏，按无提示处理', agentName);
      return undefined;
    }
  }

  private remove(file: string): void {
    try {
      // 单文件删除走 fs-safe：Windows 下 `fs.rmSync` 对含中文路径静默失效（见 fs-safe.ts 文件头）
      removeFileSafe(file);
    } catch {
      // 删除失败不阻断清理流程
    }
  }

  private warn(
    userId: string,
    threadId: string,
    message: string,
    agentName?: string,
    err?: unknown,
  ): void {
    const detail = err === undefined ? '' : `：${err instanceof Error ? err.message : String(err)}`;
    this.deps.logger?.warn(
      `user=${userId} thread=${threadId}${agentName ? ` agent=${agentName}` : ''} ${message}${detail}`,
    );
  }
}


/**
 * 本轮**生效**的提示条数上限：SOUL 开关开启（`max !== undefined`）**且**本轮有 Laya 能力时才生效。
 *
 * 后半条是本次修订的前提：卡片候选范围只来自意图聚焦，没有能力就必然产不出卡片，
 * 这时仍追加收尾指令只会白耗 token。返回值即"是否追加指令"的判据（`undefined` = 不追加）。
 */
export function effectiveNextActionsMax(
  max: number | undefined,
  focusToolTips: readonly unknown[],
): number | undefined {
  return max !== undefined && focusToolTips.length > 0 ? max : undefined;
}

export function buildTailInstruction(focusToolTips: readonly FocusToolTip[], max: number): string {
  const catalog =
    focusToolTips.length === 0
      ? '（本轮没有可提示的本体能力——不要输出任何建议，直接输出 {"actions":[]}）'
      : focusToolTips.map(renderCatalogLine).join('\n');
  return [
    '## 回答收尾要求：下一步动作建议',
    '',
    '在回答正文全部结束后，**另起一行**输出一个收尾块（这是给系统的结构化数据，不是回答内容）：',
    '',
    '<next_actions>{"actions":[{"prompt":"查询高强度钢板的采购单记录","tool_tips":[{"name":"QueryPurchaseRecords","title":"查询采购订单信息","ontology_id":"1","ontology_name":"采购管理"}]}]}</next_actions>',
    '',
    '硬性要求：',
    '1. 收尾块只输出一次，必须在整条回答的**最末尾**，块前后不要加 ``` 等代码围栏；',
    '2. `prompt` 必须是**祈使句**：以动词开头（查询 / 统计 / 导出 / 对比 / 生成 …），',
    '   **一次只描述一个任务**，不超过 50 字；',
    '   不得使用"你可以…""建议…""是否需要…""如果…"等陈述、疑问或条件句式；',
    '3. `prompt` 里的对象、范围、时间必须是**本轮对话中已明确、已知的事实**，',
    '   不得使用"这个""那些""相关数据""等信息"之类的指代或占位表述，不得自行假设；',
    '4. `tool_tips` 是 1~5 个元素，每个元素只能从下方清单**原样抄写**四个字段，',
    '   不得改写、不得编造；`name` 只能出现在 `tool_tips` 里，不得出现在 `prompt` 中；',
    `5. 数量 0~${max} 个，**宁缺毋滥**：用户目标已达成、只是闲聊、任务不明确、`,
    '   或缺少关键信息（对象 / 范围 / 时间任一不明）时，输出 {"actions":[]}，不要硬凑；',
    '',
    '本轮可选的本体能力（`tool_tips` 只能取自这里）：',
    catalog,
  ].join('\n');
}

function renderCatalogLine(tip: FocusToolTip): string {
  const parts = [`name=${tip.name}`, `title=${tip.title}`, `ontology_id=${tip.ontology_id}`];
  if (tip.ontology_name) parts.push(`ontology_name=${tip.ontology_name}`);
  return `- ${parts.join('｜')}`;
}

export function renderToolTipsInstruction(toolTips: readonly FocusToolTip[]): string {
  if (toolTips.length === 0) return '';
  const lines = toolTips.map(renderCatalogLine);
  return [
    '本轮请首先使用以下本体能力完成用户消息要求的任务（来自上一轮卡片）：',
    ...lines,
    '请按用户消息与已知上下文补全参数；不要改用其它能力。',
  ].join('\n');
}

export function parseActions(raw: string): unknown[] {
  const text = raw.trim();
  if (text === '') return [];
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
  let data: unknown;
  try {
    data = JSON.parse(fenced ? (fenced[1] ?? '') : text);
  } catch {
    return [];
  }
  if (Array.isArray(data)) return data;
  if (isRecord(data) && Array.isArray(data.actions)) return data.actions;
  return [];
}

function isExplicitEmpty(raw: string): boolean {
  const text = raw.trim();
  if (text === '') return false;
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
  try {
    const data = JSON.parse(fenced ? (fenced[1] ?? '') : text) as unknown;
    if (Array.isArray(data)) return data.length === 0;
    if (isRecord(data) && Array.isArray(data.actions)) return data.actions.length === 0;
    return false;
  } catch {
    return false;
  }
}

/** 日志用输出节选（折叠空白 + 限长）：告警要能定位，但 MUST NOT 把整段输出灌进日志 */
function excerptOf(raw: string, max = 200): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text === '') return '（空）';
  const chars = [...text];
  return chars.slice(0, max).join('') + (chars.length > max ? '…' : '');
}

/** 丢弃原因统计（宪章原则九：卡片变少 MUST 可归因，MUST NOT 静默） */
export interface SanitizeStats {
  droppedOther: number;
  /** 合规但因条数上限未收录（FR-004） */
  droppedOverLimit: number;
}

export interface SanitizeResult {
  actions: NextAction[];
  stats: SanitizeStats;
}

export function sanitizeActionsWithStats(
  raw: readonly unknown[],
  focusToolTips: readonly FocusToolTip[],
  max: number = MAX_ACTIONS,
): SanitizeResult {
  const toolNames = new Set(focusToolTips.map((tip) => tip.name));
  const out: NextAction[] = [];
  const seen = new Set<string>();
  const stats: SanitizeStats = { droppedOther: 0, droppedOverLimit: 0 };
  for (const item of raw) {
    if (!isRecord(item)) {
      stats.droppedOther++;
      continue;
    }
    const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
    if (!isCompliantPrompt(prompt, toolNames) || seen.has(prompt)) {
      stats.droppedOther++;
      continue;
    }
    seen.add(prompt);
    if (out.length >= max) {
      stats.droppedOverLimit++;
      continue;
    }
    out.push({ prompt, tool_tips: normalizeToolTips(item.tool_tips) });
  }
  return { actions: out, stats };
}

export function sanitizeActions(
  raw: readonly unknown[],
  focusToolTips: readonly FocusToolTip[],
  max: number = MAX_ACTIONS,
): NextAction[] {
  return sanitizeActionsWithStats(raw, focusToolTips, max).actions;
}

export function isCompliantPrompt(prompt: string, toolNames: ReadonlySet<string>): boolean {
  if (prompt === '' || [...prompt].length > PROMPT_MAX_CHARS) return false;
  const lower = prompt.toLowerCase();
  for (const name of toolNames) {
    if (name !== '' && lower.includes(name.toLowerCase())) return false;
  }
  if (IDENTIFIER_RE.test(prompt)) return false;
  if (NON_IMPERATIVE_START_RE.test(prompt)) return false;
  return !VAGUE_RE.test(prompt);
}

const IDENTIFIER_RE =
  /[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)+|[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*/;

const NON_IMPERATIVE_START_RE = /^(你|您|建议|可以|是否|如果|若|需要|可能|或许|要不要)/;

const VAGUE_RE = /(这个|那个|这些|那些|相关|之类|等等|一些|某些)/;


export function normalizeToolTips(raw: unknown): FocusToolTip[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_TOOL_TIPS_PER_ACTION).map(readToolTip);
}

function readToolTip(value: unknown): FocusToolTip {
  const record = isRecord(value) ? value : {};
  return {
    name: asText(record.name),
    title: asText(record.title),
    ontology_id: asText(record.ontology_id),
    ontology_name: typeof record.ontology_name === 'string' ? record.ontology_name : null,
  };
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStoredAction(value: unknown): value is NextAction {
  if (!isRecord(value)) return false;
  if (typeof value.prompt !== 'string' || value.prompt === '') return false;
  return Array.isArray(value.tool_tips);
}
