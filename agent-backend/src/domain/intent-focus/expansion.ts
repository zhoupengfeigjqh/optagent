import type {
  ExpandedBehavior,
  ExpandedConcept,
  ExpansionChannel,
  ExpansionEdge,
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

export type DirectionVia = 'relation_type' | 'cardinality' | 'arrow';

export interface RelationEnds {
  upstream: string;
  downstream: string;
  via: DirectionVia;
}

export function relationEnds(relation: OntologyRelation): RelationEnds {
  const types = relation.relationType.map((item) => item.trim().toLowerCase());
  const functional = types.includes('functional');
  const inverse = types.includes('inversefunctional');

  if (functional && !inverse) {
    return { upstream: relation.target, downstream: relation.source, via: 'relation_type' };
  }
  if (inverse) {
    return { upstream: relation.source, downstream: relation.target, via: 'relation_type' };
  }

  const parsed = parseCardinality(relation.cardinality);
  if (parsed === 'reversed') {
    return { upstream: relation.target, downstream: relation.source, via: 'cardinality' };
  }
  if (parsed === 'forward') {
    return { upstream: relation.source, downstream: relation.target, via: 'cardinality' };
  }
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
  if (many(left) && !many(right)) return 'reversed';
  return 'forward';
}

export interface ExpandInput {
  behaviors: readonly { ontologyId: string; name: string; concept: string | null }[];
  ontologies: readonly OntologyDefinition[];
  depth: number;
  maxBehaviors?: number;
}

interface NeighborEdge {
  to: string;
  relation: string;
}

const EMPTY_CHANNEL = (): ExpansionChannel => ({ concepts: [], behaviors: [], directEdges: [] });

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
      const walked = walk(ontology, direct, adjacency, depth);
      channel.concepts.push(...walked.concepts);
      channel.directEdges.push(...walked.directEdges);
      const truncated = collectBehaviors(
        ontology,
        walked.concepts,
        directNames,
        maxBehaviors,
        channel,
      );
      if (truncated) result.truncated = true;
    }
  }

  return result;
}

export function clampDepth(depth: number): number {
  if (!Number.isInteger(depth) || depth < 0) return 0;
  return depth > 2 ? 2 : depth;
}

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

function walk(
  ontology: OntologyDefinition,
  direct: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, NeighborEdge[]>,
  depth: number,
): { concepts: ExpandedConcept[]; directEdges: ExpansionEdge[] } {
  const visited = new Set(direct);
  const found: ExpandedConcept[] = [];
  const directEdges: ExpansionEdge[] = [];
  const seenDirectEdge = new Set<string>();
  let frontier: ReadonlySet<string> = direct;

  for (let hop = 1; hop <= depth; hop++) {
    const inbound = new Map<string, ExpansionEdge[]>();
    for (const concept of ontology.concepts) {
      if (!frontier.has(concept.name)) continue;
      for (const edge of adjacency.get(concept.name) ?? []) {
        if (visited.has(edge.to)) {
          if (hop === 1 && direct.has(edge.to)) {
            const key = `${concept.name}\u0000${edge.relation}\u0000${edge.to}`;
            if (!seenDirectEdge.has(key)) {
              seenDirectEdge.add(key);
              directEdges.push({
                ontologyId: ontology.ontologyId,
                from: concept.name,
                relation: edge.relation,
                to: edge.to,
                hop: 1,
              });
            }
          }
          continue;
        }
        const item: ExpansionEdge = {
          ontologyId: ontology.ontologyId,
          from: concept.name,
          relation: edge.relation,
          to: edge.to,
          hop,
        };
        const list = inbound.get(edge.to);
        if (list) list.push(item);
        else inbound.set(edge.to, [item]);
      }
    }
    if (inbound.size === 0) break;

    const next = new Set<string>();
    for (const concept of ontology.concepts) {
      const edges = inbound.get(concept.name);
      if (edges === undefined) continue;
      visited.add(concept.name);
      next.add(concept.name);
      const first = edges[0] as ExpansionEdge;
      found.push({
        ontologyId: ontology.ontologyId,
        ontologyName: ontology.ontologyName,
        name: concept.name,
        title: concept.title,
        hop,
        viaConcept: first.from,
        viaRelation: first.relation,
        edges,
      });
    }
    frontier = next;
  }

  return { concepts: found, directEdges };
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
        fromConcept: concept.viaConcept,
      } satisfies ExpandedBehavior);
    }
  }
  return false;
}

function keyOf(ontologyId: string, name: string): string {
  return `${ontologyId}\u0000${name}`;
}
