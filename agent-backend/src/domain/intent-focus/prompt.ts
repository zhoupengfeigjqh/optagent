/**
 * 聚焦提示铸造（016 / 019，2026-11-13 修订）。
 *
 * 形态：首行固定前缀，其后每个入选技能一个编号块——第一行是技能本身，其后两段：
 * 1. `直接命中：` 用户意图命中的行为（一行，顿号分隔）；
 * 2. `上游路径：` **一行一条五元组**（`行为—概念—关系—概念—行为`），见 `paths.ts`。
 *
 * 为什么把"关联概念 / 上游概念 / 上游参考"三段换成五元组（用户 2026-11-13 拍板）：
 * 分段列表只给出元素集合，**连接关系要靠模型自己猜**；五元组把一条推理的最小单元压成一行，
 * 起点行为挂在哪个概念、经哪条关系到了哪个概念、那个概念下能调什么，一行读完。
 * 概念不再单独成段（它在五元组里已经出现），避免同一概念在提示里重复两遍白占预算。
 *
 * 语义清晰的两条硬规矩：
 * - 方向与读向分开写：`[上游]` 表示这一跳走向主数据；关系名后的 `→` / `←` 只表示
 *   "关系名要不要反读"（例：`N:1` 的 `记录原材料` 从采购单走向原材料时要正读）；
 * - 链尾没有行为时写 `（无可用行为）`，不省略整行——模型需要知道"这条上游到此为止"。
 *
 * 截断改成**行级**（这是与 016 最大的实现差异）：五元组是一行一个原子，不能再按"段尾 pop"。
 * 顺序：先丢链尾无行为的行 → 再丢跳数大的行 → 再丢起点得分低的行；**每个起点行为至少留一行**，
 * 全部路径行丢完后才动 `直接命中`（与旧口径一致：直接命中最后才丢）。
 *
 * 只描述"能做什么 / 该看什么"，不带阈值、分数、工具名或执行指令。
 */
import type { FocusPath } from './paths.js';
import type { CapabilitySelection } from './types.js';

/**
 * 提示长度上限（阶数 0 的基准值，字符）。
 *
 * 2026-11-20：1200 → 2000。原值按"每个入选行为一行、最多 32 个技能"估的，
 * 实测发散发到二阶时经常在 `直接命中` 段就被截断，路径行几乎全被丢掉——
 * 而截断是**整行丢弃**，一次截断就丢掉一整条五元组，信息损失比多花 token 严重。
 */
export const MAX_PROMPT_CHARS = 2000;

/** 阶数 → 提示总长度上限：越深的发散允许越长的上下文（2000 / 3000 / 4000） */
export function maxPromptChars(depth: number): number {
  if (depth <= 0) return MAX_PROMPT_CHARS;
  return depth === 1 ? 3000 : 4000;
}

const PREFIX = '本轮的任务与以下技能、本体概念与本体行为密切相关，请重点关注（仅供参考，不必局限）';

/** 提示里的本体引用（id 用于归属，name 用于展示） */
export interface PromptOntology {
  id: string;
  name: string | null;
}

/** 提示里的技能视图（与判定候选解耦，避免提示层依赖题号） */
export interface PromptSkill {
  name: string;
  isOntology: boolean;
  /** 关联本体；本体技能恒有且仅有 1 个，非本体技能为 null */
  ontology: PromptOntology | null;
  score: number | null;
  /** 原序，用于同分稳定 */
  order: number;
}

export interface ComposeOptions {
  /** 五元组路径（只含**上游**；下游只进卡片，不进提示） */
  paths?: readonly FocusPath[];
  /** 总长度上限；缺省按阶数 0 的 2000（调用方负责按阶数传入） */
  maxChars?: number;
}

/** 渲染后的一条路径行 + 截断所需的排序信息 */
interface PathLine {
  text: string;
  /** 起点行为键：同一键至少保留一行 */
  behaviorKey: string;
  hop: number;
  deadEnd: boolean;
  score: number;
  /** 稳定序：全局路径下标 */
  order: number;
}

