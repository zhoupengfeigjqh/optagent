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
 * 1. **纯函数合规层**（TR-02）：解析、逐条校验、工具引用裁剪——与旧版逐字同口径；
 * 2. **快照存储**：会话级单份 `next-actions.json`，轮开始 `clear`、轮末覆盖写（FR-015/017/018）；
 *    只保留最新一轮 = 历史轮次天然不保留（不落盘历史卡片）；
 * 3. **尾部指令装配**：SOUL 开关开启时追加到 System Prompt 末尾的协议指令
 *    （含条数上限与工具目录），是"模型到底被要求怎么输出"的唯一事实源。
 *
 * 读取路径**不在读取侧再判数字人**（修订 G4）：卡片的存在与否只由轮末是否产出快照决定，
 * 读取侧不按"归属数字人 = 当前选中数字人"过滤（那会造成"切换后卡片消失"）。
 * **009 修订**：不再需要在读取侧判定的真正原因是**归属已由路径承载**——
 * 快照落在 `user-data/{数字人}/threads/{tid}/`，跨数字人在路径层就取不到；
 * 因此数字人只作为**路径入参**贯穿（`filePath(uid, agent, threadId)`），不是过滤条件。
 *
 * 2026-10-14 修订（契约 §6：卡片**强制绑定工具**）：白名单裁剪后无有效工具引用的条目
 * **整条丢弃**（`sanitizeActionsWithStats`），引导文案改由 `buildActionGuidance` 铸造
 * （指明要调用的工具 + 用途摘要，超 500 字**截断**而非置空）。无工具绑定的建议会退化成
 * 开放式闲聊指令，故不再下发。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { RuntimeToolBrief } from '../types.js';
import { threadDir } from './dirs.js';
import { removeFileSafe } from './fs-safe.js';
import {
  buildActionGuidance,
  NEXT_ACTION_HINTS_DEFAULT,
  parseExposedName,
  toolExposedName,
  type SoulToolRef,
} from './soul.js';

/** 卡片提示词长度上限（FR-003） */
export const PROMPT_MAX_CHARS = 50;
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

