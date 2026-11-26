/**
 * 规划调用的输入装配（028 FR-003 / data-model §1.1）。
 *
 * 六段 system prompt（顺序固定，MUST NOT 调换）：
 * 1. 角色与铁律；2. 意图聚焦结果；3. 本体关系；4. 可用函数；5. 命令前置约束；6. 输出格式。
 *
 * 四条口径：
 * - 段 3/4 分工：段 3 回答"业务上有什么、彼此怎么连"，段 4 回答"凭什么能算出来"；
 * - 段 2 **直通**聚焦提示（它已有阶数分档上限与行级剪枝），不再做业务截断——
 *   2026-11-26 实测：二次截到 2000 会从末尾切掉「图路径」，正是上下游关系所在，
 *   且截断事实不留档，运行环境看不出规划少了内容；
 * - 段 4/5 **不设上限、不截断**（截断会让模型不知道可用能力）；
 * - 段 6 是**软约束**：只负责减少试错轮次，正确性由 C0~C5 与可见工具集兜底。
 */
import type { OntologyDefinition, OntologyIndex } from '../intent-focus/types.js';
import { matchKeys } from '../ontology-doc.js';
import type { BehaviorLookup } from '../rule-gate/types.js';
import { BUILTIN_TOOL_NAMES, HISTORY_TURNS } from './types.js';

/**
 * 段 2 的**防御性硬顶**（按字符），不是业务上限。
 *
 * 正常链路里 `focus.prompt` 已被 `maxPromptChars(阶数)` 限在 4000 / 5000 / 6000，
 * 永远碰不到这里；只在聚焦侧回归（上限被误删/误改）时才拦截，避免整段历史被塞进段 2。
 */
export const FOCUS_PROMPT_HARD_CAP_CHARS = 8000;

/** 历史单条消息的字数上限 */
export const HISTORY_MESSAGE_MAX_CHARS = 1500;

/** 角色与铁律（段 1，固定文案） */
export const ROLE_PROMPT = `你是任务分解器。根据给定上下文把用户的请求拆成 1~3 个可执行步骤，只输出计划。

【必须遵守】你的计划必须从下方「意图聚焦结果」出发：
- 优先使用聚焦已给出的技能、关键行为与图路径；
- 每一步的 coreAction 都应当落在聚焦结果的覆盖范围内，或在可用工具清单中确有对应能力；
- 不得绕开聚焦结果自行发明新的业务路径。`;

/** 输出格式与禁用项（段 6，固定文案） */
export const OUTPUT_FORMAT_PROMPT = `［输出格式］
只输出一个 JSON 数组。不要输出解释、标题、前后缀文字，不要包 Markdown 代码围栏。

每个元素的字段：
- seqId：整数，从 1 开始
- taskName：≤20 字，动宾短语
- content：≤300 字，写清这一步做什么、用哪个工具、产出什么
- coreAction：工具裸名（不带服务前缀），必须来自上面的本体行为或可用函数
- type：command（写入）| query（查询）| function（函数处理）

若本次无需任何工具（或已无剩余步骤），输出空数组 []。

禁止：
- 一次给出多于 3 步
- 一个步骤里安排多个 command（一步只能有一个 coreAction；多个 command 请各占一步）
- 同一个 command 安排成两步（同一 command 只占一步）
- 使用上面未出现的 coreAction
- 输出 JSON 之外的任何文字`;

/** 历史消息（只含正文，无工具卡片） */
export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** 规划请求的一条消息 */
export interface PlanChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** 装配输入 */
export interface PlanPromptInput {
  /** 意图聚焦产出的提示词（可能为空串） */
  focusPrompt: string;
  /** 本体索引（只读，意图聚焦侧） */
  ontology: OntologyIndex;
  /** 本轮工具的原样名（`guarded` 的 `name`） */
  toolNames: readonly string[];
  /** 派生键 → 原样工具名[] */
  nameIndex: ReadonlyMap<string, readonly string[]>;
  /** 规则闸门只读查询 */
  behaviorOf: (toolName: string) => BehaviorLookup | null;
  /** 历史（已按轮次过滤） */
  history: readonly HistoryMessage[];
  /** 本轮用户原话 */
  userInput: string;
  /** 上一次校验失败的反馈（重试时才有） */
  retryFeedback?: string;
}

/** 装配产物 */
export interface PlanPromptResult {
  system: string;
  messages: PlanChatMessage[];
  /** 供观测：system 总字符数（异常膨胀的唯一线索） */
  systemChars: number;
  /** 本轮可用 command 数（段 5 的覆盖数） */
  commandCount: number;
}