interface PromptItem {
  name: string;
  /** 关联本体展示串（`ontology_name='X'，ontology_id='1'`），非本体技能为 null */
  ontology: string | null;
  behaviors: string[];
  paths: PathLine[];
}

export interface ComposedPrompt {
  prompt: string;
  /** 是否因长度上限发生过截断 */
  truncated: boolean;
}

/**
 * 铸造提示：仅对入选技能与入选行为拼装；无技能时返回空串（调用方据此不追加）。
 */
export function composeFocusPrompt(
  skills: readonly PromptSkill[],
  capabilities: CapabilitySelection,
  options: ComposeOptions = {},
): ComposedPrompt {
  const selected = skills
    .filter((skill) => skill.name !== '')
    .sort((a, b) => {
      const scoreA = a.score ?? Number.NEGATIVE_INFINITY;
      const scoreB = b.score ?? Number.NEGATIVE_INFINITY;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return a.order - b.order;
    });
  if (selected.length === 0) return { prompt: '', truncated: false };

  // 同一本体被多个入选技能引用时，行为与路径只归属于分数最高的那个技能
  const ownerByOntology = new Map<string, string>();
  for (const skill of selected) {
    if (!skill.isOntology || !skill.ontology) continue;
    if (!ownerByOntology.has(skill.ontology.id)) ownerByOntology.set(skill.ontology.id, skill.name);
  }

  const items: PromptItem[] = selected.map((skill) => ({
    name: clean(skill.name),
    // 本体技能恒有且仅有 1 个本体：提示里只出现一组字段
    ontology: skill.isOntology && skill.ontology ? renderOntologyRef(skill.ontology) : null,
    behaviors: [],
    paths: [],
  }));

  const byName = new Map(items.map((item) => [item.name, item] as const));

  for (const decision of capabilities.behaviors) {
    const owner = ownerByOntology.get(decision.ontologyId);
    const item = owner ? byName.get(owner) : undefined;
    if (!item) continue;
    item.behaviors.push(`${clean(decision.title || decision.name)}（${clean(decision.name)}）`);
  }

  (options.paths ?? []).forEach((path, order) => {
    const owner = ownerByOntology.get(path.ontologyId);
    const item = owner ? byName.get(owner) : undefined;
    if (!item) return;
    item.paths.push({
      text: renderPath(path),
      behaviorKey: `${path.ontologyId}\u0000${path.behavior.name}`,
      hop: path.hop,
      deadEnd: path.toBehavior === null,
      score: path.score ?? 0,
      order,
    });
  });

  const maxChars = options.maxChars ?? MAX_PROMPT_CHARS;
  let prompt = render(items);
  let truncated = false;
  // 截断顺序：路径行（行级，见 `dropWorstPathLine`）→ 直接命中（尾部 pop，与 016 一致）
  while (prompt.length > maxChars) {
    if (!dropWorstPathLine(items) && !dropLastBehavior(items)) break;
    truncated = true;
    prompt = render(items);
  }

  return { prompt: items.length === 0 ? '' : prompt, truncated };
}

function render(items: readonly PromptItem[]): string {
  if (items.length === 0) return '';
  const blocks = items.map((item, index) => `${index + 1}）${renderItem(item)}`);
  return `${PREFIX}\n${blocks.join('\n')}`;
}

function renderItem(item: PromptItem): string {
  if (item.ontology === null) return `${item.name}（非本体技能）`;
  const lines = [`${item.name}（本体技能；${item.ontology}）`];
  if (item.behaviors.length > 0) lines.push(`   直接命中：${item.behaviors.join('、')}`);
  // 段头单独一行：这不是"参考列表"，而是"若干条推理路径"，先说清再逐行给
  if (item.paths.length > 0) {
    lines.push('   上游路径：');
    for (const path of item.paths) lines.push(`     ${path.text}`);
  }
  return lines.join('\n');
}

