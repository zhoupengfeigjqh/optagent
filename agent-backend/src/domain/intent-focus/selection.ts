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
 */
import type {
  CapabilityCandidate,
  CapabilityDecision,
  CapabilitySelection,
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

/**
 * 行为选择：阈值筛选 + 去重。
 *
 * 只返回**入选**行为（2026-11-06 口径：记录与提示都只写入选结果，不再保留候选明细）。
 * **不做二次截断**：候选上限已在 `buildCapabilityCandidates` 由 `max_capabilities`
 * 唯一施加（FR-053），这里再砍一刀会让配置上限的上半段失效。
 */
export function selectCapabilities(
  candidates: readonly CapabilityCandidate[],
  scores: Readonly<Record<string, number | undefined>>,
  threshold: number,
): CapabilitySelection {
  const selected: CapabilityDecision[] = [];
  for (const candidate of candidates) {
    const score = scores[candidate.qid];
    if (typeof score !== 'number' || score <= threshold) continue;
    selected.push({
      name: candidate.name,
      title: candidate.title,
      ontologyId: candidate.ontologyId,
      ontologyName: candidate.ontologyName,
      concept: candidate.concept,
      score,
      index: candidate.index,
    });
  }

  return { behaviors: dedupe(selected.sort(byScoreThenIndex)) };
}

/** 去重键：本体 ID + 名称（跨本体同名视为不同项） */
function keyOf(decision: CapabilityDecision): string {
  return `${decision.ontologyId}\u0000${decision.name}`;
}

/**
 * 类内去重：`ontology_id + name` 为键。
 *
 * 入参已按分数降序，因此同键首次出现即最高分项——保留首次即可，后续同键直接丢弃。
 */
function dedupe(items: readonly CapabilityDecision[]): CapabilityDecision[] {
  const seen = new Set<string>();
  const result: CapabilityDecision[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function byScoreThenIndex(a: CapabilityDecision, b: CapabilityDecision): number {
  if (a.score !== b.score) return b.score - a.score;
  return a.index - b.index;
}
