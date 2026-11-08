/**
 * 一阶发散（019）：行为 → 概念 → 对象关系 → 相邻概念 → 相邻概念的行为。
 *
 * **两个方向互斥、各走一侧**（用户 2026-11-08 拍板）：
 * - 上游（主数据 / 父项）→ 只进**聚焦提示**（模型该参考什么）；
 * - 下游（明细 / 事实）→ 只进**下一步动作卡片**（模型能建议用户做什么）。
 *
 * **方向判定的唯一实现**（`relationEnds`）：本体文件不声明上下游，只能从基数推导。
 * 口径：箭头 `source → target` 读作「上游 → 下游」；唯一的例外是**多对一**
 * （`Functional` 单独出现时 source 是多端），此时要反向取。`M:N` 按约定取箭头方向
 * （两端都无基数约束，约定 source 为上游）。信号缺失时依次退回 `cardinality` → 箭头，
 * 并在留档里可由 `via` 分辨是哪一类判定。
 *
 * **不做二次判分**：发散结果直接使用（`score` 恒为 null），因此本模块是纯函数、
 * 零 IO、零模型调用——只做图遍历与去重，不引入任何额外等待。
 *
 * 三条顺序约束：
 * 1. BFS 逐跳推进，同跳按**本体 `concepts[]` 原序**输出（同输入必得同输出）；
 * 2. 邻居顺序沿用 `relations[]` 原序，首个命中路径即 `via_relation`；
 * 3. 行为按"概念顺序 → 行为原序"收集，`ontology_id + name` 去重；direct 行为优先，
 *    同一行为若既被直接命中又被发散命中，只保留 direct（不再重复出现）。
 */
import type {
  ExpandedBehavior,
  ExpandedConcept,
  ExpansionChannel,
  ExpansionResult,
  OntologyDefinition,
  OntologyRelation,
} from './types.js';

/**
 * 单通道发散行为上限。
 *
 * 概念按用户口径**不设上限、不截断**，但行为必须有界：一个稠密本体的二跳发散可以把
 * 绝大多数行为拉进来，无界会让提示词与卡片目录双双失控。超限按 `(概念序 → 行为原序)`
 * 截断，并在留档里标记 `truncated`。
 */
export const MAX_EXPANDED_BEHAVIORS = 32;

/** 方向判定的信号来源（留档/排障用：能分辨"推导"与"约定"） */
export type DirectionVia = 'relation_type' | 'cardinality' | 'arrow';

export interface RelationEnds {
  upstream: string;
  downstream: string;
  via: DirectionVia;
}

/**
 * 关系两端的方向判定（本特性的唯一实现）。
 *
 * | `relation_type` | 基数 | 上游端 |
 * |---|---|---|
 * | 仅 `Functional` | N:1 | **target**（唯一反向的一类） |
 * | 仅 `InverseFunctional` | 1:N | source |
 * | 两者都有 | 1:1 | source |
 * | 都没有 | M:N | source（约定） |
 */
export function relationEnds(relation: OntologyRelation): RelationEnds {
  const types = relation.relationType.map((item) => item.trim().toLowerCase());
  const functional = types.includes('functional');
  const inverse = types.includes('inversefunctional');

  // Functional 单独出现 = 每端只有一个 target ⇒ source 是多端 ⇒ 上游在 target
  if (functional && !inverse) {
    return { upstream: relation.target, downstream: relation.source, via: 'relation_type' };
  }
  if (inverse) {
    // InverseFunctional（单独或与 Functional 同时出现）→ 箭头方向即上下游
    return { upstream: relation.source, downstream: relation.target, via: 'relation_type' };
  }

  const parsed = parseCardinality(relation.cardinality);
  if (parsed === 'reversed') {
    return { upstream: relation.target, downstream: relation.source, via: 'cardinality' };
  }
  if (parsed === 'forward') {
    return { upstream: relation.source, downstream: relation.target, via: 'cardinality' };
  }
  // M:N / 缺基数 → 约定按箭头（019：source 为上游）
  return { upstream: relation.source, downstream: relation.target, via: 'arrow' };
}

