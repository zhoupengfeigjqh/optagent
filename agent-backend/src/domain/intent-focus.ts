/**
 * 意图聚焦（013）纯逻辑：候选归一 → noul 命题构造 → 分批 → 阈值筛选 → 提示铸造 → 处置判定。
 *
 * 设计要点（实测依据见 `specs/013-intent-focus/research.md` §"noul 决策"):
 * - 判定模型是**结构化决策模型**（Laya），只产出一组真值概率，不产出自然语言；
 * - 为**每个候选工具**各构造一条 `noul` 命题（"用户是否要求使用 X"）。noul 各题**互不
 *   竞争**，因此天然支持"多工具同时命中"，也不会因候选变多而摊薄；
 * - 不用 `choice`：单选把概率归一到 1，24 个候选时 top1 只剩 3%~8%，0.5 阈值全部落空；
 * - 命题文本用**展示名**（内置工具的中文 `label`，MCP 的 `server: tool`），
 *   聚焦提示用**工具名**——模型按工具名发起调用，人读展示名；
 * - 全量入选、**不设条数上限**：入选集合就是给主模型的一句参考，多选不会截断信息。
 *
 * 本文件 MUST 保持纯函数（无 IO、无时钟、无随机）：同输入必得同输出，测试可逐字断言。
 */
import type { SystemOneQuestion } from '../infra/laya-client.js';

/**
 * 单批题数上限。
 *
 * Laya 对**单题**有 `max_question_tokens = 256`、对**整条序列**（state + 最长题）有
 * `max_sequence_tokens = 1024`，但对**题数**没有硬上限（实测 70 题可正常返回）。
 * 这个值因此只承担两件事：单请求体大小可控、降级粒度可控——**与判定精度无关**
 * （实测：32 题一次发、切成 4 批 × 8 发，同题分数逐位相同）。
 */
export const MAX_QUESTIONS_PER_BATCH = 32;

/**
 * 候选工具总数上限（防御性）。
 *
 * 96 = 3 批 × 32：按 200 字 state、32 题约 1.8~2.2s 估算，3 批仍在 10s 预算内。
 * 超出按原序丢弃并在留档里标 `truncated`——总比超时后整轮降级好。
 */
export const MAX_CANDIDATES = 96;

/**
 * 默认分数阈值。
 *
 * 2026-10-26 随命题改版（任务式问法 + 极简判据）重新标定：分数整体上移，
 * 0.5 下平均每轮入选 2.4 个工具（其中约 1/8 是期望项），0.6 把入选压到 1.2 个
 * 而召回不降（3/8），0.65 起召回开始掉。故取 **0.6** 作拐点。
 */
export const DEFAULT_THRESHOLD = 0.6;

/**
 * 送入判定的本轮输入字符上限。
 *
 * 实测边界：中文 1800 字 ≈ 999 token（通过），2200 字触发 422 `too_long`；
 * 真实文本压缩率更低（约 0.8~1 token/字），故安全线在 900~1000 字。
 * 取 200 是保守值：题数越多、state 越长，总 prefill 越大（32 题 × 1000 字 = 23.7s）。
 */
export const MAX_STATE_CHARS = 200;

/** 展示名超长截断（命题里出现过长的展示名会把区分度打到 0） */
export const MAX_DISPLAY_CHARS = 40;

/** 对齐句首后的最短保留长度：太短说明切过头了，宁可不切 */
const MIN_STATE_AFTER_BREAK = 24;

/**
 * 聚焦提示固定前缀（逐字，规格 FR-004）。
 *
 * 措辞刻意"软"：本功能是**增强**而非约束——判定只看到 200 字输入与工具清单，
 * 它给出的是"本轮可能用得上"，不是"只许用这些"（FR-006 明确不改工具权限）。
 * 写成"请将当前规划重点聚焦于"会让主模型把参考当成硬指令，反而压掉更合适的工具。
 */
export const FOCUS_PROMPT_PREFIX = '本轮可优先考虑以下工具（仅供参考，不必局限）：';

/** 中文逗号分隔符 */
const SEPARATOR = '，';

/** 句末标点/换行：用于把截断点对齐到句首 */
const SENTENCE_BREAK = /[。！？；!?;\n]/;

/**
 * noul 的真/假判据。
 *
 * 实测结论（不要凭语感"优化"这里）：
 * 1. 给 `criteria` 比不给好：8 个工具的相关项最低值 0.329 → 0.708，间隔 0.301 → 0.471；
 * 2. 判据**越朴素越好**：写成"用户明确要求…"反而让无关项飙升（间隔恶化到 -0.186）。
 *
 * 2026-10-26 起用极简判据（`需要 / 不需要`）：分数整体上移，配合软措辞的聚焦提示
 * "多给几个"可以接受，阈值同步提到 0.6（见 `DEFAULT_THRESHOLD`）。
 */
