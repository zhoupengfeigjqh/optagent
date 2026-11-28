/**
 * 批次装配的纯函数部件（028）：把编排器里的“无 IO 逻辑”抽出来。
 *
 * 为什么单独一层：`infra/plan-orchestrator.ts` 只该负责“调谁、何时调”，
 * 而“怎么归一、重规划怎么说、哪些工具算内置”都是可穷举的纯逻辑，
 * 放在 infra 会让单文件越过 500 行门禁（宪章原则二），也无法单测。
 */
import { matchKeys } from '../ontology-doc.js';
import type { BehaviorLookup } from '../rule-gate/types.js';
import { normalizePlan, type OntologyFacts, type ToolNameIndex } from './normalize.js';
import { BUILTIN_TOOL_NAMES, type CheckFailure, type PlanStep, type RawStep } from './types.js';

export type PlanKind = 'initial' | 'roll' | 'failure';

export interface NormalizeBatchInput {
  raw: readonly RawStep[];
  base: number;
  nameIndex: ToolNameIndex;
  behaviorOf(name: string): BehaviorLookup | null;
  facts: OntologyFacts;
}

export interface NormalizeBatchResult {
  steps: PlanStep[];
  failures: CheckFailure[];
  /**
   * 提交用的下一序号。
   *
   * 调用方 MUST 只在**校验通过**后采用它——否则失败重试会在 `seqId` 上留下空洞。
   */
  nextSeqId: number;
}

export function normalizeBatch(input: NormalizeBatchInput): NormalizeBatchResult {
  let pending = input.base;
  const result = normalizePlan(input.raw, {
    nameIndex: input.nameIndex,
    behaviorOf: input.behaviorOf,
    facts: input.facts,
    nextSeqId: () => {
      pending += 1;
      return pending;
    },
  });
  return { steps: result.steps, failures: result.failures, nextSeqId: pending };
}

export interface ContinueInput {
  goal: string;
  doneSummary: readonly string[];
  kind: PlanKind;
  failure?: string;
}

export function renderContinueInput(input: ContinueInput): string {
  const lines = [`目标（本轮用户请求）：${input.goal}`];
  if (input.doneSummary.length > 0) {
    lines.push(`已完成结论：\n${input.doneSummary.map((line) => `· ${line}`).join('\n')}`);
  }
  if (input.failure !== undefined) lines.push(`上一步失败原因：${input.failure}`);
  lines.push(
    input.kind === 'roll'
      ? '队列已全部执行完毕。仅当仍有必要的后续步骤时才输出 1~3 步；目标已完全达成时直接输出 []，不要为了凑步骤而新增无意义的动作。'
      : '请据此重新规划后续步骤（1~3 步）；若已无法继续，输出 []。',
  );
  return lines.join('\n\n');
}

export interface StaleStep {
  step: PlanStep;
  functions: readonly string[];
}

export function replanReasonOf(failed: PlanStep | null, stale?: StaleStep): string {
  if (stale !== undefined) return 'stale_functions';
  return failed === null ? 'stalled' : `step_${failed.seqId}`;
}

export function failureNarrative(failed: PlanStep | null, stale?: StaleStep): string {
  if (stale !== undefined) {
    return `第 ${stale.step.seqId} 步「${stale.step.taskName}」依赖的 ${stale.functions.join('、')} 已被上一步写操作失效，须先重算再执行`;
  }
  return failed === null ? '连续无进展' : `第 ${failed.seqId} 步「${failed.taskName}」未能完成`;
}

/** 只告警的日志口（避免 domain 反向依赖 infra 的 logger 类型） */
export interface EventSink {
  warn(fields: Record<string, unknown>, message: string): void;
}

export function warnOutOfFocus(steps: readonly PlanStep[], focusPrompt: string, sink: EventSink): void {
  for (const step of steps) {
    if (focusPrompt.includes(step.coreActionLabel)) continue;
    sink.warn(
      { event: 'plan.step.out_of_focus', seq_id: step.seqId, core_action: step.coreAction },
      '步骤的 coreAction 未出现在聚焦结果中',
    );
  }
}

export function collectAvailable(toolNames: readonly string[]): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const name of toolNames) {
    for (const key of matchKeys(name)) keys.add(key);
  }
  return keys;
}

/** 内置工具原样可见（`read_file` 等裸名；兼容带服务前缀的形态） */
export function isBuiltinTool(toolName: string): boolean {
  if (BUILTIN_TOOL_NAMES.includes(toolName)) return true;
  const separator = toolName.indexOf('__');
  const bare = separator >= 0 ? toolName.slice(separator + 1 + 1) : toolName;
  return BUILTIN_TOOL_NAMES.includes(bare);
}

/**
 * 助手消息正文（`doneSummary` 的来源；只取文本块）。
 *
 * **不在这里截断**：截断的唯一点是 `state.appendSummary`（剥表格 + 标点回退 + 80 字上限）。
 * 若此处先切 80 字，表格会被切在半个单元格上，下游再也剥不干净。
 */
export function assistantText(message: { content?: unknown }): string {
  const content = message.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue;
    const { type, text } = block as { type?: unknown; text?: unknown };
    if (type === 'text' && typeof text === 'string') parts.push(text);
  }
  return parts.join('\n').trim();
}
