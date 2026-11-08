/**
 * 聚焦提示铸造（016 / 019）。
 *
 * 形态：首行固定前缀，其后每个入选技能一个编号块——第一行是技能本身，
 * 后续缩进行按**来源分段**（概念 / 上游概念 / 直接命中 / 上游参考）。
 * 分段的意义：模型要能区分"用户意图直接相关的"与"因对象关系带出来的"，
 * 否则发散项会与直接命中混成一锅，等于把阈值的结果抹平。
 *
 * 三处与 016 的差异（2026-11-08 019）：
 * 1. 概念成为提示的一等条目（`关联概念` / `上游概念`），**不设上限、不截断**；
 * 2. 上游发散行为单独成段（`上游参考`），与 `直接命中` 分开；
 * 3. 总长度上限按**聚焦阶数**分档（0→1200 / 1→1600 / 2→2000），超限**只从行为段尾部丢**，
 *    概念段永不截断（用户口径）。
 *
 * **一个本体技能恒只有一个本体**（`SKILL.md` frontmatter 的单个 `ontology_id`），
 * 所以每个技能块最多出现一组本体字段；同一本体被多个技能引用时，概念与行为只归属于
 * 分数最高的那个技能，避免重复输出。
 *
 * 只描述"能做什么 / 该看什么"，不带阈值、分数、工具名或执行指令。
 */
import type { CapabilitySelection } from './types.js';

/** 提示长度上限（阶数 0 的基准值，字符） */
export const MAX_PROMPT_CHARS = 1200;

/** 阶数 → 提示总长度上限：越深的发散允许越长的上下文 */
export function maxPromptChars(depth: number): number {
  if (depth <= 0) return MAX_PROMPT_CHARS;
  return depth === 1 ? 1600 : 2000;
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

/** 提示里的概念条目：`hop = 0` 为直接命中，`≥ 1` 为上游发散 */
export interface PromptConcept {
  ontologyId: string;
  name: string;
  title: string;
  hop: number;
}

/** 提示里的上游发散行为 */
export interface PromptBehavior {
  ontologyId: string;
  name: string;
  title: string;
}

export interface ComposeOptions {
  /** 概念（直接命中 + 上游），按本体归属到技能块 */
  concepts?: readonly PromptConcept[];
  /** 上游发散行为（下游不进提示） */
  upstreamBehaviors?: readonly PromptBehavior[];
  /** 总长度上限；缺省按阶数 0 的 1200（调用方负责按阶数传入） */
  maxChars?: number;
}

interface PromptItem {
  name: string;
  /** 关联本体展示串（`ontology_name='X'，ontology_id='1'`），非本体技能为 null */
  ontology: string | null;
  directConcepts: string[];
  upstreamConcepts: string[];
  behaviors: string[];
  upstreamBehaviors: string[];
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

  // 同一本体被多个入选技能引用时，概念与行为只归属于分数最高的那个技能
  const ownerByOntology = new Map<string, string>();
  for (const skill of selected) {
    if (!skill.isOntology || !skill.ontology) continue;
    if (!ownerByOntology.has(skill.ontology.id)) ownerByOntology.set(skill.ontology.id, skill.name);
  }

  const items: PromptItem[] = selected.map((skill) => ({
    name: clean(skill.name),
    // 本体技能恒有且仅有 1 个本体：提示里只出现一组字段
    ontology: skill.isOntology && skill.ontology ? renderOntologyRef(skill.ontology) : null,
    directConcepts: [],
    upstreamConcepts: [],
    behaviors: [],
    upstreamBehaviors: [],
  }));

  const byName = new Map(items.map((item) => [item.name, item] as const));

  for (const concept of options.concepts ?? []) {
    const owner = ownerByOntology.get(concept.ontologyId);
    const item = owner ? byName.get(owner) : undefined;
    if (!item) continue;
    const label = `${clean(concept.title || concept.name)}（${clean(concept.name)}）`;
    if (concept.hop <= 0) item.directConcepts.push(label);
    else item.upstreamConcepts.push(label);
  }

  for (const decision of capabilities.behaviors) {
    const owner = ownerByOntology.get(decision.ontologyId);
    const item = owner ? byName.get(owner) : undefined;
    if (!item) continue;
    item.behaviors.push(`${clean(decision.title || decision.name)}（${clean(decision.name)}）`);
  }

  for (const behavior of options.upstreamBehaviors ?? []) {
    const owner = ownerByOntology.get(behavior.ontologyId);
    const item = owner ? byName.get(owner) : undefined;
    if (!item) continue;
    item.upstreamBehaviors.push(`${clean(behavior.title || behavior.name)}（${clean(behavior.name)}）`);
  }

  const maxChars = options.maxChars ?? MAX_PROMPT_CHARS;
  let prompt = render(items);
  let truncated = false;
  // 截断顺序：先丢「上游参考」（发散项），再丢「直接命中」；概念段永不丢
  while (prompt.length > maxChars) {
    if (!dropLast(items, 'upstreamBehaviors') && !dropLast(items, 'behaviors')) break;
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
  if (item.directConcepts.length > 0) lines.push(`   关联概念：${item.directConcepts.join('、')}`);
  if (item.upstreamConcepts.length > 0) lines.push(`   上游概念：${item.upstreamConcepts.join('、')}`);
  if (item.behaviors.length > 0) lines.push(`   直接命中：${item.behaviors.join('、')}`);
  if (item.upstreamBehaviors.length > 0) lines.push(`   上游参考：${item.upstreamBehaviors.join('、')}`);
  return lines.join('\n');
}

/** 从**尾部**丢一条行为（先扫全部条目的指定段，保证上游整段先被消耗完） */
function dropLast(items: PromptItem[], key: 'upstreamBehaviors' | 'behaviors'): boolean {
  for (let index = items.length - 1; index >= 0; index--) {
    const list = items[index]![key];
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
