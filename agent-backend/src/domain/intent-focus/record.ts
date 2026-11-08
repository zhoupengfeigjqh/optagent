/**
 * 留档铸造（016 / 019）：把技能决策、概念、两通道行为映射为 `IntentFocusRecordDraft`。
 *
 * 2026-11-06 精简：只写**入选行为**，删除 `functions` / `data_supplements`。
 *
 * 2026-11-08（019）：发散让"同一条行为可能只出现在一个通道"，因此记录按**通道**分两份：
 * - `behaviors` = 提示通道（直接命中 + 上游发散）；
 * - `tool_tip_behaviors` = 卡片通道（直接命中 + 下游发散）。
 * 两条通道都含直接命中（各自完整），这样"为什么提示里有它、卡片里没有它"可以单独对账；
 * 发散项 `score` 恒为 `null`（不再判分），`via_concept` / `hop` 用于回溯发散路径。
 */
import type { IntentFocusDisposition } from './state.js';
import type {
  CapabilityFocusRecord,
  ConceptFocusRecord,
  IntentFocusRecordDraft,
  SkillFocusRecord,
} from './store.js';
import type {
  BehaviorSource,
  CapabilityDecision,
  CapabilitySelection,
  ExpandedBehavior,
  SkillDecision,
} from './types.js';

/** 提示通道里的概念条目（直接命中或上游发散） */
export interface ConceptEntry {
  ontologyId: string;
  ontologyName: string | null;
  name: string;
  title: string;
  source: 'direct' | 'upstream';
  hop: number;
  viaConcept: string | null;
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
  /** 直接命中的行为（Laya 判分结果） */
  capabilities: CapabilitySelection;
  concepts?: readonly ConceptEntry[];
  upstreamBehaviors?: readonly ExpandedBehavior[];
  downstreamBehaviors?: readonly ExpandedBehavior[];
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

  const direct: CapabilityFocusRecord[] = input.capabilities.behaviors.map(toDirectRecord);

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
    behaviors: [...direct, ...(input.upstreamBehaviors ?? []).map(toExpandedRecord('upstream'))],
    tool_tip_behaviors: [
      ...direct,
      ...(input.downstreamBehaviors ?? []).map(toExpandedRecord('downstream')),
    ],
    prompt: input.prompt,
    prompt_truncated: input.promptTruncated,
    warnings: [...input.warnings],
    error: input.error,
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
  };
}

/** 发散项：`score` 恒为 null（019：只走一次判定，发散不再判分） */
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
  });
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
  };
}
