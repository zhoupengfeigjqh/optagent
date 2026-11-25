/**
 * 关联概念取数（2026-11-20，FR-066 / FR-067）。
 *
 * 入选函数带来一个问题：模型知道"有个函数能算未到位数"，但不知道"要先查哪张表"。
 * 这里按函数的 `related_concepts[]` 取同本体内 `op_type: query` 的行为，作为**取数项**
 * 并入提示的「关键行为」段（2026-11-24），并由函数条目用 `@概念 → 行为名` 指回来。
 *
 * 四条硬约束（都是踩过的坑，别放宽）：
 * 1. **只取 query**：`command` 会改数据，把它当成"取数"会在提示里推荐写操作；
 * 2. **只走一跳**：概念 → query 行为，到此为止。取数行为不再引出新的取数，也不参与 019 发散；
 * 3. **不判分**：没有分数，也就不会被阈值刷掉——它是否出现只取决于函数是否入选；
 * 4. **不重复**：已被行为直接命中（过阈值）的 query 行为不再作为取数项出现，
 *    以直接命中为准（保留分数，语义也更准确）。
 */
import { normalizeOpType } from '../ontology-doc.js';
import type {
  ConceptQueryDecision,
  FunctionDecision,
  OntologyBehavior,
  OntologyDefinition,
} from './types.js';

/** 取数只认这个 `op_type`（归一与比较同源于 `ontology-doc.normalizeOpType`） */
const QUERY_OP_TYPE = 'query';

/**
 * 由入选函数解析取数行为。
 *
 * @param functions 已入选函数（保持分数降序，决定取数项的先后）
 * @param ontologies 本轮涉及的**全部**本体定义（同 `ontology_id` 的多份文件都传进来，内部按名去重）
 * @param directBehaviors 已直接命中的行为；命中的 query 行为不再重复作为取数项
 */
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
    // 同一 ontology_id 可能物化成多份文件：按枚举序合并行为，同名以先出现者为准
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

/** 某本体的全部 query 行为（跨文件按 `name` 去重，保留首次出现） */
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
