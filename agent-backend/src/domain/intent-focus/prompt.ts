import type { FocusPath } from './paths.js';
import type { CapabilitySelection } from './types.js';

export const MAX_PROMPT_CHARS = 4000;

/** 阶数 → 提示总长度上限：越深的发散允许越长的上下文（4000 / 5000 / 6000） */
export function maxPromptChars(depth: number): number {
  if (depth <= 0) return MAX_PROMPT_CHARS;
  return depth === 1 ? 5000 : 6000;
}

export const PROMPT_PREFIX = '［聚焦参考］以下为背景知识，不是工具清单；工具调用仍以工具清单为准。';

export interface PromptOntology {
  id: string;
  name: string | null;
}

/** 提示里的技能视图（与判定候选解耦，避免提示层依赖题号） */
export interface PromptSkill {
  name: string;
  isOntology: boolean;
  ontology: PromptOntology | null;
  score: number | null;
  order: number;
}

export interface ComposeOptions {
  paths?: readonly FocusPath[];
  /** 总长度上限；缺省按阶数 0 的 4000（调用方负责按阶数传入） */
  maxChars?: number;
}

interface PathLine {
  text: string;
  behaviorKey: string;
  hop: number;
  deadEnd: boolean;
  score: number;
  order: number;
}

/**
 * 关键行为条目。
 *
 * `kind` 只服务于剪枝优先级（取数行为先丢），不参与展示——提示里两类条目形态一致，
 * 避免模型把它们当成两种能力。
 */
interface BehaviorLine {
  text: string;
  kind: 'direct' | 'query';
  ontologyId: string;
  name: string;
}

interface FunctionLine {
  ontologyId: string;
  text: string;
  concepts: { name: string; queries: string[] }[];
}

interface PromptItem {
  name: string;
  ontology: string | null;
  behaviors: BehaviorLine[];
  functions: FunctionLine[];
  paths: PathLine[];
}

export interface ComposedPrompt {
  prompt: string;
  /** 是否因长度上限发生过截断 */
  truncated: boolean;
}

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

  const ownerByOntology = new Map<string, string>();
  for (const skill of selected) {
    if (!skill.isOntology || !skill.ontology) continue;
    if (!ownerByOntology.has(skill.ontology.id)) ownerByOntology.set(skill.ontology.id, skill.name);
  }

  const items: PromptItem[] = selected.map((skill) => ({
    name: clean(skill.name),
    ontology: skill.isOntology && skill.ontology ? renderOntology(skill.ontology) : null,
    behaviors: [],
    functions: [],
    paths: [],
  }));

  const byName = new Map(items.map((item) => [item.name, item] as const));
  const itemOf = (ontologyId: string): PromptItem | undefined => {
    const owner = ownerByOntology.get(ontologyId);
    return owner ? byName.get(owner) : undefined;
  };

  for (const decision of capabilities.behaviors) {
    const item = itemOf(decision.ontologyId);
    if (!item) continue;
    item.behaviors.push({
      text: behaviorText(decision.title, decision.name, decision.concept),
      kind: 'direct',
      ontologyId: decision.ontologyId,
      name: decision.name,
    });
  }

  for (const fn of capabilities.functions) {
    const item = itemOf(fn.ontologyId);
    if (!item) continue;
    item.functions.push({
      ontologyId: fn.ontologyId,
      text: label(fn.title, fn.name),
      concepts: fn.relatedConcepts
        .map((concept) => clean(concept))
        .filter((concept) => concept !== '')
        .map((concept) => ({ name: concept, queries: [] })),
    });
  }

  const directKeys = new Set(capabilities.behaviors.map((b) => keyOf(b.ontologyId, b.name)));
  for (const query of capabilities.conceptQueries) {
    const item = itemOf(query.ontologyId);
    if (!item) continue;
    const key = keyOf(query.ontologyId, query.name);
    if (!directKeys.has(key)) {
      directKeys.add(key);
      item.behaviors.push({
        text: behaviorText(query.title, query.name, query.concept),
        kind: 'query',
        ontologyId: query.ontologyId,
        name: query.name,
      });
    }
    for (const fn of item.functions) {
      if (fn.ontologyId !== query.ontologyId) continue;
      const concept = fn.concepts.find((entry) => entry.name === clean(query.concept));
      if (concept && !concept.queries.includes(query.name)) concept.queries.push(query.name);
    }
  }

  (options.paths ?? []).forEach((path, order) => {
    const item = itemOf(path.ontologyId);
    if (!item) return;
    item.paths.push({
      text: renderPath(path),
      behaviorKey: keyOf(path.ontologyId, path.behavior.name),
      hop: path.hop,
      deadEnd: path.toBehavior === null,
      score: path.score ?? 0,
      order,
    });
  });

  const maxChars = options.maxChars ?? MAX_PROMPT_CHARS;
  let prompt = render(items);
  let truncated = false;
  while (prompt.length > maxChars) {
    if (
      !dropWorstPathLine(items) &&
      !dropQueryLine(items) &&
      !dropFunctionLine(items) &&
      !dropDirectBehaviorLine(items)
    ) {
      break;
    }
    truncated = true;
    prompt = render(items);
  }

  return { prompt: items.length === 0 ? '' : prompt, truncated };
}

