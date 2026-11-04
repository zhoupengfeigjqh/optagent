/**
 * 留档铸造（016）：把技能决策 / 能力决策 / 数据补充明细映射为 `IntentFocusRecordDraft`。
 *
 * 明细有上限（FR-053）：单轮候选明细超限时截断并置 `truncated`，**保留计数与结论**——
 * 记录是排障用的，不能因为某个本体特别大就把整行写到 256KB。
 */
import type { IntentFocusDisposition } from '../intent-focus.js';
import type {
  CapabilityFocusRecord,
  DataSupplementRecord,
  IntentFocusRecordDraft,
  SkillFocusRecord,
} from '../intent-focus-store.js';
import type { CapabilitySelection, DataSupplement, SkillDecision } from './types.js';

/** 单轮能力明细上限（行为 + 函数 + 补充） */
export const MAX_RECORD_DETAILS = 200;

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
  skills: readonly SkillDecision[];
  capabilities: CapabilitySelection;
  prompt: string;
  promptTruncated: boolean;
  warnings: readonly string[];
  error: string | null;
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

  const capabilityRecords: CapabilityFocusRecord[] = [
    ...input.capabilities.behaviors.map((decision) => toCapabilityRecord(decision)),
    ...input.capabilities.functions.map((decision) => toCapabilityRecord(decision)),
  ];
  const supplementRecords: DataSupplementRecord[] = input.capabilities.supplements.map(
    (supplement: DataSupplement) => ({
      ontology_id: supplement.ontologyId,
      behavior: supplement.behavior,
      supplement: supplement.supplement,
      found: supplement.found,
    }),
  );

  let detailsTruncated = false;
  const limited = capabilityRecords.slice(0, MAX_RECORD_DETAILS);
  if (limited.length < capabilityRecords.length) detailsTruncated = true;
  const behaviors = limited.filter((record) => record.kind === 'behavior');
  const functions = limited.filter((record) => record.kind === 'function');

  let supplements = supplementRecords;
  if (supplements.length > MAX_RECORD_DETAILS) {
    detailsTruncated = true;
    supplements = supplements.slice(0, MAX_RECORD_DETAILS);
  }

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
    truncated: input.truncated || detailsTruncated,
    skills,
    behaviors,
    functions,
    data_supplements: supplements,
    prompt: input.prompt,
    prompt_truncated: input.promptTruncated,
    warnings: [...input.warnings],
    error: input.error,
  };
}

function toCapabilityRecord(
  decision: CapabilitySelection['behaviors'][number],
): CapabilityFocusRecord {
  return {
    kind: decision.kind,
    name: decision.name,
    title: decision.title,
    ontology_id: decision.ontologyId,
    ontology_name: decision.ontologyName,
    score: decision.score,
    selected: decision.selected,
    source: decision.source,
  };
}
