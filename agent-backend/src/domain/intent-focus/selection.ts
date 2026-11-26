import type {
  CapabilityCandidate,
  CapabilityDecision,
  CapabilitySelection,
  FunctionDecision,
  SkillCandidate,
  SkillDecision,
} from './types.js';

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
      ontologyId: candidate.matchedOntologies[0]?.ontologyId ?? null,
      score: typeof score === 'number' ? score : null,
      selected,
      reason: selected ? null : typeof score === 'number' ? 'below_threshold' : 'missing_score',
    };
  });
}

export interface CapabilityThresholds {
  behavior: number;
  function: number;
}

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

function keyOf(item: { ontologyId: string; name: string }): string {
  return `${item.ontologyId}\u0000${item.name}`;
}

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