/** `cardinality` 兜底：`N:1` → 反向；`1:N` / `1:1` / `N:M` → 箭头；解析不了返回 null */
function parseCardinality(value: string | null): 'forward' | 'reversed' | null {
  if (!value) return null;
  const parts = value.split(':');
  if (parts.length !== 2) return null;
  const left = (parts[0] ?? '').trim().toUpperCase();
  const right = (parts[1] ?? '').trim().toUpperCase();
  if (left === '' || right === '') return null;
  const many = (side: string): boolean => side === 'N' || side === 'M' || side === '*';
  // 多对一：source 是多端 ⇒ 上游在 target
  if (many(left) && !many(right)) return 'reversed';
  return 'forward';
}

/** 发散入参：本轮入选行为 + 已入选技能关联的本体（本体文件枚举序） */
export interface ExpandInput {
  behaviors: readonly { ontologyId: string; name: string; concept: string | null }[];
  ontologies: readonly OntologyDefinition[];
  /** 聚焦阶数（0~2）；0 = 不解析、不扩展 */
  depth: number;
  maxBehaviors?: number;
}

/** 一条邻居边：`to` 是"该方向上的下一跳" */
interface NeighborEdge {
  to: string;
  relation: string;
}

const EMPTY_CHANNEL = (): ExpansionChannel => ({ concepts: [], behaviors: [] });

/**
 * 同向一阶（及 N 阶）发散。
 *
 * 只对**已入选行为所属的概念**发难：某概念若没有任何行为入选，它不会成为起点，
 * 因此本函数不会把"全本体"无意间拉进来。
 */
export function expandNeighborhood(input: ExpandInput): ExpansionResult {
  const result: ExpansionResult = {
    upstream: EMPTY_CHANNEL(),
    downstream: EMPTY_CHANNEL(),
    warnings: [],
    truncated: false,
  };
  const depth = clampDepth(input.depth);
  if (depth === 0) return result;

  const maxBehaviors = input.maxBehaviors ?? MAX_EXPANDED_BEHAVIORS;
  const directByOntology = groupDirectConcepts(input.behaviors);
  const directNames = new Set(
    input.behaviors.map((behavior) => keyOf(behavior.ontologyId, behavior.name)),
  );

  for (const ontology of input.ontologies) {
    const related = input.behaviors.some((behavior) => behavior.ontologyId === ontology.ontologyId);
    if (!related) continue;

    const titleOf = new Map(ontology.concepts.map((concept) => [concept.name, concept.title] as const));
    // 断链诊断先于短路：没有可用起点的本体也要把"为什么没发散"记下来
    warnUndefinedConcepts(ontology, input.behaviors, titleOf, result.warnings);

    const direct = directByOntology.get(ontology.ontologyId);
    if (!direct || direct.size === 0) continue;

    for (const side of ['upstream', 'downstream'] as const) {
      const channel = result[side];
      const adjacency = buildAdjacency(ontology, side);
      const concepts = walk(ontology, direct, adjacency, depth);
      channel.concepts.push(...concepts);
      const truncated = collectBehaviors(
        ontology,
        concepts,
        directNames,
        maxBehaviors,
        channel,
      );
      if (truncated) result.truncated = true;
    }
  }

  return result;
}

/** 阶数收敛：0~2（越界按 0 处理，运行侧不做静默放大） */
export function clampDepth(depth: number): number {
  if (!Number.isInteger(depth) || depth < 0) return 0;
  return depth > 2 ? 2 : depth;
}

/** 每个本体下 direct 概念集合（按行为顺序去重，保证稳定） */
function groupDirectConcepts(
  behaviors: ExpandInput['behaviors'],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const behavior of behaviors) {
    if (!behavior.concept) continue;
    const bucket = map.get(behavior.ontologyId);
    if (bucket) bucket.add(behavior.concept);
    else map.set(behavior.ontologyId, new Set([behavior.concept]));
  }
  return map;
}

/** 概念不在 `concepts[]` 里 → 链断了，记 warning（判定照常，只是不扩展） */
function warnUndefinedConcepts(
  ontology: OntologyDefinition,
  behaviors: ExpandInput['behaviors'],
  titleOf: ReadonlyMap<string, string>,
  warnings: string[],
): void {
  for (const behavior of behaviors) {
    if (behavior.ontologyId !== ontology.ontologyId) continue;
    if (!behavior.concept) {
      warnings.push(`${ontology.ontologyId}:behavior_without_concept:${behavior.name}`);
      continue;
    }
    if (!titleOf.has(behavior.concept)) {
      warnings.push(`${ontology.ontologyId}:concept_undefined:${behavior.concept}`);
    }
  }
}

