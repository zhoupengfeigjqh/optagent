/**
 * 五元组路径（019 修订，2026-11-13）：**行为 — 概念 — 关系 — 概念 — 行为**。
 *
 * 为什么不再用"分段列表"：把「关联概念 / 上游概念 / 直接命中 / 上游参考」四行并列，模型看得到
 * 元素却看不到**它们之间的连接**——同一个上游概念下为什么会有这个行为、走的是哪条关系，全靠猜。
 * 五元组把一条推理的最小单元压成一行，模型可以顺着读：起点行为挂在哪个概念上、经哪条关系
 * 到了哪个概念、那个概念下能调哪些行为。
 *
 * 三条口径（用户 2026-11-13 拍板）：
 * 1. **严格五元组**：起点行为每行重复，不省略（否则读者要把多行拼起来才成立）；
 * 2. **逐跳提取**：多跳是"每一跳各出一行五元组"，不是一次吐七元组；
 * 3. **行为接续**：第 N 跳的起点行为 = 第 N-1 跳的终点行为。因此中间概念若**没有行为**，
 *    该分支就到此为止（那一跳仍输出一行，终点行为写空，由展示层标"无可用行为"）。
 *
 * 方向与读向是两件事，必须分开表达（这也是"语义清晰"的关键）：
 * - `direction`：这一跳是走向**上游**（主数据/父项）还是**下游**（明细/事实）；
 * - `readability`：关系名按 `source→target` 正读（`forward`），还是得反读（`reverse`）。
 *   `RecordsRawMaterial` 的 `source=PurchaseRecord, target=RawMaterial`，正读是"采购单 记录
 *   原材料"，而它的**上游是 RawMaterial**（N:1 反向）——只用一个箭头会把两者混成一团。
 *
 * 本模块是**纯函数**：零 IO、零模型调用，`expansion` 的产出直接消费，不重复遍历本体。
 */
import type {
  ExpansionChannel,
  ExpansionResult,
  OntologyBehavior,
  OntologyDefinition,
  OntologyRelation,
} from './types.js';

/** 路径上的一个节点：`name` 是本体里的标识，`title` 是给人/模型看的中文名 */
export interface FocusPathNode {
  name: string;
  title: string;
}

/** 一条五元组（连同一跳的元信息，供渲染与截断排序使用） */
export interface FocusPath {
  ontologyId: string;
  /** 起点行为（第 N 跳时等于第 N-1 跳的终点行为） */
  behavior: FocusPathNode;
  /** 起点行为所属概念（= 这一跳的起点概念，`viaConcept`） */
  fromConcept: FocusPathNode;
  /** 这一跳经过的关系 */
  relation: FocusPathNode;
  /** 走向：上游（主数据）或下游（明细） */
  direction: 'upstream' | 'downstream';
  /** 关系名读向：`forward` = 顺 `source→target` 读，`reverse` = 反读 */
  readability: 'forward' | 'reverse';
  /** 这一跳到达的概念 */
  toConcept: FocusPathNode;
  /** 到达概念下的行为；`null` = 该概念没有行为（断链，不再向下展开） */
  toBehavior: FocusPathNode | null;
  /** 距离直接概念的跳数（1..depth） */
  hop: number;
  /** 起点行为的聚焦得分；接续出来的起点行为没有得分（恒 null） */
  score: number | null;
}

/** 构建入参：入选行为 + 已入选技能关联的本体 + 一次发散的产出 */
export interface BuildPathsInput {
  behaviors: readonly {
    ontologyId: string;
    name: string;
    title: string;
    concept: string | null;
    score: number | null;
  }[];
  ontologies: readonly OntologyDefinition[];
  expansion: ExpansionResult;
  /** 取哪个方向的发散产出；提示只消费上游，卡片才用下游 */
  direction?: 'upstream' | 'downstream';
}

/** 概念 → 该概念下的行为（本体原序，用于"到了哪个概念、能调哪些行为"） */
interface OntologyFacts {
  conceptTitle(name: string): string;
  relations: Map<string, OntologyRelation>;
  behaviorsByConcept: Map<string, OntologyBehavior[]>;
}

/**
 * 构建五元组路径。
 *
 * 顺序确定性（同输入必得同输出）：入选行为原序 → 跳数升序 → 发散概念原序 → 概念下行为原序。
 * 去重键不含跳数：同一 (起点行为, 关系, 终点概念, 终点行为) 只出现一次。
 */
