import type { IntentFocusDisposition } from './state.js';
import {
  REWRITE_RECORD_DEFAULTS,
  type CapabilityFocusRecord,
  type ConceptFocusRecord,
  type FunctionFocusRecord,
  type IntentFocusRecordDraft,
  type RewriteFocusRecord,
  type SkillFocusRecord,
} from './store.js';
import type {
  BehaviorSource,
  CapabilityDecision,
  CapabilitySelection,
  ConceptQueryDecision,
  ExpandedBehavior,
  FunctionDecision,
  SkillDecision,
} from './types.js';

export interface ConceptEntry {
  ontologyId: string;
  ontologyName: string | null;
  name: string;
  title: string;
  source: 'direct' | 'upstream';
  hop: number;
  viaConcept: string | null;
  edges?: ReadonlyArray<{ from: string; relation: string }>;
}

export interface RecordInput {
  threadId: string;
  agentName: string;
  messageId: string | null;
  input: string;
  inputTruncated: boolean;
  disposition: IntentFocusDisposition;
  reason: string | null;
  model: string | null;
  roundMs: number | null;
  candidateCount: number;
  batches: number;
  truncated: boolean;
  /**
   * 本轮生效的聚焦阶数（0 = 只聚焦本身）。
   *
   * 019 新增的四项都给了缺省：空结果 / 降级 / 跳过分支没有发散，
   * 缺省即"无发散"，调用方不必为了补字段而重写早退路径。
   */
  depth?: number;
  skills: readonly SkillDecision[];
  capabilities: CapabilitySelection;
  concepts?: readonly ConceptEntry[];
  upstreamBehaviors?: readonly ExpandedBehavior[];
  downstreamBehaviors?: readonly ExpandedBehavior[];
  prompt: string;
  promptTruncated: boolean;
  warnings: readonly string[];
  error: string | null;
  rewrite?: Partial<RewriteFocusRecord>;
  /** 028：规划门禁分数与耗时（未判定时缺省） */
  planScore?: number | null;
  planRoundMs?: number | null;
}

export function buildRecordDraft(input: RecordInput): IntentFocusRecordDraft {
  const skills: SkillFocusRecord[] = input.skills.map((skill) => ({
    name: skill.header.name,
    description: skill.header.description,
    is_ontology: skill.isOntology,
    ontology_id: skill.ontologyId,
    score: skill.score,
    selected: skill.selected,
    reason: skill.reason,
  }));

  const direct: CapabilityFocusRecord[] = input.capabilities.behaviors.map(toDirectRecord);
  const conceptQueryRecords = input.capabilities.conceptQueries.map(toConceptQueryRecord);

  return {
    thread_id: input.threadId,
    agent_name: input.agentName,
    message_id: input.messageId,
    input: input.input,
    input_truncated: input.inputTruncated,
    disposition: input.disposition,
    reason: input.reason,
    model: input.model,
    round_ms: input.roundMs,
    candidates: input.candidateCount,
    batches: input.batches,
    truncated: input.truncated,
    depth: input.depth ?? 0,
    skills,
    concepts: (input.concepts ?? []).map(toConceptRecord),
    behaviors: [
      ...direct,
      ...conceptQueryRecords,
      ...(input.upstreamBehaviors ?? []).map(toExpandedRecord('upstream')),
    ],
    tool_tip_behaviors: [
      ...direct,
      ...(input.downstreamBehaviors ?? []).map(toExpandedRecord('downstream')),
    ],
    functions: input.capabilities.functions.map(toFunctionRecord),
    prompt: input.prompt,
    prompt_truncated: input.promptTruncated,
    warnings: [...input.warnings],
    error: input.error,
    need_rewrite: input.rewrite?.need_rewrite ?? REWRITE_RECORD_DEFAULTS.need_rewrite,
    rewrite_score: input.rewrite?.rewrite_score ?? REWRITE_RECORD_DEFAULTS.rewrite_score,
    rewrite_query: input.rewrite?.rewrite_query ?? REWRITE_RECORD_DEFAULTS.rewrite_query,
    rewrite_truncated: input.rewrite?.rewrite_truncated ?? REWRITE_RECORD_DEFAULTS.rewrite_truncated,
    rewrite_ms: input.rewrite?.rewrite_ms ?? REWRITE_RECORD_DEFAULTS.rewrite_ms,
    rewrite_history_turns:
      input.rewrite?.rewrite_history_turns ?? REWRITE_RECORD_DEFAULTS.rewrite_history_turns,
    rewrite_reason: input.rewrite?.rewrite_reason ?? REWRITE_RECORD_DEFAULTS.rewrite_reason,
    ...(input.planScore !== undefined ? { plan_score: input.planScore } : {}),
    ...(input.planRoundMs !== undefined ? { plan_round_ms: input.planRoundMs } : {}),
  };
}

function toDirectRecord(decision: CapabilityDecision): CapabilityFocusRecord {
  return {
    name: decision.name,
    title: decision.title,
    ontology_id: decision.ontologyId,
    ontology_name: decision.ontologyName,
    score: decision.score,
    source: 'direct',
    hop: 0,
    via_concept: decision.concept,
    from_concept: null,
  };
}

function toExpandedRecord(
  source: Exclude<BehaviorSource, 'direct'>,
): (behavior: ExpandedBehavior) => CapabilityFocusRecord {
  return (behavior) => ({
    name: behavior.name,
    title: behavior.title,
    ontology_id: behavior.ontologyId,
    ontology_name: behavior.ontologyName,
    score: null,
    source,
    hop: behavior.hop,
    via_concept: behavior.viaConcept,
    from_concept: behavior.fromConcept,
  });
}

function toFunctionRecord(fn: FunctionDecision): FunctionFocusRecord {
  return {
    name: fn.name,
    title: fn.title,
    ontology_id: fn.ontologyId,
    ontology_name: fn.ontologyName,
    score: fn.score,
    related_concepts: [...fn.relatedConcepts],
  };
}

function toConceptQueryRecord(query: ConceptQueryDecision): CapabilityFocusRecord {
  return {
    name: query.name,
    title: query.title,
    ontology_id: query.ontologyId,
    ontology_name: query.ontologyName,
    score: null,
    source: 'concept_query',
    hop: 0,
    via_concept: query.concept,
    from_concept: null,
  };
}

function toConceptRecord(entry: ConceptEntry): ConceptFocusRecord {
  return {
    name: entry.name,
    title: entry.title,
    ontology_id: entry.ontologyId,
    ontology_name: entry.ontologyName,
    source: entry.source,
    hop: entry.hop,
    via_concept: entry.viaConcept,
    via_edges: (entry.edges ?? []).map((edge) => ({ from: edge.from, relation: edge.relation })),
  };
}
