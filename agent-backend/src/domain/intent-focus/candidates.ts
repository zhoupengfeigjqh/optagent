import { MAX_QUESTIONS_PER_BATCH } from './state.js';
import type {
  CapabilityCandidate,
  OntologyIndex,
  QuestionMap,
  SkillCandidate,
  SkillDecision,
  SkillHeaderLike,
} from './types.js';

const MAX_DISPLAY_CHARS = 40;

const NOUL_CRITERIA = { true: '需要', false: '不需要' } as const;

function noulQuestion(instructions: string): QuestionMap[string] {
  return { type: 'noul', instructions, criteria: { ...NOUL_CRITERIA } };
}

export interface SkillCandidateResult {
  candidates: SkillCandidate[];
  excluded: SkillDecision[];
  truncated: boolean;
}

/**
 * 构造可聚焦技能候选。
 *
 * - 非本体技能：一律可聚焦（只读头部，FR-019）；
 * - 本体技能：`ontology_id` 必须命中至少一个已物化本体才可聚焦；
 * - 命中多个同 ID 本体时全部保留（FR-013），后续能力按本体去重合并。
 */
export function buildSkillCandidates(
  headers: readonly SkillHeaderLike[],
  index: OntologyIndex,
  maxSkills: number,
): SkillCandidateResult {
  const focusable: SkillCandidate[] = [];
  const excluded: SkillDecision[] = [];

  for (const header of headers) {
    const ontologyId = header.metadata.ontologyId;
    const isOntologySkill = ontologyId !== null && header.metadata.ontologyName !== null;
    if (!isOntologySkill) {
      focusable.push({
        qid: '',
        header,
        matchedOntologies: [],
        isOntologySkill: false,
        index: focusable.length,
      });
      continue;
    }

    const matchedOntologies = index.byId.get(ontologyId!) ?? [];
    if (matchedOntologies.length === 0) {
      excluded.push({
        header,
        isOntology: true,
        ontologyId: null,
        score: null,
        selected: false,
        reason: 'no_matching_ontology',
      });
      continue;
    }
    focusable.push({
      qid: '',
      header,
      matchedOntologies,
      isOntologySkill: true,
      index: focusable.length,
    });
  }

  const truncated = focusable.length > maxSkills;
  const sliced = truncated ? focusable.slice(0, maxSkills) : focusable;
  return {
    candidates: sliced.map((candidate, i) => ({ ...candidate, qid: `s${i + 1}`, index: i })),
    excluded,
    truncated,
  };
}

export function buildSkillQuestions(candidates: readonly SkillCandidate[]): QuestionMap {
  const questions: QuestionMap = {};
  for (const candidate of candidates) {
    questions[candidate.qid] = noulQuestion(`需要技能「${trim(candidate.header.description)}」`);
  }
  return questions;
}

export interface CapabilityCandidateResult {
  candidates: CapabilityCandidate[];
  truncated: boolean;
}

export function buildCapabilityCandidates(
  selectedSkills: readonly SkillCandidate[],
  index: OntologyIndex,
  maxCapabilities: number,
): CapabilityCandidateResult {
  const selectedIds = new Set<string>();
  for (const skill of selectedSkills) {
    if (!skill.isOntologySkill) continue;
    for (const ontology of skill.matchedOntologies) selectedIds.add(ontology.ontologyId);
  }

  const ordered = index.all.filter((ontology) => selectedIds.has(ontology.ontologyId));
  const collected: CapabilityCandidate[] = [];
  const seen = new Set<string>();
  let order = 0;

  for (const ontology of ordered) {
    for (const behavior of ontology.behaviors) {
      const key = `${ontology.ontologyId}\u0000behavior\u0000${behavior.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push({
        qid: '',
        kind: 'behavior',
        name: behavior.name,
        title: behavior.title,
        description: behavior.description,
        ontologyId: ontology.ontologyId,
        ontologyName: ontology.ontologyName,
        concept: behavior.concept,
        relatedConcepts: [],
        index: order++,
      });
    }
    // 2026-11-20：函数排在同本体的行为之后，共用上限与批次
    for (const fn of ontology.functions) {
      const key = `${ontology.ontologyId}\u0000function\u0000${fn.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push({
        qid: '',
        kind: 'function',
        name: fn.name,
        title: fn.title,
        description: fn.description,
        ontologyId: ontology.ontologyId,
        ontologyName: ontology.ontologyName,
        concept: null,
        relatedConcepts: fn.relatedConcepts,
        index: order++,
      });
    }
  }

  const truncated = collected.length > maxCapabilities;
  const sliced = truncated ? collected.slice(0, maxCapabilities) : collected;
  return {
    candidates: sliced.map((candidate, i) => ({ ...candidate, qid: `c${i + 1}` })),
    truncated,
  };
}

/**
 * 能力命题：键为 `qid`，题面按 `description → title → name` 降级，极简命题式。
 *
 * 措辞按 `kind` 分派（`需要行为` / `需要函数`）：函数不是"能做的事"，而是"算得出什么"，
 * 同一句话套在两类上会让 Laya 的判定口径漂移。
 */
export function buildCapabilityQuestions(candidates: readonly CapabilityCandidate[]): QuestionMap {
  const questions: QuestionMap = {};
  for (const candidate of candidates) {
    const need = candidate.kind === 'function' ? '需要函数' : '需要行为';
    questions[candidate.qid] = noulQuestion(`${need}「${capabilityLabel(candidate)}」`);
  }
  return questions;
}

/**
 * 行为题面的展示文本：**description → title → name** 逐级降级。
 *
 * 描述最能表达"这轮要做什么"，其次标题；`name` 是英文标识符，区分度最差，
 * 只在前两者都为空时兜底。统一按 40 字截断（FR-022）。
 */
function capabilityLabel(candidate: CapabilityCandidate): string {
  for (const text of [candidate.description, candidate.title, candidate.name]) {
    const trimmed = text.trim();
    if (trimmed !== '') return trim(trimmed);
  }
  return '';
}

export function batchQuestions(
  candidates: readonly { qid: string }[],
  questions: QuestionMap,
  batchSize: number = MAX_QUESTIONS_PER_BATCH,
): QuestionMap[] {
  const size = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : MAX_QUESTIONS_PER_BATCH;
  const batches: QuestionMap[] = [];
  for (let start = 0; start < candidates.length; start += size) {
    const slice = candidates.slice(start, start + size);
    const batch: QuestionMap = {};
    for (const candidate of slice) {
      const question = questions[candidate.qid];
      if (question) batch[candidate.qid] = question;
    }
    batches.push(batch);
  }
  return batches;
}

function trim(text: string): string {
  return text.length <= MAX_DISPLAY_CHARS ? text : text.slice(0, MAX_DISPLAY_CHARS);
}
