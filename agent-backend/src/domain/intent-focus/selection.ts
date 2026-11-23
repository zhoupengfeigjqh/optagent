/**
 * 选择与去重（016）。
 *
 * 三个不变量：
 * 1. **严格大于阈值**才保留（`score > threshold`），等于阈值丢弃（FR-021）；
 * 2. 类内唯一：行为以 `ontology_id + name` 为键去重（FR-034）——同名但属于不同本体时
 *    **各自保留**，跨本体不合并；
 * 3. 顺序稳定：分数降序，同分按本体原序。
 *
 * 2026-11-06：能力聚焦只保留本体行为；本体函数与规则数据补充整体移除，本模块不再
 * 读取 `rules`、不再产生补充项。
 * 2026-11-20：函数窄口径恢复——行为与函数各自阈值、各自结果集，互不影响；
 * 三集（行为 / 函数 / 取数）必须彼此独立，`toolTips` 只认 `behaviors`。
 */
import type {
  CapabilityCandidate,
  CapabilityDecision,
  CapabilitySelection,
  FunctionDecision,
  SkillCandidate,
  SkillDecision,
} from './types.js';

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

/** 行为与函数各自的入选阈值（2026-11-20：两类分开标定） */
export interface CapabilityThresholds {
  behavior: number;
  function: number;
}

/**
 * 能力选择：按 `kind` 分派阈值 + 类内去重。
 *
 * 只返回**入选**项（2026-11-06 口径：记录与提示都只写入选结果，不再保留候选明细）。
 * **不做二次截断**：候选上限已在 `buildCapabilityCandidates` 由 `max_capabilities`
 * 唯一施加（FR-053），这里再砍一刀会让配置上限的上半段失效。
 *
 * `conceptQueries` 在此恒为空数组：取数要读本体行为表，由调用方用
 * `resolveConceptQueries` 补齐——选择层不该同时承担"选"和"展开"两件事。
 */
export function selectCapabilities(
  candidates: readonly CapabilityCandidate[],
  scores: Readonly<Record<string, number | undefined>>,
  thresholds: CapabilityThresholds,
): CapabilitySelection {
  const behaviors: CapabilityDecision[] = [];
  const functions: FunctionDecision[] = [];

  for (const candidate of candidates) {
    const score = scores[candidate.qid];
    const threshold = candidate.kind === 'function' ? thresholds.function : thresholds.behavior;
    if (typeof score !== 'number' || score <= threshold) continue;
    if (candidate.kind === 'function') {
      functions.push({
        name: candidate.name,
        title: candidate.title,
        ontologyId: candidate.ontologyId,
        ontologyName: candidate.ontologyName,
        score,
        relatedConcepts: candidate.relatedConcepts,
        index: candidate.index,
      });
    } else {
      behaviors.push({
        name: candidate.name,
        title: candidate.title,
        ontologyId: candidate.ontologyId,
        ontologyName: candidate.ontologyName,
        concept: candidate.concept,
        score,
        index: candidate.index,
      });
    }
  }

  return {
    behaviors: dedupe(behaviors.sort(byScoreThenIndex)),
    functions: dedupe(functions.sort(byScoreThenIndex)),
    conceptQueries: [],
  };
}

/** 去重键：本体 ID + 名称（跨本体同名视为不同项） */
function keyOf(item: { ontologyId: string; name: string }): string {
  return `${item.ontologyId}\u0000${item.name}`;
}

/**
 * 类内去重：`ontology_id + name` 为键。
 *
 * 入参已按分数降序，因此同键首次出现即最高分项——保留首次即可，后续同键直接丢弃。
 */
function dedupe<T extends { ontologyId: string; name: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function byScoreThenIndex<T extends { score: number; index: number }>(a: T, b: T): number {
  if (a.score !== b.score) return b.score - a.score;
  return a.index - b.index;
}
