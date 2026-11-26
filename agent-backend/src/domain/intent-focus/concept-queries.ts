import { normalizeOpType } from '../ontology-doc.js';
import type {
  ConceptQueryDecision,
  FunctionDecision,
  OntologyBehavior,
  OntologyDefinition,
} from './types.js';

const QUERY_OP_TYPE = 'query';

export function resolveConceptQueries(
  functions: readonly FunctionDecision[],
  ontologies: readonly OntologyDefinition[],
  directBehaviors: readonly { ontologyId: string; name: string }[] = [],
): ConceptQueryDecision[] {
  if (functions.length === 0) return [];

  const direct = new Set(directBehaviors.map((b) => behaviorKey(b.ontologyId, b.name)));
  const seen = new Set<string>();
  const result: ConceptQueryDecision[] = [];

  for (const fn of functions) {
    if (fn.relatedConcepts.length === 0) continue;
    const behaviors = queryBehaviorsOf(ontologies, fn.ontologyId);

    for (const concept of fn.relatedConcepts) {
      for (const behavior of behaviors) {
        if (behavior.concept !== concept) continue;
        const key = behaviorKey(fn.ontologyId, behavior.name);
        if (seen.has(key) || direct.has(key)) continue;
        seen.add(key);
        result.push({
          name: behavior.name,
          title: behavior.title,
          ontologyId: fn.ontologyId,
          ontologyName: fn.ontologyName,
          concept,
          index: behavior.index,
        });
      }
    }
  }

  return result;
}

function queryBehaviorsOf(
  ontologies: readonly OntologyDefinition[],
  ontologyId: string,
): (OntologyBehavior & { index: number })[] {
  const seen = new Set<string>();
  const result: (OntologyBehavior & { index: number })[] = [];
  for (const ontology of ontologies) {
    if (ontology.ontologyId !== ontologyId) continue;
    for (const [index, behavior] of ontology.behaviors.entries()) {
      if (!isQuery(behavior)) continue;
      if (seen.has(behavior.name)) continue;
      seen.add(behavior.name);
      result.push({ ...behavior, index });
    }
  }
  return result;
}

function isQuery(behavior: OntologyBehavior): boolean {
  return normalizeOpType(behavior.opType) === QUERY_OP_TYPE;
}

function behaviorKey(ontologyId: string, name: string): string {
  return `${ontologyId}\u0000${name}`;
}