/** 一条下一步动作提示（内部形态；下发时补 `exposed_name`） */
export interface NextAction {
  prompt: string;
  tools: SoulToolRef[];
  /**
   * 隐藏工具引导：点击卡片发送时随请求回传，**对用户不可见**、不落历史。
   * **始终存在**（无关联工具或超 500 字时为空串），与 `AgentStarterView.guidance` 逐字同形。
   */
  guidance: string;
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
  actions: Array<{
    prompt: string;
    tools: Array<{ kind: 'builtin' | 'mcp'; name: string; service?: string; exposed_name: string }>;
    guidance: string;
  }>;
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
  /** 本轮可用工具摘要（`runWith` 装配期回填，引用裁剪据此判定） */
  availableTools: readonly RuntimeToolBrief[];
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
    const { actions, stats } = sanitizeActionsWithStats(raw, input.availableTools, input.max);
    if (actions.length === 0) {
      // 归因（原则九）：卡片变少必须看得出是"模型没给工具"还是"工具名越界被裁空"
      this.warn(
        input.userId,
        input.threadId,
        `下一步动作提示尾部块条目全部被丢弃（msg=${input.messageId}，候选 ${raw.length} 条；` +
          `无工具 ${stats.droppedNoTools} / 引用越界 ${stats.droppedToolsOutOfScope} / 其它 ${stats.droppedOther}；` +
          `原文节选：${excerptOf(text)}）`,
        input.agentName,
      );
      return undefined;
    }
    if (stats.droppedNoTools + stats.droppedToolsOutOfScope > 0) {
      // 部分条目因"未绑定可用工具"被丢（FR-009）：其余卡片照常下发，但必须留痕，
      // 否则"这一轮怎么少了两张卡"无从解释。稳定后可评估降为 info 级。
      this.warn(
        input.userId,
        input.threadId,
        `下一步动作提示部分条目未绑定可用工具被丢弃（msg=${input.messageId}；` +
          `无工具 ${stats.droppedNoTools} / 引用越界 ${stats.droppedToolsOutOfScope}；保留 ${actions.length} 条）`,
        input.agentName,
      );
    }
    if (!this.writeSnapshot(input, actions)) return undefined;
    return { message_id: input.messageId, actions: actions.map(toView) };
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
      actions: snapshot.actions.map(toView),
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
 * 工具目录取**本轮真实装配的工具清单**（`runWith` 在工具装配完成后调用），
 * 与引用裁剪的判据同源——模型只能引用它真正看得到的工具。
 */
/**
 * 本轮**生效**的提示条数上限：SOUL 开关开启（`max !== undefined`）**且**本轮有可用工具时才生效。
 *
 * 后半条是 2026-10-14 修订的前提（FR-009）：卡片必须绑定工具，本轮没有工具就必然产不出卡片，
 * 这时仍追加收尾指令只会白耗 token，并让轮末每次都按"条目全部被丢弃"告警 ⇒ 等价于该轮关闭。
 * 返回值即"是否追加指令"的判据（`undefined` = 不追加），避免调用方用非空断言。
 */
export function effectiveNextActionsMax(
  max: number | undefined,
  availableTools: readonly unknown[],
): number | undefined {
  return max !== undefined && availableTools.length > 0 ? max : undefined;
}

export function buildTailInstruction(
  availableTools: readonly RuntimeToolBrief[],
  max: number,
): string {
  const catalog =
    availableTools.length === 0
      ? '（本数字人当前没有可用工具——没有工具就**不要输出任何建议**，直接输出 {"actions":[]}）'
      : availableTools.map((t) => `- ${t.name}：${t.description || '无说明'}`).join('\n');
  return [
    '## 回答收尾要求：下一步动作建议',
    '',
    '在回答正文全部结束后，**另起一行**输出一个收尾块（这是给系统的结构化数据，不是回答内容）：',
    '',
    '<next_actions>{"actions":[{"prompt":"用一句中文说明用户接下来要做什么","tools":[{"kind":"builtin","name":"工具名"}]}]}</next_actions>',
    '',
    '硬性要求：',
    '1. 收尾块只输出一次，必须在整条回答的**最末尾**，块前后不要加 ``` 等代码围栏；',
    '2. `prompt` 必须是**全中文**、意图清晰简洁、**不超过 50 字**；',
    '   严禁出现工具名、英文单词、下划线或驼峰式标识符；',
    '3. **每条建议都必须绑定工具**：`tools` 为 1~2 个元素（不允许空数组），',
    '   元素只能取自下方清单，且**只能出现在 `tools` 里**',
    `4. 数量 0~${max} 个：用户目标已达成、只是闲聊、或没有能关联工具的下一步时，`,
    '   输出 {"actions":[]}，不要硬凑；',
    '5. 关键要求：操作建议只能为**陈述句**，且最多只能描述一个动作或对象，并且与用户目标密切相关。例如：调用查询工具查询计算结果；',
    '',
    '本数字人当前可调用的工具（`tools` 只能取自这里）：',
    catalog,
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
  /** 模型**压根没给**工具 → 整条丢弃的条数（FR-009） */
  droppedNoTools: number;
  /** 模型**给过**工具、但引用全部越界或形态非法（被白名单裁空）→ 整条丢弃的条数（FR-009） */
  droppedToolsOutOfScope: number;
  /** 其它原因：提示词不合规 / 重复 / 条目类型错（FR-003 / FR-043） */
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
 * 逐条校验并裁剪（FR-003/FR-004/FR-009/FR-043）：不合规条目只丢自己，条数超限取前 N 条。
 *
 * **2026-10-14 修订（卡片强制绑定工具）**：白名单裁剪**之后**若已无有效工具引用，
 * **整条丢弃**——不再沿用旧口径"只丢引用、保留卡片文本"（无工具绑定的建议会退化成
 * 开放式闲聊指令）。判据顺序是"先裁剪、再判空"，所以模型把工具名写错同样会整条消失，
 * 这是有意的；两种情况分别计入 `stats`，供定稿告警区分。
 */
export function sanitizeActionsWithStats(
  raw: readonly unknown[],
  availableTools: readonly RuntimeToolBrief[],
  max: number = MAX_ACTIONS,
): SanitizeResult {
  const allowed = new Set(availableTools.map((t) => t.name));
  const out: NextAction[] = [];
  const seen = new Set<string>();
  const stats: SanitizeStats = {
    droppedNoTools: 0,
    droppedToolsOutOfScope: 0,
    droppedOther: 0,
    droppedOverLimit: 0,
  };
  for (const item of raw) {
    if (out.length >= max) {
      stats.droppedOverLimit++;
      continue;
    }
    if (!isRecord(item)) {
      stats.droppedOther++;
      continue;
    }
    const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
    if (!isCompliantPrompt(prompt, allowed) || seen.has(prompt)) {
      stats.droppedOther++;
      continue;
    }
    // `declared` 用于区分"压根没给"与"给了但全被裁掉"：两者都整条丢弃，但归因不同
    const declared = Array.isArray(item.tools) ? item.tools : [];
    const tools = filterTools(declared, allowed);
    if (tools.length === 0) {
      if (declared.length === 0) stats.droppedNoTools++;
      else stats.droppedToolsOutOfScope++;
      continue;
    }
    seen.add(prompt);
    // 引导在铸造处即截断到上限内（超长截断、MUST NOT 置空，否则"绑定"会在下一轮静默失效）
    out.push({ prompt, tools, guidance: buildActionGuidance(tools, availableTools) });
  }
  return { actions: out, stats };
}

/** 只要保留条目（既有调用口径）；需要丢弃归因时用 `sanitizeActionsWithStats` */
export function sanitizeActions(
  raw: readonly unknown[],
  availableTools: readonly RuntimeToolBrief[],
  max: number = MAX_ACTIONS,
): NextAction[] {
  return sanitizeActionsWithStats(raw, availableTools, max).actions;
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
  return !IDENTIFIER_RE.test(prompt);
}

/** `snake_case` / `kebab-case` / `CamelCase` 形态（"工具英文名"的可判定形态） */
const IDENTIFIER_RE =
  /[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)+|[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*/;

/* ---------- 内部 ---------- */

function filterTools(raw: unknown, allowed: ReadonlySet<string>): SoulToolRef[] {
  if (!Array.isArray(raw)) return [];
  const out: SoulToolRef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (name === '') continue;
    let ref: SoulToolRef | undefined;
    if (item.kind === 'builtin') {
      ref = { kind: 'builtin', name };
    } else if (
      item.kind === 'mcp' &&
      typeof item.service === 'string' &&
      item.service.trim() !== ''
    ) {
      ref = { kind: 'mcp', service: item.service.trim(), name };
    }
    if (!ref) continue;
    const exposed = toolExposedName(ref);
    // 越界引用（不在本轮装配出来的清单里）一律丢弃该引用，卡片文本保留
    if (!allowed.has(exposed) || seen.has(exposed)) continue;
    seen.add(exposed);
    // 以**暴露名**为准还原成规范引用：模型只会照抄清单里的名字，`kind` 常写错
    // （实测把 MCP 写成 `builtin`）。这样 `tools` 与 `guidance` 才是同源的一对。
    out.push(parseExposedName(exposed));
  }
  return out;
}

/** 快照 → 下发形态；与 `agent-catalog.toStarterView` 同口径（命名规则来自 `toolExposedName`） */
function toView(action: NextAction): NextActionsView['actions'][number] {
  return {
    prompt: action.prompt,
    tools: action.tools.map((t) => ({
      kind: t.kind,
      name: t.name,
      ...(t.kind === 'mcp' ? { service: t.service } : {}),
      exposed_name: toolExposedName(t),
    })),
    guidance: action.guidance,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 快照条目的形状校验（读取侧）。
 *
 * 除字段形状外**必判 `tools` 非空**：2026-10-14 起"卡片必须绑定工具"，而存量快照里
 * 可能还留着旧口径产出的"无工具卡片"——读取时按同一判据过滤，避免它们继续下发。
 */
function isStoredAction(value: unknown): value is NextAction {
  if (!isRecord(value)) return false;
  if (typeof value.prompt !== 'string' || value.prompt === '') return false;
  if (typeof value.guidance !== 'string') return false;
  if (!Array.isArray(value.tools) || value.tools.length === 0) return false;
  return true;
}
