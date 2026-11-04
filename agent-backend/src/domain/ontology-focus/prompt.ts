/**
 * 聚焦提示铸造（016）。
 *
 * 形态为一条编号清单：首行固定前缀，其后每个技能一行 `n）…`。
 * 本体技能带显式字段 `ontology_name='…'` / `ontology_id='…'` 与
 * 「关联行为 / 关联函数（title（name））」；非本体技能只有技能名与「非本体技能」标注。
 *
 * **一个本体技能恒只有一个本体**（`SKILL.md` frontmatter 的单个 `ontology_id`），
 * 所以每个技能行最多出现一组本体字段——同一 `ontology_id` 被物化成多份文件时，
 * 只取首份文件的本体名与 id，不重复输出。
 *
 * 只描述"能做什么"，不带阈值、分数、工具名或执行指令；同本体的能力只挂到分数最高的
 * 技能名下，避免多技能共享本体时能力段重复。
 */
import type { CapabilitySelection } from './types.js';

/** 提示整体上限（字符），超过按完整条目截断 */
export const MAX_PROMPT_CHARS = 1200;

const PREFIX = '本轮请优先聚焦以下技能或工具（仅供参考，不必局限）';

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

interface PromptItem {
  name: string;
  /** 关联本体展示串（`ontology_name='X'，ontology_id='1'`），非本体技能为 null */
  ontology: string | null;
  behaviors: string[];
  functions: string[];
}

export interface ComposedPrompt {
  prompt: string;
  /** 是否因 1200 上限发生过截断 */
  truncated: boolean;
}

/**
 * 铸造提示：仅对入选技能与入选能力拼装；无技能时返回空串（调用方据此不追加）。
 */
export function composeFocusPrompt(
  skills: readonly PromptSkill[],
  capabilities: CapabilitySelection,
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

  const ownerByOntology = new Map<string, string>();
  for (const skill of selected) {
    if (!skill.isOntology || !skill.ontology) continue;
    if (!ownerByOntology.has(skill.ontology.id)) ownerByOntology.set(skill.ontology.id, skill.name);
  }

  const behaviorsBySkill = new Map<string, string[]>();
  const functionsBySkill = new Map<string, string[]>();
  for (const decision of capabilities.behaviors) {
    const owner = ownerByOntology.get(decision.ontologyId);
    if (!owner) continue;
    push(behaviorsBySkill, owner, `${clean(decision.title)}（${clean(decision.name)}）`);
  }
  for (const decision of capabilities.functions) {
    const owner = ownerByOntology.get(decision.ontologyId);
    if (!owner) continue;
    push(functionsBySkill, owner, `${clean(decision.title)}（${clean(decision.name)}）`);
  }

  const items: PromptItem[] = selected.map((skill) => ({
    name: clean(skill.name),
    // 本体技能恒有且仅有 1 个本体：提示里只出现一组字段
    ontology: skill.isOntology && skill.ontology ? renderOntologyRef(skill.ontology) : null,
    behaviors: [...(behaviorsBySkill.get(skill.name) ?? [])],
    functions: [...(functionsBySkill.get(skill.name) ?? [])],
  }));

  let prompt = render(items);
  let truncated = false;
  // 截断顺序：尾部技能的函数 → 尾部技能的行为 → 整个尾部技能条目（始终丢完整条目）
  while (prompt.length > MAX_PROMPT_CHARS && items.length > 0) {
    truncated = true;
    const last = items[items.length - 1]!;
    if (last.functions.length > 0) last.functions.pop();
    else if (last.behaviors.length > 0) last.behaviors.pop();
    else items.pop();
    prompt = render(items);
  }

  return { prompt: items.length === 0 ? '' : prompt, truncated };
}

function render(items: readonly PromptItem[]): string {
  if (items.length === 0) return '';
  const lines = items.map((item, index) => `${index + 1}）${renderItem(item)}`);
  return `${PREFIX}\n${lines.join('\n')}`;
}

function renderItem(item: PromptItem): string {
  if (item.ontology === null) return `${item.name}（非本体技能）`;
  const parts = ['本体技能', item.ontology];
  if (item.behaviors.length > 0) parts.push(`关联行为：${item.behaviors.join('、')}`);
  if (item.functions.length > 0) parts.push(`关联函数：${item.functions.join('、')}`);
  return `${item.name}（${parts.join('；')}）`;
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

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
