/**
 * 留档铸造（016）：把技能决策 / 行为决策映射为 `IntentFocusRecordDraft`。
 *
 * 2026-11-06 精简：
 * - 只写**入选行为**（`behaviors` 即入选集合），不再写 `selected` / `source` / `kind`；
 * - 删除 `functions` 与 `data_supplements`（功能已取消，字段恒为空）；
 * - 明细规模天然有界（行为 ≤96、技能 ≤32），原先的 200 条明细截断已无触发路径，一并删除。
 */
import type { IntentFocusDisposition } from './state.js';
import type {
  CapabilityFocusRecord,
  IntentFocusRecordDraft,
  SkillFocusRecord,
} from './store.js';
import type { CapabilityDecision, CapabilitySelection, SkillDecision } from './types.js';

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

  const behaviors: CapabilityFocusRecord[] = input.capabilities.behaviors.map(toCapabilityRecord);

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
    skills,
    behaviors,
    prompt: input.prompt,
    prompt_truncated: input.promptTruncated,
    warnings: [...input.warnings],
    error: input.error,
  };
}

function toCapabilityRecord(decision: CapabilityDecision): CapabilityFocusRecord {
  return {
    name: decision.name,
    title: decision.title,
    ontology_id: decision.ontologyId,
    ontology_name: decision.ontologyName,
    score: decision.score,
  };
}
