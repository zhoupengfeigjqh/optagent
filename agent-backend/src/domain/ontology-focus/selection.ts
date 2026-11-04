/**
 * 选择与去重（016）。
 *
 * 三个不变量：
 * 1. **严格大于阈值**才保留（`score > threshold`），等于阈值丢弃（FR-021）；
 * 2. 数据补充只对**直接入选**的行为生效，且**不级联**：补充项不再触发自身规则的补充
 *    （FR-033）——否则一条链式规则能把整个本体拖进来，就回到了"全量展开"；
 * 3. 类内唯一：行为与函数都以 `ontology_id + name` 为键去重（FR-034）——同名但属于
 *    不同本体时**各自保留**，跨本体不再合并。
 */
import type {
  CapabilityCandidate,
  CapabilityDecision,
  CapabilitySelection,
  DataSupplement,
  OntologyDefinition,
  SkillCandidate,
  SkillDecision,
} from './types.js';

/** 行为类结果硬上限（与候选上限同源，FR-027 / FR-035） */
export const MAX_BEHAVIORS = 96;

/** 技能选择：返回全部决策（含未入选），保持候选原序 */
export function selectSkills(
  candidates: readonly SkillCandidate[],
  scores: Readonly<Record<string, number | undefined>>,
  threshold: number,
): SkillDecision[] {
  return candidates.map((candidate) => {
    const score = scores[candidate.qid];
    const selected = typeof score === 'number' && score > threshold;
    return {
      header: candidate.header,
      isOntology: candidate.isOntologySkill,
      // 一个技能只对应一个本体；同 id 多文件时取首份
      ontologyId: candidate.matchedOntologies[0]?.ontologyId ?? null,
      score: typeof score === 'number' ? score : null,
      selected,
      reason: selected ? null : typeof score === 'number' ? 'below_threshold' : 'missing_score',
    };
  });
}

/**
 * 能力选择：直接入选 + 数据补充 + 去重 + 上限截断。
 *
 * @param ontologies 只包含入选技能引用的本体，且按**本体文件枚举序**排列（FR-025）
 */
export function selectCapabilities(
  candidates: readonly CapabilityCandidate[],
  scores: Readonly<Record<string, number | undefined>>,
  threshold: number,
  ontologies: readonly OntologyDefinition[],
): CapabilitySelection {
  const decisions: CapabilityDecision[] = candidates.map((candidate) => {
    const score = scores[candidate.qid];
    return {
      kind: candidate.kind,
      name: candidate.name,
      title: candidate.title,
      ontologyId: candidate.ontologyId,
      ontologyName: candidate.ontologyName,
      score: typeof score === 'number' ? score : null,
      selected: typeof score === 'number' && score > threshold,
      source: 'direct',
      index: candidate.index,
    };
  });

  const directBehaviors = decisions
    .filter((decision) => decision.kind === 'behavior' && decision.selected)
    .sort(byScoreThenIndex);
  const directFunctions = decisions
    .filter((decision) => decision.kind === 'function' && decision.selected)
    .sort(byScoreThenIndex);

  const { supplements, supplementDecisions } = collectSupplements(directBehaviors, ontologies);
  const behaviors = orderBehaviors(dedupe([...directBehaviors, ...supplementDecisions]), directBehaviors);
  const functions = dedupe(directFunctions);

  // 直接入选项优先保留，只截断补充项（FR-035：超限按本体原序截断补充项）
  const directKeys = new Set(directBehaviors.map(keyOf));
  const directMerged = behaviors.filter((item) => directKeys.has(keyOf(item)));
  const supplementMerged = behaviors.filter((item) => !directKeys.has(keyOf(item)));
  let limited = behaviors;
  let truncated = false;
  if (behaviors.length > MAX_BEHAVIORS) {
    truncated = true;
    limited = [
      ...directMerged.slice(0, MAX_BEHAVIORS),
      ...supplementMerged.slice(0, Math.max(0, MAX_BEHAVIORS - directMerged.length)),
    ];
  }

  return { behaviors: limited, functions, supplements, truncated };
}

