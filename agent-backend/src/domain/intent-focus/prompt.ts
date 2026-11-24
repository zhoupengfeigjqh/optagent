/**
 * 聚焦提示铸造（016 / 019 / 020，2026-11-24 改为「分节 + 图路径」形态）。
 *
 * 形态（用户 2026-11-24 拍板）：
 *
 * ```text
 * ［聚焦参考］以下为背景知识，不是工具清单；工具调用仍以工具清单为准。
 * 技能 raw-material-inventory → 本体 原材料采购和库存（ontology_id=1）
 *
 * 关键行为
 * · 查询原材料库存信息 QueryInventory @RawMaterialInventory
 * · 查询原材料采购单信息 QueryPurchaseRecords @PurchaseRecord
 *
 * 关键函数
 * · 原材料未到位数 sumRawNotArrivalQty @PurchaseRecord → QueryPurchaseRecords
 *
 * 图路径（上游 1 跳；→/← 为本体边方向，按从左到右即本轮路径）
 * QueryInventory @RawMaterialInventory ←〔拥有库存〕— RawMaterial → 查询原材料基本信息 QueryRawMaterials
 * ```
 *
 * 四条刻意的取舍：
 * 1. **三节固定序**：关键行为 / 关键函数 / 图路径。旧版把行为、函数、取数混在「直接命中」
 *    一行里，同一个 `〔〕` 既表示函数的关联概念、又表示取数行为的所属概念，同形不同义；
 * 2. **取数行为并入关键行为**：函数关联概念的 `query` 行为本身也是"这轮该看的行为"，
 *    单独成段会让它看起来像另一类东西；函数条目用 `@概念 → 行为名` 指向它，回答"用这个函数
 *    要先查哪张表"，两处只有一处事实来源（行为清单）；
 * 3. **图路径只由关键行为（判分命中）出发**：取数行为不判分、不参与发散，也就不能成为
 *    路径起点，否则同一行为会有两条互相矛盾的上游；
 * 4. **方向与读向分开**：`→/←` 只表示本体里边的书写方向，阅读顺序（左→右）恒为行走顺序，
 *    不再需要 `[上游]` 与双箭头两套记号。
 *
 * 剪枝仍是行级原子（不会留下半截条目），顺序：
 * 路径行（链尾无行为 → 跳数大 → 得分低，每个起点行为至少留一行）
 * → 取数行为行（同时摘掉函数条目里的 `→ 行为名` 引用，不留悬空引用）
 * → 函数行 → 关键行为行。取数最先丢是因为它只是"顺手能查什么"，
 * 判分命中的行为是用户意图本身，最后才动。
 *
 * 三条硬约束不变：只描述"能做什么 / 该看什么"（不带分数、阈值、工具名、执行指令）；
 * `name` 保留原文不翻译；片段内换行压成空格。
 */
import type { FocusPath } from './paths.js';
import type { CapabilitySelection } from './types.js';

/**
 * 提示长度上限（阶数 0 的基准值，字符）。
 *
 * 2026-11-20：1200 → 2000。原值按"每个入选行为一行、最多 32 个技能"估的，
 * 实测发散发到二阶时经常在命中段就被截断，路径行几乎全被丢掉——
 * 而截断是**整行丢弃**，一次截断就丢掉一整条路径，信息损失比多花 token 严重。
 */
export const MAX_PROMPT_CHARS = 2000;

/** 阶数 → 提示总长度上限：越深的发散允许越长的上下文（2000 / 3000 / 4000） */
export function maxPromptChars(depth: number): number {
  if (depth <= 0) return MAX_PROMPT_CHARS;
  return depth === 1 ? 3000 : 4000;
}

/**
 * 首行边界声明。
 *
 * 只声明"这是背景、工具仍以工具清单为准"，不替主模型下判断（旧版"本轮的任务与…
 * 密切相关"既长又像在指定任务）。
 */
export const PROMPT_PREFIX = '［聚焦参考］以下为背景知识，不是工具清单；工具调用仍以工具清单为准。';

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
  /** 图路径（只含**上游**；下游只进卡片，不进提示） */
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

/**
 * 关键行为条目。
 *
 * `kind` 只服务于剪枝优先级（取数行为先丢），不参与展示——提示里两类条目形态一致，
 * 避免模型把它们当成两种能力。
 */
interface BehaviorLine {
  text: string;
  kind: 'direct' | 'query';
  /** 所属本体与行为名：剪枝取数行时据此摘掉函数条目里的 `→ 行为名` 引用 */
  ontologyId: string;
  name: string;
}

/** 函数条目：基础文本 + 每个关联概念挂到的取数行为名 */
interface FunctionLine {
  ontologyId: string;
  text: string;
  concepts: { name: string; queries: string[] }[];
}