/** 装配完整输入 */
export function buildPlanPrompt(input: PlanPromptInput): PlanPromptResult {
  const commands = collectCommands(input);
  const segments = [
    ROLE_PROMPT,
    renderFocus(input.focusPrompt),
    renderOntology(input),
    renderFunctions(input),
    renderPrerequisites(commands),
    OUTPUT_FORMAT_PROMPT,
  ];
  return {
    system: segments.join('\n\n'),
    messages: buildMessages(input),
    systemChars: charLength(segments.join('\n\n')),
    commandCount: commands.length,
  };
}

/**
 * 段 2：意图聚焦结果（**直通**，只受 `FOCUS_PROMPT_HARD_CAP_CHARS` 防御性兜底）。
 *
 * 这里刻意不做业务截断：聚焦提示自身已按阶数剪裁，二次截断只会从末尾切掉「图路径」。
 */
function renderFocus(focusPrompt: string): string {
  const body = truncateByLines(focusPrompt.trim(), FOCUS_PROMPT_HARD_CAP_CHARS).trim();
  const head = '［意图聚焦结果｜本轮规划的唯一起点］\n以下内容是本轮已经过聚焦判定的能力与路径，请以此为起点设计计划：';
  const tail = '若某个必要步骤无法映射到聚焦结果或工具清单，请在 content 中说明原因，不要虚构能力。';
  if (body === '') return `${head}\n\n（本轮无聚焦结果，请只依据下方工具清单设计计划。）\n\n${tail}`;
  return `${head}\n\n${body}\n\n${tail}`;
}

/** 段 3：本体关系（关系三元组 + 概念与可执行行为，按本体分段） */
function renderOntology(input: PlanPromptInput): string {
  const blocks: string[] = ['［本体关系｜按本体分段］'];
  for (const definition of input.ontology.all) {
    blocks.push(renderOntologyBlock(definition, input));
  }
  if (blocks.length === 1) blocks.push('（本轮无可用的本体定义。）');
  return blocks.join('\n\n');
}

function renderOntologyBlock(definition: OntologyDefinition, input: PlanPromptInput): string {
  const title = definition.ontologyName ?? '(未命名本体)';
  const lines: string[] = [`■ ${title}（ontology_id=${definition.ontologyId}）`];

  if (definition.relations.length > 0) {
    lines.push('关系：');
    for (const relation of definition.relations) {
      lines.push(`- ${relation.source} —${relation.name}→ ${relation.target}`);
    }
  }

  lines.push('概念与可执行行为：');
  if (definition.concepts.length === 0) {
    lines.push('- （本本体未声明概念）');
    return lines.join('\n');
  }

  for (const concept of definition.concepts) {
    const name = concept.title === '' ? concept.name : `${concept.name}（${concept.title}）`;
    lines.push(`- ${name}`);
    const queries: string[] = [];
    const writes: string[] = [];
    for (const behavior of definition.behaviors) {
      if (behavior.concept !== concept.name) continue;
      const resolved = resolveDisplayName(behavior.name, input.nameIndex);
      const mounted = resolved !== null;
      const full = resolved ?? behavior.name;
      const lookup = mounted ? input.behaviorOf(full) : null;
      const isCommand = mounted
        ? lookup?.command === true
        : (behavior.opType ?? '').trim().toLowerCase() === 'command';
      const label = mounted ? behavior.name : `${behavior.name}（未挂载）`;
      if (isCommand) writes.push(label);
      else queries.push(label);
    }
    if (queries.length > 0) lines.push(`    query：${queries.join('、')}`);
    if (writes.length > 0) lines.push(`    command：${writes.join('、')}`);
    if (queries.length === 0 && writes.length === 0) lines.push('    （无可用行为）');
  }

  return lines.join('\n');
}

/** 段 4：可用函数（本体函数标关联概念；非本体函数标来源） */
function renderFunctions(input: PlanPromptInput): string {
  const ontologyFunctionNames = new Set<string>();
  const body: string[] = [];

  for (const definition of input.ontology.all) {
    for (const fn of definition.functions) {
      ontologyFunctionNames.add(normalizeKey(fn.name));
      const concepts = fn.relatedConcepts.length > 0 ? fn.relatedConcepts.join('、') : '（无）';
      const title = fn.title === '' ? fn.description : fn.title;
      body.push(`- ${fn.name}｜${title}｜关联概念 ${concepts}`);
    }
  }

  const behaviorNames = new Set<string>();
  for (const definition of input.ontology.all) {
    for (const behavior of definition.behaviors) behaviorNames.add(normalizeKey(behavior.name));
  }

  const others: string[] = [];
  for (const toolName of input.toolNames) {
    const key = normalizeKey(toolName);
    if (ontologyFunctionNames.has(key) || behaviorNames.has(key)) continue;
    const source = isBuiltin(toolName) ? '内置' : '外部';
    others.push(`- ${stripPrefix(toolName)}｜${source}`);
  }

  const blocks = ['［可用函数］'];
  blocks.push(body.length > 0 ? `本体函数：\n${body.join('\n')}` : '本体函数：\n（无）');
  blocks.push(others.length > 0 ? `非本体函数：\n${others.join('\n')}` : '非本体函数：\n（无）');
  return blocks.join('\n\n');
}