/**
 * 建邻接表：`key` 是当前概念，`edge.to` 是该方向上的一跳。
 *
 * 上游表 = 对每条关系，从 `downstream` 端出发能找到 `upstream` 端；
 * 下游表相反。端点不在 `concepts[]` 的关系整条跳过（记 warning 由调用方统一给）。
 */
function buildAdjacency(
  ontology: OntologyDefinition,
  side: 'upstream' | 'downstream',
): Map<string, NeighborEdge[]> {
  const known = new Set(ontology.concepts.map((concept) => concept.name));
  const map = new Map<string, NeighborEdge[]>();
  for (const relation of ontology.relations) {
    const ends = relationEnds(relation);
    if (!known.has(ends.upstream) || !known.has(ends.downstream)) continue;
    const from = side === 'upstream' ? ends.downstream : ends.upstream;
    const to = side === 'upstream' ? ends.upstream : ends.downstream;
    const list = map.get(from);
    const edge: NeighborEdge = { to, relation: relation.name };
    if (list) list.push(edge);
    else map.set(from, [edge]);
  }
  return map;
}

/**
 * 逐跳 BFS：同跳按 `concepts[]` 原序输出，首个命中路径即 `via`。
 *
 * 去环靠 `visited`：图里存在自环或双向边时不会死循环，也不会重复出概念。
 */
function walk(
  ontology: OntologyDefinition,
  direct: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, NeighborEdge[]>,
  depth: number,
): ExpandedConcept[] {
  const visited = new Set(direct);
  const found: ExpandedConcept[] = [];
  let frontier: ReadonlySet<string> = direct;

  for (let hop = 1; hop <= depth; hop++) {
    // 先按"前沿概念序 → 关系序"收集本跳命中（首个命中即 via），
    // 再按 `concepts[]` 原序输出——保证同输入必得同输出，且与本体声明顺序一致
    const hits = new Map<string, NeighborEdge & { via: string }>();
    for (const concept of ontology.concepts) {
      if (!frontier.has(concept.name)) continue;
      for (const edge of adjacency.get(concept.name) ?? []) {
        if (visited.has(edge.to) || hits.has(edge.to)) continue;
        hits.set(edge.to, { ...edge, via: concept.name });
      }
    }
    if (hits.size === 0) break;

    const next = new Set<string>();
    for (const concept of ontology.concepts) {
      const hit = hits.get(concept.name);
      if (!hit) continue;
      visited.add(concept.name);
      next.add(concept.name);
      found.push({
        ontologyId: ontology.ontologyId,
        ontologyName: ontology.ontologyName,
        name: concept.name,
        title: concept.title,
        hop,
        viaConcept: hit.via,
        viaRelation: hit.relation,
      });
    }
    frontier = next;
  }

  return found;
}

/**
 * 收集发散行为：只取**发散概念**下的行为，`direct` 命中的一律跳过。
 *
 * 不补"同一 direct 概念下被阈值否决的其它行为"——那是阈值的职责（016 已定：
 * 查询行为必须自身过阈值才入选，规则不再兜底）。
 */
function collectBehaviors(
  ontology: OntologyDefinition,
  concepts: readonly ExpandedConcept[],
  directNames: ReadonlySet<string>,
  maxBehaviors: number,
  channel: ExpansionChannel,
): boolean {
  const seen = new Set<string>();

  for (const concept of concepts) {
    for (const behavior of ontology.behaviors) {
      if (behavior.concept !== concept.name) continue;
      const key = keyOf(ontology.ontologyId, behavior.name);
      if (directNames.has(key) || seen.has(key)) continue;
      if (channel.behaviors.length >= maxBehaviors) return true;
      seen.add(key);
      channel.behaviors.push({
        ontologyId: ontology.ontologyId,
        ontologyName: ontology.ontologyName,
        name: behavior.name,
        title: behavior.title,
        concept: behavior.concept,
        hop: concept.hop,
        viaConcept: concept.name,
      } satisfies ExpandedBehavior);
    }
  }
  return false;
}

function keyOf(ontologyId: string, name: string): string {
  return `${ontologyId}\u0000${name}`;
}