function render(items: readonly PromptItem[]): string {
  if (items.length === 0) return '';
  const blocks = items.map((item) => renderItem(item));
  return `${PROMPT_PREFIX}\n${blocks.join('\n\n')}`;
}

function renderItem(item: PromptItem): string {
  const sections: string[] = [item.ontology === null ? `技能 ${item.name}（非本体技能）` : `技能 ${item.name} → ${item.ontology}`];

  if (item.behaviors.length > 0) {
    sections.push(['关键行为', ...item.behaviors.map((entry) => `· ${entry.text}`)].join('\n'));
  }

  if (item.functions.length > 0) {
    sections.push(['关键函数', ...item.functions.map(renderFunctionLine)].join('\n'));
  }

  if (item.paths.length > 0) {
    const hops = item.paths.reduce((max, path) => Math.max(max, path.hop), 0);
    const lines = item.paths.map((path) => path.text);
    sections.push(
      [`图路径（上游 ${hops} 跳；→/← 为本体边方向，按从左到右即本轮路径）`, ...lines].join('\n'),
    );
  }

  return sections.join('\n\n');
}

function renderFunctionLine(fn: FunctionLine): string {
  const refs = fn.concepts.map((concept) =>
    concept.queries.length === 0
      ? `@${concept.name}`
      : `@${concept.name} → ${concept.queries.join('、')}`,
  );
  return refs.length === 0 ? `· ${fn.text}` : `· ${fn.text} ${refs.join('、')}`;
}

export function renderPath(path: FocusPath): string {
  const behavior = label(path.behavior.title, path.behavior.name);
  const relation = clean(path.relation.title || path.relation.name);
  const edge = path.readability === 'forward' ? `—〔${relation}〕→` : `←〔${relation}〕—`;
  const tail =
    path.toBehavior === null
      ? '→（无可用行为）'
      : `→ ${label(path.toBehavior.title, path.toBehavior.name)}`;
  return `${behavior} @${clean(path.fromConcept.name)} ${edge} ${clean(path.toConcept.name)} ${tail}`;
}

function behaviorText(title: string, name: string, concept: string | null): string {
  const base = label(title, name);
  const ref = concept === null ? '' : clean(concept);
  return ref === '' ? base : `${base} @${ref}`;
}

function renderOntology(ontology: PromptOntology): string {
  const id = `ontology_id=${clean(ontology.id)}`;
  return ontology.name === null ? `本体（${id}）` : `本体 ${clean(ontology.name)}（${id}）`;
}

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

/**
 * 丢一条取数行为行（从尾部），并把函数条目里指向它的 `→ 行为名` 引用一并摘掉。
 *
 * 必须成对处理：只删行会留下 `@PurchaseRecord → QueryPurchaseRecords` 这种指向
 * 不存在条目的悬空引用，模型会以为"还有个行为没列出来"。
 */
function dropQueryLine(items: readonly PromptItem[]): boolean {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    for (let cursor = item.behaviors.length - 1; cursor >= 0; cursor -= 1) {
      const entry = item.behaviors[cursor]!;
      if (entry.kind !== 'query') continue;
      item.behaviors.splice(cursor, 1);
      unlinkQuery(items, entry);
      return true;
    }
  }
  return false;
}

function unlinkQuery(items: readonly PromptItem[], entry: BehaviorLine): void {
  for (const item of items) {
    for (const fn of item.functions) {
      if (fn.ontologyId !== entry.ontologyId) continue;
      for (const concept of fn.concepts) {
        const at = concept.queries.indexOf(entry.name);
        if (at >= 0) concept.queries.splice(at, 1);
      }
    }
  }
}

function dropFunctionLine(items: readonly PromptItem[]): boolean {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const functions = items[index]!.functions;
    if (functions.length > 0) {
      functions.pop();
      return true;
    }
  }
  return false;
}

function dropDirectBehaviorLine(items: readonly PromptItem[]): boolean {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const behaviors = items[index]!.behaviors;
    for (let cursor = behaviors.length - 1; cursor >= 0; cursor -= 1) {
      if (behaviors[cursor]!.kind !== 'direct') continue;
      behaviors.splice(cursor, 1);
      return true;
    }
  }
  return false;
}

function compareRank(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    const diff = left[index]! - right[index]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

function label(title: string, name: string): string {
  const cleanTitle = clean(title);
  const cleanName = clean(name);
  if (cleanTitle === '' || cleanTitle === cleanName) return cleanName;
  return `${cleanTitle} ${cleanName}`;
}

function keyOf(ontologyId: string, name: string): string {
  return `${ontologyId}\u0000${name}`;
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