const NOUL_CRITERIA = {
  true: '需要',
  false: '不需要',
} as const;

/** 本轮可用的一个工具（装配处传入） */
export interface ToolCandidate {
  name: string;
  /** 工具用途说明（本期不参与命题，仅留档与排障可用） */
  description: string;
  /** 展示名：内置工具的中文 label / MCP 的 `server: tool`；缺省回退 `name` */
  label?: string;
}

/** 处置结论（与 `data-model.md §6.2` 一致，共 5 态） */
export type IntentFocusDisposition = 'focused' | 'empty' | 'skipped' | 'degraded' | 'unconfigured';

/** 一个入选动作：本期每个动作对应一个工具标识（保留数组形态以便后续扩展"组合动作"） */
export interface FocusAction {
  tools: string[];
  score: number;
}

/** 筛选结果 */
export interface Selection {
  /** 全部 ≥ 阈值的动作，分数降序；同分按候选原序 */
  actions: FocusAction[];
  /** 聚焦提示原文；无入选时为空串 */
  focusPrompt: string;
  /** 低于阈值的工具名，仅留档分析用 */
  dropped: string[];
  /** 有效分数表（工具名 → noul 分数），仅含形状合法的取值 */
  scores: Record<string, number>;
}

/** 送入模型的输入（超长截断） */
export interface PreparedState {
  state: string;
  truncated: boolean;
}

/** 一批命题（`questions` 的键 = 该批工具的 `name`） */
export interface QuestionBatch {
  candidates: ToolCandidate[];
  questions: Record<string, SystemOneQuestion>;
}