/** 段 5：命令前置约束（覆盖全部可用 command，不截断） */
function renderPrerequisites(commands: readonly CommandPrerequisite[]): string {
  const lines = [`命令前置约束（本轮可用 command 共 ${commands.length} 个）：`];
  if (commands.length === 0) lines.push('（无）');
  for (const item of commands) {
    const fns = item.relatedFunctions.length > 0 ? item.relatedFunctions.join('、') : '（无）';
    lines.push(`- ${item.label}：前置函数 ${fns}`);
  }
  return lines.join('\n');
}

interface CommandPrerequisite {
  label: string;
  relatedFunctions: string[];
  fullName: string;
}

/** 收集本轮全部 command（顺序稳定：按工具名排序，保证同输入同输出） */
function collectCommands(input: PlanPromptInput): CommandPrerequisite[] {
  const collected: CommandPrerequisite[] = [];
  const names = [...input.toolNames].sort((left, right) => left.localeCompare(right));
  for (const toolName of names) {
    const lookup = input.behaviorOf(toolName);
    if (lookup === null || !lookup.command) continue;
    collected.push({
      label: stripPrefix(toolName),
      relatedFunctions: lookup.relatedFunctions,
      fullName: toolName,
    });
  }
  return collected;
}

/** 构建 messages：最近 3 轮正文 + 本轮原话（+ 重试反馈） */
export function buildMessages(input: PlanPromptInput): PlanChatMessage[] {
  const limit = HISTORY_TURNS * 2;
  const recent = input.history.slice(-limit).map((message) => ({
    role: message.role,
    content: truncateTail(message.content.trim(), HISTORY_MESSAGE_MAX_CHARS),
  }));
  const messages: PlanChatMessage[] = recent.filter((message) => message.content !== '');
  /**
   * 生产链路上 `history` 是**含本轮**的 `req.messages`（`run-consume` 传入），
   * 末尾那条就是本轮用户原话；直接再 push 会让同一句话出现两次。
   * 2026-11-25 实测发现（真实 DeepSeek 的规划输入里 user 重复两遍）。
   */
  const tail = messages.at(-1);
  if (tail !== undefined && tail.role === 'user' && tail.content.trim() === input.userInput.trim()) {
    messages.pop();
  }
  messages.push({ role: 'user', content: input.userInput });
  if (input.retryFeedback !== undefined && input.retryFeedback !== '') {
    messages.push({ role: 'user', content: input.retryFeedback });
  }
  return messages;
}

/** 重试反馈文案（与 `CheckFailure` 一一对应，逐条列出） */
export function renderRetryFeedback(failures: ReadonlyArray<{ code: string; seqId: number | null; field: string | null; detail: string }>): string {
  const lines = ['上一版计划未通过校验，请修正后重新输出完整 JSON 数组（不要只给改动部分）：'];
  for (const failure of failures) {
    const where = failure.seqId === null ? '整批' : `第 ${failure.seqId} 步`;
    const field = failure.field === null ? '' : ` / ${failure.field}`;
    lines.push(`- ${where}${field}（${failure.code}）：${failure.detail}`);
  }
  return lines.join('\n');
}

/** 裸名 → 唯一原样工具名；解析不到或多个候选时返回 null */
function resolveDisplayName(name: string, nameIndex: ReadonlyMap<string, readonly string[]>): string | null {
  const found = new Set<string>();
  for (const key of matchKeys(name)) {
    for (const candidate of nameIndex.get(key) ?? []) found.add(candidate);
  }
  return found.size === 1 ? ([...found][0] as string) : null;
}

function isBuiltin(toolName: string): boolean {
  const bare = stripPrefix(toolName);
  return BUILTIN_TOOL_NAMES.includes(bare) || BUILTIN_TOOL_NAMES.includes(toolName);
}

function stripPrefix(toolName: string): string {
  const separator = toolName.indexOf('__');
  return separator >= 0 ? toolName.slice(separator + 2) : toolName;
}

function normalizeKey(name: string): string {
  return stripPrefix(name).trim().toLowerCase();
}

/** 按行截断到上限以内（不切半行） */
export function truncateByLines(text: string, maxChars: number): string {
  if (charLength(text) <= maxChars) return text;
  const kept: string[] = [];
  let used = 0;
  for (const line of text.split('\n')) {
    const cost = charLength(line) + 1;
    if (used + cost > maxChars) break;
    kept.push(line);
    used += cost;
  }
  return kept.join('\n');
}

/** 尾部截断并标注 */
export function truncateTail(text: string, maxChars: number): string {
  if (charLength(text) <= maxChars) return text;
  const chars = Array.from(text).slice(0, maxChars);
  return `${chars.join('')}（已截断）`;
}

function charLength(text: string): number {
  return Array.from(text).length;
}
