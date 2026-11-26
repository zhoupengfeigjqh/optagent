import type {
  ExpansionChannel,
  ExpansionResult,
  OntologyBehavior,
  OntologyDefinition,
  OntologyRelation,
} from './types.js';

export interface FocusPathNode {
  name: string;
  title: string;
}

export interface FocusPath {
  ontologyId: string;
  behavior: FocusPathNode;
  fromConcept: FocusPathNode;
  relation: FocusPathNode;
  direction: 'upstream' | 'downstream';
  readability: 'forward' | 'reverse';
  toConcept: FocusPathNode;
  toBehavior: FocusPathNode | null;
  hop: number;
  score: number | null;
}

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
  direction?: 'upstream' | 'downstream';
}

interface OntologyFacts {
  conceptTitle(name: string): string;
  relations: Map<string, OntologyRelation>;
  behaviorsByConcept: Map<string, OntologyBehavior[]>;
}

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
    if (!start.concept) continue;
    const ontology = ontologiesById.get(start.ontologyId);
    if (!ontology) continue;

    const facts = collectFacts(ontology);
    const channel = pickChannel(input.expansion, direction);
    // （只数本本体的边：channel 是多本体累加的，同名概念不能互相借用）
    const maxHop = Math.max(
      channel.concepts.reduce((max, item) => Math.max(max, item.hop), 0),
      channel.directEdges.some((link) => link.ontologyId === start.ontologyId) ? 1 : 0,
    );

    let cursor: { name: string; title: string; concept: string; score: number | null } = {
      name: start.name,
      title: start.title,
      concept: start.concept,
      score: start.score,
    };

    for (let hop = 1; hop <= maxHop; hop += 1) {
      // 后到的起点行为整条路径消失。`hop === hop` 防止跨跳串线。
      const neighbors = channel.concepts.filter(
        (item) =>
          item.ontologyId === start.ontologyId &&
          item.hop === hop &&
          item.edges.some((edge) => edge.from === cursor.concept),
      );

      let next: { name: string; title: string; concept: string } | null = null;
      for (const neighbor of neighbors) {
        const ends = facts.behaviorsByConcept.get(neighbor.name) ?? [];
        const reached = neighbor.edges.filter((edge) => edge.from === cursor.concept);
        for (const edge of reached) {
          const relation = facts.relations.get(edge.relation);
          const base: Omit<FocusPath, 'toBehavior'> = {
            ontologyId: start.ontologyId,
            behavior: { name: cursor.name, title: cursor.title },
            fromConcept: { name: cursor.concept, title: facts.conceptTitle(cursor.concept) },
            relation: {
              name: edge.relation,
              title: relationTitle(relation, edge.relation),
            },
            direction,
            readability: relationReadability(relation, cursor.concept),
            toConcept: { name: neighbor.name, title: neighbor.title },
            hop,
            score: cursor.score,
          };

          if (ends.length === 0) {
            push({ ...base, toBehavior: null });
            continue;
          }
          for (const end of ends) {
            push({ ...base, toBehavior: { name: end.name, title: end.title } });
          }
        }
        // 口径：行为接续只沿**该概念的第一个行为**向外走，避免 (行为数)^(跳数) 组合爆炸
        if (ends.length > 0) {
          next ??= { name: ends[0]!.name, title: ends[0]!.title, concept: neighbor.name };
        }
      }

      // 不进 `concepts`，但"谁和谁相连"必须出现在路径里，否则提示里两个命中行为毫无关系。
      if (hop === 1) {
        for (const link of channel.directEdges) {
          if (link.ontologyId !== start.ontologyId || link.from !== cursor.concept) continue;
          const relation = facts.relations.get(link.relation);
          const ends = facts.behaviorsByConcept.get(link.to) ?? [];
          const base: Omit<FocusPath, 'toBehavior'> = {
            ontologyId: start.ontologyId,
            behavior: { name: cursor.name, title: cursor.title },
            fromConcept: { name: cursor.concept, title: facts.conceptTitle(cursor.concept) },
            relation: { name: link.relation, title: relationTitle(relation, link.relation) },
            direction,
            readability: relationReadability(relation, cursor.concept),
            toConcept: { name: link.to, title: facts.conceptTitle(link.to) },
            hop,
            score: cursor.score,
          };
          if (ends.length === 0) {
            push({ ...base, toBehavior: null });
            continue;
          }
          for (const end of ends) {
            push({ ...base, toBehavior: { name: end.name, title: end.title } });
          }
        }
      }

      if (next === null) break;
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

function relationTitle(relation: OntologyRelation | undefined, fallback: string): string {
  const title = (relation?.title ?? '').trim();
  return title === '' ? fallback : title;
}

function relationReadability(
  relation: OntologyRelation | undefined,
  fromConcept: string,
): 'forward' | 'reverse' {
  if (!relation) return 'forward';
  return relation.source === fromConcept ? 'forward' : 'reverse';
}

export function focusPathKey(path: FocusPath): string {
  return [
    path.ontologyId,
    path.behavior.name,
    path.relation.name,
    path.toConcept.name,
    path.toBehavior?.name ?? '',
  ].join('\u0000');
}