/**
 * 一条五元组：
 * `行为（name）—〔概念(title)name〕—[上游]关系名→〔概念(title)name〕—→行为（name）`
 *
 * 括号形态刻意分工：行为用全角括号（与 `直接命中` 行一致），概念用半角括号并套 `〔〕`
 * （表示"这是本体里的类型名"），模型不会把两者混读。
 */
export function renderPath(path: FocusPath): string {
  const behavior = `${clean(path.behavior.title || path.behavior.name)}（${clean(path.behavior.name)}）`;
  const from = `${clean(path.fromConcept.title || path.fromConcept.name)}(${clean(path.fromConcept.name)})`;
  const to = `${clean(path.toConcept.title || path.toConcept.name)}(${clean(path.toConcept.name)})`;
  const direction = path.direction === 'upstream' ? '上游' : '下游';
  // 箭头只表示关系名的读向，不表示上下游（上下游由 [上游]/[下游] 表达）
  const arrow = path.readability === 'forward' ? '→' : '←';
  const relation = `${clean(path.relation.title || path.relation.name)}${arrow}`;
  const tail =
    path.toBehavior === null
      ? '—→（无可用行为）'
      : `—→${clean(path.toBehavior.title || path.toBehavior.name)}（${clean(path.toBehavior.name)}）`;
  return `${behavior}—〔${from}〕—[${direction}]${relation}〔${to}〕${tail}`;
}

/**
 * 丢掉"最该丢"的一条路径行（**行级原子**，不会留下半截五元组）。
 *
 * 排序：链尾无行为 → 跳数大 → 起点得分低 → 靠后。
 *
 * 唯一保护：**入选行为的第一跳行**至少留一条（否则模型会以为这个行为没有任何上下文，
 * 比不出现更糟）。保护只对 `hop === 1` 生效——第 2 跳起的起点行为是接续出来的，
 * 它的行被清空不影响"用户意图命中了什么"；若也保护它，会出现"每条链都只有一行、
 * 谁都删不掉"的死局，最后只能去砍直接命中。
 */
function dropWorstPathLine(items: readonly PromptItem[]): boolean {
  let victim: { item: PromptItem; index: number; rank: number[] } | null = null;

  for (const item of items) {
    const protectedCounts = new Map<string, number>();
    for (const line of item.paths) {
      if (line.hop !== 1) continue;
      protectedCounts.set(line.behaviorKey, (protectedCounts.get(line.behaviorKey) ?? 0) + 1);
    }
    for (let index = 0; index < item.paths.length; index += 1) {
      const line = item.paths[index]!;
      if (line.hop === 1 && (protectedCounts.get(line.behaviorKey) ?? 0) <= 1) continue;
      const rank = [line.deadEnd ? 0 : 1, -line.hop, line.score, -line.order];
      if (victim === null || compareRank(rank, victim.rank) < 0) victim = { item, index, rank };
    }
  }

  if (victim === null) return false;
  victim.item.paths.splice(victim.index, 1);
  return true;
}

/** 字典序比较（数值已按"越小越先丢"编码好） */
function compareRank(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    const diff = left[index]! - right[index]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 从**尾部**丢一条直接命中行为（先扫全部条目，保证靠后的技能先被消耗） */
function dropLastBehavior(items: readonly PromptItem[]): boolean {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const list = items[index]!.behaviors;
    if (list.length > 0) {
      list.pop();
      return true;
    }
  }
  return false;
}

/** 本体引用：显式字段形态，便于模型把 name 与 id 分开理解 */
function renderOntologyRef(ontology: PromptOntology): string {
  const id = `ontology_id='${clean(ontology.id)}'`;
  if (!ontology.name) return id;
  return `ontology_name='${clean(ontology.name)}'，${id}`;
}

/** 单行片段：换行、制表符、连续空白统一压成单个空格 */
function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