export function buildFocusPaths(input: BuildPathsInput): FocusPath[] {
  const direction = input.direction ?? 'upstream';
  const ontologiesById = new Map(input.ontologies.map((item) => [item.ontologyId, item] as const));
  const out: FocusPath[] = [];
  const seen = new Set<string>();

  const push = (path: FocusPath): void => {
    const key = focusPathKey(path);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(path);
  };

  for (const start of input.behaviors) {
    // 没有概念 = 断链：这条行为照常出现在「直接命中」，但不参与发散（与 expansion 同一口径）
    if (!start.concept) continue;
    const ontology = ontologiesById.get(start.ontologyId);
    if (!ontology) continue;

    const facts = collectFacts(ontology);
    const channel = pickChannel(input.expansion, direction);
    const maxHop = channel.concepts.reduce((max, item) => Math.max(max, item.hop), 0);

    let cursor: { name: string; title: string; concept: string; score: number | null } = {
      name: start.name,
      title: start.title,
      concept: start.concept,
      score: start.score,
    };

    // 逐跳推进：每一跳只产出**一跳**的五元组，绝不在行内拼多跳
    for (let hop = 1; hop <= maxHop; hop += 1) {
      const neighbors = channel.concepts.filter(
        (item) => item.ontologyId === start.ontologyId && item.viaConcept === cursor.concept,
      );
      if (neighbors.length === 0) break;

      let next: { name: string; title: string; concept: string } | null = null;
      for (const neighbor of neighbors) {
        const relation = facts.relations.get(neighbor.viaRelation);
        const ends = facts.behaviorsByConcept.get(neighbor.name) ?? [];
        const base: Omit<FocusPath, 'toBehavior'> = {
          ontologyId: start.ontologyId,
          behavior: { name: cursor.name, title: cursor.title },
          fromConcept: { name: cursor.concept, title: facts.conceptTitle(cursor.concept) },
          relation: {
            name: neighbor.viaRelation,
            title: relationTitle(relation, neighbor.viaRelation),
          },
          direction,
          readability: relationReadability(relation, cursor.concept),
          toConcept: { name: neighbor.name, title: neighbor.title },
          hop,
          score: cursor.score,
        };

        if (ends.length === 0) {
          // 断链但保留：告诉模型"这条上游到此为止，下面没有可用行为"，比整行消失更清楚
          push({ ...base, toBehavior: null });
          continue;
        }
        for (const end of ends) {
          push({ ...base, toBehavior: { name: end.name, title: end.title } });
        }
        // 口径：行为接续只沿**该概念的第一个行为**向外走，避免 (行为数)^(跳数) 组合爆炸
        next ??= { name: ends[0]!.name, title: ends[0]!.title, concept: neighbor.name };
      }

      if (!next) break;
      cursor = { ...next, score: null };
    }
  }

  return out;
}

function pickChannel(expansion: ExpansionResult, direction: 'upstream' | 'downstream'): ExpansionChannel {
  return direction === 'upstream' ? expansion.upstream : expansion.downstream;
}

function collectFacts(ontology: OntologyDefinition): OntologyFacts {
  const titles = new Map(ontology.concepts.map((concept) => [concept.name, concept.title] as const));
  const relations = new Map(ontology.relations.map((relation) => [relation.name, relation] as const));
  const behaviorsByConcept = new Map<string, OntologyBehavior[]>();
  for (const behavior of ontology.behaviors) {
    // 行为不挂概念 = 不参与发散；这里跳过即可，与 `concept: null` 的判定保持一致
    if (!behavior.concept) continue;
    const bucket = behaviorsByConcept.get(behavior.concept);
    if (bucket) bucket.push(behavior);
    else behaviorsByConcept.set(behavior.concept, [behavior]);
  }
  return {
    // 概念 title 缺失 → 用 name 兜底（展示层不留空槽）
    conceptTitle: (name) => titles.get(name) ?? name,
    relations,
    behaviorsByConcept,
  };
}

/** 关系展示名：没写 `title` 的老本体回退到关系名 */
function relationTitle(relation: OntologyRelation | undefined, fallback: string): string {
  const title = (relation?.title ?? '').trim();
  return title === '' ? fallback : title;
}

/**
 * 关系名的读向：起点概念是 `source` 就正读，否则（起点是 `target`）反读。
 *
 * 关系在 `ontology.yaml` 里恒按 `source → target` 书写；发散可能逆着箭头走
 * （如 N:1 的 `RecordsRawMaterial` 从 `PurchaseRecord` 走到上游 `RawMaterial`），
 * 此时关系名必须反读，否则"采购单 记录 原材料"会被读成"原材料 记录 采购单"。
 */
function relationReadability(
  relation: OntologyRelation | undefined,
  fromConcept: string,
): 'forward' | 'reverse' {
  // 关系缺失（文件被截断/改名）时无法判断读向，保守按正读处理
  if (!relation) return 'forward';
  return relation.source === fromConcept ? 'forward' : 'reverse';
}

/**
 * 一条路径的唯一键（与去重口径一致，不含跳数）。
 *
 * 去重只认"起点行为 + 关系 + 终点概念 + 终点行为"：同一跳若经由不同路径到达，
 * 五元组看起来完全一样，重复输出只会白占预算。
 */
export function focusPathKey(path: FocusPath): string {
  return [
    path.ontologyId,
    path.behavior.name,
    path.relation.name,
    path.toConcept.name,
    path.toBehavior?.name ?? '',
  ].join('\u0000');
}