interface SupplementCollection {
  supplements: DataSupplement[];
  supplementDecisions: CapabilityDecision[];
}

/**
 * 收集数据补充：只遍历直接入选行为，按本体枚举序 + 行为数组序产出。
 * `found=false` 的声明也留在明细里（FR-032：丢弃但记录原因）。
 */
function collectSupplements(
  directBehaviors: readonly CapabilityDecision[],
  ontologies: readonly OntologyDefinition[],
): SupplementCollection {
  const supplements: DataSupplement[] = [];
  const supplementDecisions: CapabilityDecision[] = [];
  const seenPairs = new Set<string>();
  let order = 0;

  for (const ontology of ontologies) {
    for (const behavior of directBehaviors) {
      if (behavior.ontologyId !== ontology.ontologyId) continue;
      const behaviorIndex = ontology.behaviors.findIndex((item) => item.name === behavior.name);
      if (behaviorIndex < 0) continue;

      for (const rule of ontology.rules) {
        if (rule.behavior !== behavior.name) continue;
        for (const name of rule.dataSupplements) {
          const pairKey = `${ontology.ontologyId}\u0000${behavior.name}\u0000${name}`;
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);

          const target = ontology.behaviors.find((item) => item.name === name);
          supplements.push({
            ontologyId: ontology.ontologyId,
            behavior: behavior.name,
            supplement: name,
            found: target !== undefined,
          });
          if (!target) continue;
          supplementDecisions.push({
            kind: 'behavior',
            name: target.name,
            title: target.title,
            ontologyId: ontology.ontologyId,
            ontologyName: ontology.ontologyName,
            score: null,
            selected: true,
            source: 'supplement',
            index: order++,
          });
        }
      }
    }
  }

  return { supplements, supplementDecisions };
}

/** 去重键：本体 ID + 名称（跨本体同名视为不同项） */
function keyOf(decision: CapabilityDecision): string {
  return `${decision.ontologyId}\u0000${decision.name}`;
}

/**
 * 类内去重：`ontology_id + name` 为键；同键保留最高分、`title` 取首次；
 * 直接入选与补充命中同一项时来源合并为 `direct+supplement`。
 */
function dedupe(items: readonly CapabilityDecision[]): CapabilityDecision[] {
  const byKey = new Map<string, CapabilityDecision>();
  const order: string[] = [];

  for (const item of items) {
    const key = keyOf(item);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...item });
      order.push(key);
      continue;
    }
    existing.source = mergeSource(existing.source, item.source);
    if (item.score !== null && (existing.score === null || item.score > existing.score)) {
      existing.score = item.score;
      existing.index = item.index;
    }
  }

  return order.map((key) => byKey.get(key)!);
}

/** 直接入选在前（分数降序），补充项在后（原序） */
function orderBehaviors(
  merged: readonly CapabilityDecision[],
  direct: readonly CapabilityDecision[],
): CapabilityDecision[] {
  const directKeys = new Set(direct.map(keyOf));
  return [...merged].sort((a, b) => {
    const aDirect = directKeys.has(keyOf(a));
    const bDirect = directKeys.has(keyOf(b));
    if (aDirect !== bDirect) return aDirect ? -1 : 1;
    if (aDirect && bDirect) return byScoreThenIndex(a, b);
    return a.index - b.index;
  });
}

function mergeSource(a: CapabilityDecision['source'], b: CapabilityDecision['source']): CapabilityDecision['source'] {
  if (a === b) return a;
  return 'direct+supplement';
}

function byScoreThenIndex(a: CapabilityDecision, b: CapabilityDecision): number {
  const scoreA = a.score ?? Number.NEGATIVE_INFINITY;
  const scoreB = b.score ?? Number.NEGATIVE_INFINITY;
  if (scoreA !== scoreB) return scoreB - scoreA;
  return a.index - b.index;
}