/** 把阈值收敛到合法区间；非法值由配置层拒绝，这里只做防御 */
export function normalizeThreshold(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_THRESHOLD;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * 截断本轮输入，便于留档标注"已截断"。
 *
 * **取尾部**（不是取头部）：用户粘贴长材料的习惯是"材料在前、问题在后"，
 * 取头会把唯一的问题截掉，判定只能看到一堆无关正文。
 * 截断点尽量对齐到句首，避免从词中间切开。
 */
export function prepareState(input: string): PreparedState {
  if (input.length <= MAX_STATE_CHARS) return { state: input, truncated: false };
  const tail = input.slice(-MAX_STATE_CHARS);
  const match = SENTENCE_BREAK.exec(tail);
  if (match && tail.length - (match.index + 1) >= MIN_STATE_AFTER_BREAK) {
    return { state: tail.slice(match.index + 1).trim(), truncated: true };
  }
  return { state: tail, truncated: true };
}

/** 候选去空名、按原序截断到总数上限 */
export function selectCandidates(candidates: readonly ToolCandidate[]): {
  candidates: ToolCandidate[];
  truncated: boolean;
} {
  const valid = candidates.filter((c) => c.name.length > 0);
  if (valid.length <= MAX_CANDIDATES) return { candidates: valid, truncated: false };
  return { candidates: valid.slice(0, MAX_CANDIDATES), truncated: true };
}

/** 工具的展示名：`label` 优先（内置工具是中文），缺省回退工具名，超长截断 */
export function displayNameOf(candidate: ToolCandidate): string {
  const label = (candidate.label ?? '').trim();
  const text = label.length > 0 ? label : candidate.name;
  if (text.length <= MAX_DISPLAY_CHARS) return text;
  return text.slice(0, MAX_DISPLAY_CHARS);
}

/**
 * 构造单批命题表：**每个候选一条 `noul`**，键即工具名。
 *
 * 键用工具名而非 `t1..tN` 下标：响应 `answers[qid].noul` 直接按工具名回传，
 * 省掉一层"下标 → 名字"的对齐（对齐写错时表现为"工具串位"，最难排查）。
 *
 * 命题模板固定为 `本轮用户发起的任务是否需要使用 {展示名} ？`（2026-10-26 用户拍板，
 * 依据见下方实测对比）。
 *
 * 历代措辞与实测（8 工具 × 10 条业务输入，`scripts/calibrate-intent-focus.mjs`）：
 * | 措辞 | top1 | 入选精确率 | 召回 | 每轮入选数 |
 * |---|---|---|---|---|
 * | 是否**要求使用** X + 冗长判据 | 3/8 | 2/4 | 2/8 | 0.4（大量漏选） |
 * | 是否**要求使用** X + 极简判据 | 3/8 | 3/17 | 3/8 | 1.7 |
 * | **任务是否需要使用** X + 极简判据（现行） | 2/8 | 3/12 | 3/8 | 1.2（阈值 0.6） |
 *
 * 现行措辞的召回不低于旧版、噪声靠阈值收敛；因为聚焦提示已改为"仅供参考"的软措辞，
 * 多给几个的代价低于漏选，故采用。
 */
export function buildQuestions(
  candidates: readonly ToolCandidate[],
): Record<string, SystemOneQuestion> {
  const questions: Record<string, SystemOneQuestion> = {};
  for (const candidate of candidates) {
    questions[candidate.name] = {
      type: 'noul',
      instructions: `本轮用户发起的任务是否需要使用 ${displayNameOf(candidate)} ？`,
      criteria: { ...NOUL_CRITERIA },
    };
  }
  return questions;
}

/** 按 `batchSize` 把候选切成等长批（末批可短） */
export function buildQuestionBatches(
  candidates: readonly ToolCandidate[],
  batchSize = MAX_QUESTIONS_PER_BATCH,
): QuestionBatch[] {
  const size = batchSize > 0 ? Math.floor(batchSize) : MAX_QUESTIONS_PER_BATCH;
  const batches: QuestionBatch[] = [];
  for (let start = 0; start < candidates.length; start += size) {
    const slice = candidates.slice(start, start + size);
    batches.push({ candidates: slice, questions: buildQuestions(slice) });
  }
  return batches;
}

/**
 * 分数 → 动作：`≥ threshold` 的按分数降序**全量保留**；
 * 同分按候选原序（保证确定性）。无效分数（非数字 / 越界）直接丢弃。
 *
 * 不设条数上限：聚焦提示只是给主模型的一句参考，多列几个不会改变硬约束，
 * 而截断会丢掉本来已经判对的工具。
 */
export function selectActions(input: {
  candidates: readonly ToolCandidate[];
  scores: Readonly<Record<string, number>>;
  threshold?: number;
}): Selection {
  const threshold = normalizeThreshold(input.threshold);

  const valid: Record<string, number> = {};
  const hits: Array<{ name: string; score: number; index: number }> = [];

  input.candidates.forEach((candidate, index) => {
    const raw = input.scores[candidate.name];
    if (raw === undefined || !Number.isFinite(raw)) return;
    const score = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    valid[candidate.name] = score;
    if (score >= threshold) hits.push({ name: candidate.name, score, index });
  });

  hits.sort((a, b) => (b.score === a.score ? a.index - b.index : b.score - a.score));
  const pickedNames = new Set(hits.map((h) => h.name));
  const dropped = Object.keys(valid).filter((name) => !pickedNames.has(name));

  const actions: FocusAction[] = hits.map((hit) => ({ tools: [hit.name], score: hit.score }));
  return {
    actions,
    focusPrompt: composeFocusPrompt(actions),
    dropped,
    scores: valid,
  };
}

/**
 * 铸造聚焦提示：固定前缀 + **工具名**去重后按序以中文逗号分隔；无动作时返回空串。
 *
 * 这里用工具名而不是展示名：主模型是按工具名（`read_file`）发起调用的，
 * 写"读取文件"它还得自己映射一次，多一层不必要的推理。
 */
export function composeFocusPrompt(actions: readonly FocusAction[]): string {
  const names: string[] = [];
  for (const action of actions) {
    for (const tool of action.tools) {
      if (tool.length > 0 && !names.includes(tool)) names.push(tool);
    }
  }
  if (names.length === 0) return '';
  return `${FOCUS_PROMPT_PREFIX}${names.join(SEPARATOR)}`;
}

/** 处置判定入参 */
export type DispositionInput =
  | { kind: 'disabled' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'unconfigured'; reason: string }
  | { kind: 'failed'; reason: string }
  | { kind: 'ok'; candidates: number; selected: number };

/** 判定结论（唯一形态：处置 + 原因） */
export interface DispositionResult {
  disposition: IntentFocusDisposition;
  reason: string | null;
}

/**
 * 处置判定（唯一实现）。
 *
 * 重载让"开关关闭就没有结论"这件事由**类型**表达：`disabled` 恒为 `null`
 * （规格 FR-032：关闭的轮次不留档），其余四类恒有结论——调用方因此不必写
 * `?.` / `??` 这类永远走不到另一侧的防御分支（死分支既误导读者又拉低分支覆盖）。
 */
export function decideDisposition(input: { kind: 'disabled' }): null;
export function decideDisposition(
  input: Exclude<DispositionInput, { kind: 'disabled' }>,
): DispositionResult;
export function decideDisposition(input: DispositionInput): DispositionResult | null {
  switch (input.kind) {
    case 'disabled':
      return null;
    case 'skipped':
      return { disposition: 'skipped', reason: input.reason };
    case 'unconfigured':
      return { disposition: 'unconfigured', reason: input.reason };
    case 'failed':
      return { disposition: 'degraded', reason: input.reason };
    case 'ok':
      if (input.candidates === 0) return { disposition: 'empty', reason: 'no_tools' };
      if (input.selected === 0) return { disposition: 'empty', reason: 'below_threshold' };
      return { disposition: 'focused', reason: null };
  }
}
