/**
 * 下一步动作提示（007 修订 · Tail Protocol）：卡片的**合规层 + 快照存储 + 尾部指令装配**。
 *
 * 生成机制修订（`specs/007-next-action-hints/revision-tail-protocol.md`）：
 * 卡片不再由独立 LLM 调用产生，而是模型在**主回答流末尾**输出 `<next_actions>` 块
 * （捕获见 `next-actions-tail.ts`），轮末同步解析入快照、随 `done` 事件直推前端。
 * 因此本模块不再持有 LLM 依赖、超时与 per-thread 串行链——那套机制随独立调用一起废除。
 *
 * 保留的三块职责：
 *
 * 1. **纯函数合规层**（TR-02）：解析、`prompt` 合规判定、条数裁剪；
 * 2. **快照存储**：会话级单份 `next-actions.json`，轮开始 `clear`、轮末覆盖写（FR-015/017/018）；
 *    只保留最新一轮 = 历史轮次天然不保留（不落盘历史卡片）；
 * 3. **尾部指令装配**：SOUL 开关开启且本轮有 Laya 能力时追加到 System Prompt 末尾的协议指令
 *    （含条数上限与**能力目录**），是"模型到底被要求怎么输出"的唯一事实源。
 *
 * 读取路径**不在读取侧再判数字人**（修订 G4）：卡片的存在与否只由轮末是否产出快照决定，
 * 读取侧不按"归属数字人 = 当前选中数字人"过滤（那会造成"切换后卡片消失"）。
 * **009 修订**：归属已由路径承载——快照落在 `user-data/{数字人}/threads/{tid}/`，
 * 数字人只作为**路径入参**贯穿（`filePath(uid, agent, threadId)`），不是过滤条件。
 *
 * **2026-11 修订（016：能力驱动的 tool_tips）**：
 * - 候选范围只来自本轮意图聚焦选出的本体行为 / 函数（`focusToolTips`），
 *   无能力 → 不追加指令 → 本轮不产卡片；
 * - 卡片形状改为 `{ prompt, tool_tips: [{ name, title, ontology_id, ontology_name }] }`，
 *   `tool_tips` 由模型从能力目录抄写，后端**不做校验**：只读取字段、只截断到 5 条；
 * - `prompt` 收紧为祈使句 + 单一任务 + 信息明确，否则整条丢弃；
 * - 点击卡片时 `tool_tips` 走请求级结构化字段（只进本轮系统提示词，**不落历史**），
 *   本轮仍照常触发意图聚焦。
 */
import fs from 'node:fs';
import path from 'node:path';
import { threadDir } from './dirs.js';
import { removeFileSafe } from './fs-safe.js';
import type { FocusToolTip } from './ontology-focus/types.js';
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
/* 隐藏引导的长度上限（`GUIDANCE_MAX_CHARS`）随文案铸造一起落在 `soul.ts`：
   `buildActionGuidance` 生成时即按上限**截断**（MUST NOT 置空），本模块不再自行判长。 */

/** 一条下一步动作提示（卡片形态：快照与下发同形） */
export interface NextAction {
  /**
   * 卡片正文：祈使句、一次只描述一个任务、信息明确。
   * 点击后作为**下一轮用户消息原文**落盘（历史里只有它）。
   */
  prompt: string;
  /**
   * 隐藏的工具提示：点击卡片时随结构化字段回传，只进下一轮系统提示词。
   *
   * **不落历史**：`history.jsonl` 的 user 行只有 `prompt`，看不到这里的内容。
   * 字段值由模型从本轮本体能力清单抄写，后端原样透传（仅截断到 5 条）。
   */
  tool_tips: FocusToolTip[];
}

/** 会话级单份快照（`users/{uid}/user-data/{数字人}/threads/{tid}/next-actions.json`，009 归属） */
export interface NextActionsSnapshot {
  /** 归属的 assistant 消息 id（前端据此把卡片挂到对应气泡） */
  message_id: string;
  /** 产出卡片的数字人（仅存档溯源，读取不再据此判定） */
  agent_name: string;
  created_at: string;
  actions: NextAction[];
}

/** 下发形态（契约见 `specs/007-next-action-hints/contracts/next-actions-api.md` §1.2） */
export interface NextActionsView {
  message_id: string;
  actions: NextAction[];
}

