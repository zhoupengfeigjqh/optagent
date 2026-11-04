/**
 * 候选构造（016）：技能候选 + 本体能力候选 + `noul` 题面。
 *
 * 题号用**不透明下标**（`s1..sN` / `c1..cN`）而不是 `name`：本体的行为名 / 函数名可能
 * 含空格、中文标点，甚至与技能名重名；用下标做键，响应 `answers[qid]` 的对齐永远成立
 * （013 用工具名是因为工具名是形如 `read_file` 的标识符，口径不同）。
 *
 * 题面只用 `title`（`title` 缺失/为空时降级为 `name`）：`op_type` 与描述长文都不进题面
 * （FR-022）——描述长文会把题面推到模型单题上限附近，且对"是否切题"没有增量信息。
 */
import type {
  CapabilityCandidate,
  OntologyDefinition,
  OntologyIndex,
  QuestionMap,
  SkillCandidate,
  SkillDecision,
  SkillHeaderLike,
} from './types.js';

/** 题面展示名截断：过长的展示名会把区分度打到 0（与 013 同口径） */
const MAX_DISPLAY_CHARS = 40;

/** 每条命题都用的极简判据（实测优于冗长判据，见 013 research） */
const NOUL_CRITERIA = { true: '需要', false: '不需要' } as const;

/** 构造一条 noul 命题（判据统一「需要/不需要」） */
function noulQuestion(instructions: string): QuestionMap[string] {
  return { type: 'noul', instructions, criteria: { ...NOUL_CRITERIA } };
}

export interface SkillCandidateResult {
  candidates: SkillCandidate[];
  /** 未匹配本体的本体技能：不评分，但要留档原因（FR-014） */
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

/** 技能命题：键为 `qid`，题面只用 `description`（极简命题式，非问句） */
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

/**
 * 构造本体能力候选（仅入选本体技能引用的本体）。
 *
 * 顺序固定为「本体文件枚举序 → 行为数组序 → 函数数组序」：这是"本体原序"的唯一含义，
 * 去重后的补充项也按它追加（FR-025），因此不能改成 Map/Set 的迭代顺序。
 *
 * **候选层就按 `kind + ontology_id + name` 去重**：同一 `ontology_id` 可能被物化成多份
 * 文件（或多个技能引用同一本体），若在候选层不去重，同一行为会被当作两道题重复判定、
 * 并挤占 `maxCapabilities` 预算。同类内同名同本体只保留首次出现（即枚举序在前的那份）。
 */
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

  const take = (candidate: CapabilityCandidate): void => {
    const key = `${candidate.kind}\u0000${candidate.ontologyId}\u0000${candidate.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    collected.push({ ...candidate, index: order++ });
  };

  for (const ontology of ordered) {
    for (const behavior of ontology.behaviors) {
      take({
        qid: '',
        kind: 'behavior',
        name: behavior.name,
        title: behavior.title,
        ontologyId: ontology.ontologyId,
        ontologyName: ontology.ontologyName,
        index: 0,
      });
    }
    for (const fn of ontology.functions) {
      take({
        qid: '',
        kind: 'function',
        name: fn.name,
        title: fn.title,
        ontologyId: ontology.ontologyId,
        ontologyName: ontology.ontologyName,
        index: 0,
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

/** 能力命题：键为 `qid`，题面只用 `title`（title 缺失/为空时降级为 `name`），极简命题式 */
export function buildCapabilityQuestions(candidates: readonly CapabilityCandidate[]): QuestionMap {
  const questions: QuestionMap = {};
  for (const candidate of candidates) {
    const label = candidate.kind === 'behavior' ? '行为' : '函数';
    // 只留展示名：title 优先（更贴近"这轮要做什么"的语义），空则降级为 name。
    // `name` 是英文标识符，对判定的区分度远不如中文 title，故能省则省。
    const display = candidate.title.trim() !== '' ? candidate.title : candidate.name;
    questions[candidate.qid] = noulQuestion(`需要${label}「${trim(display)}」`);
  }
  return questions;
}

/** 按 `batchSize` 切批（题号随候选固定，切批只影响请求体大小） */
export function batchQuestions(
  candidates: readonly { qid: string }[],
  questions: QuestionMap,
  batchSize: number,
): QuestionMap[] {
  const size = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 32;
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

/** 与本体文件枚举同序的本体列表（供选择阶段查规则用） */
export function orderedOntologies(
  selectedSkills: readonly SkillCandidate[],
  index: OntologyIndex,
): OntologyDefinition[] {
  const ids = new Set<string>();
  for (const skill of selectedSkills) {
    if (!skill.isOntologySkill) continue;
    for (const ontology of skill.matchedOntologies) ids.add(ontology.ontologyId);
  }
  return index.all.filter((ontology) => ids.has(ontology.ontologyId));
}

function trim(text: string): string {
  return text.length <= MAX_DISPLAY_CHARS ? text : text.slice(0, MAX_DISPLAY_CHARS);
}
