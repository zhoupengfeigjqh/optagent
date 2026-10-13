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
 * 读取路径**不再判数字人**（修订 G4）：卡片持久化与恢复跟"当前选中数字人"无关，
 * 归属判定只保留前端按 `message_id` 挂载这一条。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { RuntimeToolBrief } from '../types.js';
import { threadDir } from './dirs.js';
import {
  buildStarterGuidance,
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
/** 隐藏引导长度上限：与 `POST /api/threads/:id/messages` 的 `guidance` 约束一致 */
const GUIDANCE_MAX_CHARS = 500;

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

/** 会话级单份快照（`users/{uid}/user-data/threads/{tid}/next-actions.json`） */
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

  private filePath(userId: string, threadId: string): string {
    return path.join(threadDir(this.root, userId, threadId), 'next-actions.json');
  }

  /** 新一轮开始：清空上一轮的卡片（同步，语义与旧链版一致：轮开始即无卡片） */
  clear(userId: string, threadId: string): void {
    this.remove(this.filePath(userId, threadId));
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
    const actions = sanitizeActions(raw, input.availableTools, input.max);
    if (actions.length === 0) {
      this.warn(
        input.userId,
        input.threadId,
        `下一步动作提示尾部块条目全部不合规（msg=${input.messageId}，候选 ${raw.length} 条，原文节选：${excerptOf(text)}）`,
        input.agentName,
      );
      return undefined;
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
  read(userId: string, threadId: string): NextActionsView | undefined {
    const snapshot = this.readSnapshot(userId, threadId);
    if (!snapshot) return undefined;
    return {
      message_id: snapshot.message_id,
      actions: snapshot.actions.map(toView),
    };
  }

  /** 覆盖写：临时文件 + 原子改名（MUST NOT 出现"半个文件被读到"，原则五） */
  private writeSnapshot(input: NextActionsFinalizeInput, actions: NextAction[]): boolean {
    const file = this.filePath(input.userId, input.threadId);
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
      this.warn(input.userId, input.threadId, '下一步动作提示快照写入失败（保留旧快照）', input.agentName, err);
      return false;
    }
  }

  /** 读取快照；不存在/损坏/超限 → `undefined`（不存在是最常见路径，不告警） */
  private readSnapshot(userId: string, threadId: string): NextActionsSnapshot | undefined {
    const file = this.filePath(userId, threadId);
    let raw: string;
    try {
      if (fs.statSync(file).size > SNAPSHOT_MAX_BYTES) {
        this.warn(userId, threadId, 'next-actions.json 超过大小上限，按无提示处理');
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
      this.warn(userId, threadId, 'next-actions.json 损坏，按无提示处理');
      return undefined;
    }
  }

  private remove(file: string): void {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* 轮开始清空失败不影响本轮对话 */
    }
  }

  private warn(userId: string, threadId: string, message: string, agentName?: string, err?: unknown): void {
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
export function buildTailInstruction(
  availableTools: readonly RuntimeToolBrief[],
  max: number,
): string {
  const catalog =
    availableTools.length === 0
      ? '（本数字人当前没有可用工具，`tools` 一律留空数组）'
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
    '3. `tools` 是可选的关联工具数组（0~2 个），元素只能取自下方清单，且**只能出现在 `tools` 里**，',
    '   绝不能出现在 `prompt` 中；',
    `4. 数量 0~${max} 个：用户目标已达成、只是闲聊、或没有明确下一步时，输出 {"actions":[]}，不要硬凑；`,
    '5. 不要重复同一件事，按用户最可能想做的顺序排列。',
    '',
    '本数字人当前可调用的工具（仅供 `tools` 字段使用）：',
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

/**
 * 逐条校验并裁剪（FR-003/FR-004/FR-043）：不合规条目只丢自己，条数超限取前 N 条。
 * 工具引用越界只丢该引用、**保留卡片文本**（边界情况·工具引用越界）。
 */
export function sanitizeActions(
  raw: readonly unknown[],
  availableTools: readonly RuntimeToolBrief[],
  max: number = MAX_ACTIONS,
): NextAction[] {
  const allowed = new Set(availableTools.map((t) => t.name));
  const out: NextAction[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= max) break;
    if (!isRecord(item)) continue;
    const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
    if (!isCompliantPrompt(prompt, allowed)) continue;
    if (seen.has(prompt)) continue;
    seen.add(prompt);
    const tools = filterTools(item.tools, allowed);
    const guidance = buildStarterGuidance(tools);
    out.push({ prompt, tools, guidance: guidance.length > GUIDANCE_MAX_CHARS ? '' : guidance });
  }
  return out;
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
const IDENTIFIER_RE = /[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)+|[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*/;

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
    } else if (item.kind === 'mcp' && typeof item.service === 'string' && item.service.trim() !== '') {
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

function isStoredAction(value: unknown): value is NextAction {
  if (!isRecord(value)) return false;
  if (typeof value.prompt !== 'string' || value.prompt === '') return false;
  if (typeof value.guidance !== 'string') return false;
  if (!Array.isArray(value.tools)) return false;
  return true;
}