/** 轮末同步定稿的输入（由 `run-finalize` 从本轮 run 的事实装配） */
export interface NextActionsFinalizeInput {
  userId: string;
  threadId: string;
  /** 归属 assistant 消息 id（run 启动时预生成，与落盘消息、done 载荷同源） */
  messageId: string;
  agentName: string;
  /** 回答流中捕获的尾部块原文（不含哨兵标签；空串 = 本轮无块 → 无卡片） */
  tailText: string;
  /**
   * 本轮 Laya 入选的本体能力（卡片候选范围的唯一来源）。
   *
   * 只用于**卡片是否允许产出**（空 = 不产卡片，调用方已拦）与 `prompt` 合规判定，
   * 不参与 `tool_tips` 的任何校验——后者是模型输出，原样透传。
   */
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

  /** 新一轮开始：清空上一轮的卡片（同步，语义与旧链版一致：轮开始即无卡片） */
  clear(userId: string, agentName: string, threadId: string): void {
    this.remove(this.filePath(userId, agentName, threadId));
  }

  /**
   * 轮末同步定稿：解析尾部块 → 合规裁剪 → 覆盖写快照 → 返回下发形态。
   *
   * **永不抛错**：解析/合规/写盘任何一步失败都只告警并返回 `undefined`
   * （本轮无卡片），绝不影响回答落盘与 done 广播（原则九）。
   *
   * @returns 有合规卡片时返回下发形态（调用方把它放进 `done.next_actions`）；否则 `undefined`
   */
  finalize(input: NextActionsFinalizeInput): NextActionsView | undefined {
    const text = input.tailText.trim();
    // 无块 = 本轮无卡片（开关关闭 / 模型省略），正常路径不告警
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

  /**
   * 读取下发形态；快照不可用 → `undefined`（**永不抛错**）。
   *
   * 修订（G4）：**不再判"归属数字人 = 当前选中数字人"与读取侧开关**——
   * 卡片的生成已由提示词装配期的开关门控（最新一轮关着开关就不会产出快照），
   * 读取侧再判只会造成"切换数字人后卡片消失"的体验问题。
   * 调用方据此返回空（`message_id: null, actions: []`），前端即不渲染。
   */
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
      // 写失败保留旧快照（或保持无），不影响本轮回答；返回 false → 本轮无卡片（done 不带）
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

  /** 读取快照；不存在/损坏/超限 → `undefined`（不存在是最常见路径，不告警） */
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
      /* 轮开始清空失败不影响本轮对话 */
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

/* ---------- 纯函数层（TR-02：合规判定与解析各自唯一实现，全部可测） ---------- */

/**
 * 尾部块指令（SOUL 开关开启时追加到 System Prompt 末尾，`agent-factory` 调用）。
 *
 * 候选目录取**本轮意图聚焦选出的本体能力**（行为 + 函数）：卡片的 `tool_tips`
 * 只能从这份清单里抄写。清单为空时不追加指令（见 `effectiveNextActionsMax`）。
 */
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

export function buildTailInstruction(
  focusToolTips: readonly FocusToolTip[],
  max: number,
): string {
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

/** 目录行：四个字段一次给全，模型照抄即可（不做任何裁剪） */
function renderCatalogLine(tip: FocusToolTip): string {
  const parts = [`name=${tip.name}`, `title=${tip.title}`, `ontology_id=${tip.ontology_id}`];
  if (tip.ontology_name) parts.push(`ontology_name=${tip.ontology_name}`);
  return `- ${parts.join('｜')}`;
}

/**
 * 卡片点击轮的隐藏工具提示段（追加到本轮 `systemExtra`）。
 *
 * 与 `guidance` 的区别：这里只有结构化字段，渲染在**聚焦提示之后**（卡片指定的能力
 * 权重更高）；由于走请求级注入，`tool_tips` 不会出现在 `history.jsonl` 的 user 行里。
 */
export function renderToolTipsInstruction(toolTips: readonly FocusToolTip[]): string {
  if (toolTips.length === 0) return '';
  const lines = toolTips.map(renderCatalogLine);
  return [
    '本轮请优先使用以下本体能力完成用户消息要求的任务（来自上一轮卡片）：',
    ...lines,
    '请按用户消息与已知上下文补全参数；不要改用其它能力。',
  ].join('\n');
}

/** 容忍模型常见的 ```json 围栏与顶层裸数组；非法一律空（同 `view-links` 口径） */
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

/**
 * 模型是否**明确**表示"无需下一步"（合法的空结果，FR-005）。
 *
 * 必须与"输出非法"区分开：两者都得到 0 条卡片，但前者是**正常结果**（MUST NOT 告警，
 * 否则闲聊轮次会刷满日志），后者是**降级**（MUST 留痕，FR-041）。
 * 判据比 `parseActions` 更窄：能解析成 JSON，且 `actions`（或顶层数组）**存在且为空**。
 */
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
  /** prompt 不合规：空 / 超长 / 含工具标识符 / 疑问句或指代句式 / 重复（FR-003） */
  droppedOther: number;
  /** 合规但因条数上限未收录（FR-004） */
  droppedOverLimit: number;
}

/** `sanitizeActionsWithStats` 的返回：保留条目 + 丢弃归因 */
export interface SanitizeResult {
  actions: NextAction[];
  stats: SanitizeStats;
}

/**
 * 逐条校验并裁剪（FR-003/FR-004/FR-043）：不合规条目只丢自己，条数超限取前 N 条。
 *
 * **`tool_tips` 不做任何校验**：只有两处处理——读取（读不到的字段留空，条目照留）
 * 与条数截断（`MAX_TOOL_TIPS_PER_ACTION`）。不比对运行时工具、不检查名字是否在目录里、
 * 不去重、不改写。卡片是否产出由调用方按 `focusToolTips` 非空先行门控。
 */
export function sanitizeActionsWithStats(
  raw: readonly unknown[],
  focusToolTips: readonly FocusToolTip[],
  max: number = MAX_ACTIONS,
): SanitizeResult {
  // 仅用于"prompt 里不许出现工具名"的判定（prompt 合规，不是 tool_tips 校验）
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
    out.push({ prompt, tool_tips: readToolTips(item.tool_tips) });
  }
  return { actions: out, stats };
}

/** 只要保留条目（既有调用口径）；需要丢弃归因时用 `sanitizeActionsWithStats` */
export function sanitizeActions(
  raw: readonly unknown[],
  focusToolTips: readonly FocusToolTip[],
  max: number = MAX_ACTIONS,
): NextAction[] {
  return sanitizeActionsWithStats(raw, focusToolTips, max).actions;
}

/**
 * 提示词合规判定（FR-003，唯一实现）：全中文自然语言，且不得出现工具标识符。
 *
 * 两条判据刻意区分"硬门禁"与"不误杀"：
 * - **命中任一可用工具名**（内置名 / MCP 暴露名 `{server}__{tool}`，大小写不敏感）→ 丢弃；
 * - **含 `snake_case` / `kebab-case` / `CamelCase` 形态的标识符 token** → 丢弃；
 * - 但**不**禁止任何拉丁字母——否则会误杀"Excel 文件"这类合法中文表述。
 */
export function isCompliantPrompt(prompt: string, toolNames: ReadonlySet<string>): boolean {
  if (prompt === '' || [...prompt].length > PROMPT_MAX_CHARS) return false;
  const lower = prompt.toLowerCase();
  for (const name of toolNames) {
    if (name !== '' && lower.includes(name.toLowerCase())) return false;
  }
  if (IDENTIFIER_RE.test(prompt)) return false;
  // 祈使句 / 信息明确（FR-003）：两项都是轻量启发式，宁松不严——
  // 真正的风格约束在尾部指令里，这里只拦最典型的两类退化。
  if (NON_IMPERATIVE_START_RE.test(prompt)) return false;
  return !VAGUE_RE.test(prompt);
}

/** `snake_case` / `kebab-case` / `CamelCase` 形态（"工具英文名"的可判定形态） */
const IDENTIFIER_RE =
  /[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)+|[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*/;

/** 陈述 / 疑问 / 条件 / 建议式开头：一律不是祈使句 */
const NON_IMPERATIVE_START_RE = /^(你|您|建议|可以|是否|如果|若|需要|可能|或许|要不要)/;

/** 指代 / 占位表述：信息不明确（"查询这个"、"梳理相关数据"） */
const VAGUE_RE = /(这个|那个|这些|那些|相关|之类|等等|一些|某些)/;

/* ---------- 内部 ---------- */

/**
 * 读 `tool_tips`：**只防崩溃，不校验**。
 *
 * - 非数组 → 空数组（卡片照常下发，`prompt` 本身仍可执行）；
 * - 元素非对象 / 字段缺失 → 该字段留空值，条目保留；
 * - 超出 `MAX_TOOL_TIPS_PER_ACTION` → 截断（需求硬约束）。
 */
function readToolTips(raw: unknown): FocusToolTip[] {
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

/**
 * 快照条目的形状校验（读取侧）。
 *
 * 只要求 `prompt` 非空且 `tool_tips` 是数组：**不判内容**（空数组也照常下发），
 * 旧口径快照（只有 `tools` / `guidance`）因缺 `tool_tips` 被丢弃——快照每轮开始即清空，
 * 无需迁移。
 */
function isStoredAction(value: unknown): value is NextAction {
  if (!isRecord(value)) return false;
  if (typeof value.prompt !== 'string' || value.prompt === '') return false;
  return Array.isArray(value.tool_tips);
}
