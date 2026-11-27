import path from 'node:path';

import { loadOntologyIndex } from '../intent-focus/ontology-loader.js';
import type { OntologyDefinition, OntologyIndex } from '../intent-focus/types.js';
import { normalizeName, normalizeOpType, ontologySignature } from '../ontology-doc.js';
import type { OntologyFacts } from './normalize.js';

export function ontologyKeyOf(definition: OntologyDefinition): string {
  const ontologyDir = path.dirname(definition.filePath);
  return `${path.basename(path.dirname(ontologyDir))}/${path.basename(ontologyDir)}`;
}

export function buildOntologyFacts(index: OntologyIndex): OntologyFacts {
  const conceptsByFunction = new Map<string, string[]>();
  const keysByFunction = new Map<string, string[]>();
  const queriesByKey = new Map<string, Map<string, string[]>>();
  const queriesByConcept = new Map<string, string[]>();

  for (const definition of index.all) {
    const key = ontologyKeyOf(definition);

    for (const fn of definition.functions) {
      const name = normalizeName(fn.name);
      pushAll(conceptsByFunction, name, fn.relatedConcepts);
      pushAll(keysByFunction, name, [key]);
    }

    let perKey = queriesByKey.get(key);
    if (perKey === undefined) {
      perKey = new Map<string, string[]>();
      queriesByKey.set(key, perKey);
    }
    for (const behavior of definition.behaviors) {
      if (behavior.concept === null) continue;
      if (normalizeOpType(behavior.opType) !== 'query') continue;
      const concept = normalizeName(behavior.concept);
      pushAll(perKey, concept, [behavior.name]);
      pushAll(queriesByConcept, concept, [behavior.name]);
    }
  }

  return {
    relatedConceptsOf(functionName: string): readonly string[] {
      return conceptsByFunction.get(normalizeName(functionName)) ?? [];
    },
    ontologyKeysOfFunction(functionName: string): readonly string[] {
      return keysByFunction.get(normalizeName(functionName)) ?? [];
    },
    queryBehaviorsOf(conceptName: string, ontologyKey?: string): readonly string[] {
      const concept = normalizeName(conceptName);
      if (ontologyKey !== undefined) {
        const perKey = queriesByKey.get(ontologyKey);
        const scoped = perKey?.get(concept);
        if (scoped !== undefined && scoped.length > 0) return scoped;
      }
      // 本体维度只作**优先**匹配：键对不上时回退全量，避免"同名即同一工具"被误判为空。
      return queriesByConcept.get(concept) ?? [];
    },
  };
}

export interface OntologyFactsLoader {
  get(): OntologyFacts;
  /**
   * 取同一份缓存的本体索引（段 3/4 的渲染素材）。
   *
   * 与本模块 `get()` 共享缓存的原因：两层视图必须来自**同一次读盘**，
   * 否则同一轮里可能读到前后不一致的两份本体（编辑中保存）。
   */
  getIndex(): OntologyIndex;
}

export function createOntologyFactsLoader(agentDir: string): OntologyFactsLoader {
  let cached: { signature: string; index: OntologyIndex; facts: OntologyFacts } | null = null;

  const load = (): { index: OntologyIndex; facts: OntologyFacts } => {
    const signature = ontologySignature(agentDir);
    if (cached !== null && cached.signature === signature) return cached;
    const index = loadOntologyIndex(agentDir);
    cached = { signature, index, facts: buildOntologyFacts(index) };
    return cached;
  };

  return {
    get(): OntologyFacts {
      return load().facts;
    },
    getIndex(): OntologyIndex {
      return load().index;
    },
  };
}

function pushAll(target: Map<string, string[]>, key: string, values: readonly string[]): void {
  if (key === '') return;
  const bucket = target.get(key);
  if (bucket === undefined) {
    target.set(key, [...new Set(values)]);
    return;
  }
  for (const value of values) {
    if (!bucket.includes(value)) bucket.push(value);
  }
}