interface PromptItem {
  name: string;
  /** 已渲染的本体说明（`本体 X（ontology_id=1）`），非本体技能为 null */
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

/**
 * 铸造提示：仅对入选技能与入选能力拼装；无技能时返回空串（调用方据此不追加）。
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

  // 同一本体被多个入选技能引用时，能力与路径只归属于分数最高的那个技能
  const ownerByOntology = new Map<string, string>();
  for (const skill of selected) {
    if (!skill.isOntology || !skill.ontology) continue;
    if (!ownerByOntology.has(skill.ontology.id)) ownerByOntology.set(skill.ontology.id, skill.name);
  }

  const items: PromptItem[] = selected.map((skill) => ({
    name: clean(skill.name),
    // 本体技能恒有且仅有 1 个本体：提示里只出现一组字段
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

  // 1) 判分命中的行为
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

  // 2) 函数：先建条目，再让取数行为回挂到"关联概念"上
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

  // 3) 取数行为：并入关键行为（与直接命中去重），并在函数条目里留下 `@概念 → 行为名`
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
    // 取数只有一处事实来源（关键行为），函数条目只引用行为名
    for (const fn of item.functions) {
      if (fn.ontologyId !== query.ontologyId) continue;
      const concept = fn.concepts.find((entry) => entry.name === clean(query.concept));
      if (concept && !concept.queries.includes(query.name)) concept.queries.push(query.name);
    }
  }

  // 4) 图路径：起点恒为判分命中的行为（取数不判分、不参与发散）
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
  // 截断顺序：路径行（行级）→ 取数行为 → 函数 → 判分命中的行为
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

/**
 * 技能块之间用空行分隔，块内三段之间也用空行分隔。
 *
 * 不用缩进：提示会被拼进更长的素材里，缩进在模型侧不产生结构感，只白占字符；
 * 空行分段反而更清楚。
 */
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

/** 函数条目：`· 中文名 name @概念 → 取数行为名、@概念2` */
function renderFunctionLine(fn: FunctionLine): string {
  const refs = fn.concepts.map((concept) =>
    concept.queries.length === 0
      ? `@${concept.name}`
      : `@${concept.name} → ${concept.queries.join('、')}`,
  );
  return refs.length === 0 ? `· ${fn.text}` : `· ${fn.text} ${refs.join('、')}`;
}

/**
 * 一条图路径（一跳一行）：
 * `行为 @起点概念 ←〔关系〕— 终点概念 → 终点概念下的行为`
 *
 * 方向语义与 Cypher 一致：`—〔rel〕→` 表示顺着关系在本体里的书写方向走，
 * `←〔rel〕—` 表示逆着写。阅读顺序恒为左→右＝本轮行走顺序。
 */
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

/** 行为条目：`中文名 name @概念`（无概念时省略 `@`） */
function behaviorText(title: string, name: string, concept: string | null): string {
  const base = label(title, name);
  const ref = concept === null ? '' : clean(concept);
  return ref === '' ? base : `${base} @${ref}`;
}

/** 本体说明：显式给出 id，name 有则写在前面 */
function renderOntology(ontology: PromptOntology): string {
  const id = `ontology_id=${clean(ontology.id)}`;
  return ontology.name === null ? `本体（${id}）` : `本体 ${clean(ontology.name)}（${id}）`;
}

/**
 * 丢掉"最该丢"的一条路径行（**行级原子**，不会留下半截路径）。
 *
 * 排序：链尾无行为 → 跳数大 → 起点得分低 → 靠后。
 *
 * 唯一保护：**入选行为的第一跳行**至少留一条（否则模型会以为这个行为没有任何上下文，
 * 比不出现更糟）。保护只对 `hop === 1` 生效——第 2 跳起的起点行为是接续出来的，
 * 它的行被清空不影响"用户意图命中了什么"；若也保护它，会出现"每条链都只有一行、
 * 谁都删不掉"的死局，最后只能去砍行为。
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

/** 摘掉函数条目里对某个取数行为的引用（引用为空时概念仍保留） */
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

/** 丢一条函数行 */
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

/** 丢一条判分命中的行为行（最后才动） */
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

/** 字典序比较（数值已按"越小越先丢"编码好） */
function compareRank(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    const diff = left[index]! - right[index]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * 展示名：`中文名 name`；`title` 缺失或与 `name` 相同时只写 `name`（不留重复字）。
 */
function label(title: string, name: string): string {
  const cleanTitle = clean(title);
  const cleanName = clean(name);
  if (cleanTitle === '' || cleanTitle === cleanName) return cleanName;
  return `${cleanTitle} ${cleanName}`;
}

function keyOf(ontologyId: string, name: string): string {
  return `${ontologyId}\u0000${name}`;
}

/** 单行片段：换行、制表符、连续空白统一压成单个空格 */
function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
