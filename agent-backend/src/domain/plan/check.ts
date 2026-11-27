import { matchKeys } from '../ontology-doc.js';
import {
  CONTENT_MAX,
  PLAN_MAX_STEPS,
  TASK_NAME_MAX,
  type CheckFailure,
  type PlanStep,
  type StepType,
} from './types.js';

const STEP_TYPES: readonly StepType[] = ['command', 'query', 'function'];

export type BehaviorRoleLookup = (toolName: string) => { command: boolean } | null;

export interface CheckInput {
  steps: readonly PlanStep[];
  available: ReadonlySet<string>;
  behaviorOf: BehaviorRoleLookup;
  preFailures?: readonly CheckFailure[];
}

export interface CheckResult {
  ok: boolean;
  failures: CheckFailure[];
}

export function checkPlan(input: CheckInput): CheckResult {
  const failures: CheckFailure[] = [...(input.preFailures ?? [])];

  if (input.steps.length > PLAN_MAX_STEPS) {
    failures.push({
      code: 'C5',
      seqId: null,
      field: null,
      detail: `步数 ${input.steps.length} 超过上限 ${PLAN_MAX_STEPS}`,
    });
  }

  const seenCommands = new Map<string, number>();

  for (const step of input.steps) {
    // C0：coreAction 必须能在本轮工具集中唯一对应
    if (!isAvailable(step.coreAction, input.available)) {
      failures.push({
        code: 'C0',
        seqId: step.seqId,
        field: 'coreAction',
        detail: `coreAction「${step.coreAction}」不在本轮可用工具中`,
      });
    }

    if (!STEP_TYPES.includes(step.type)) {
      failures.push({
        code: 'C1',
        seqId: step.seqId,
        field: 'type',
        detail: `type「${String(step.type)}」不是 command / query / function 之一`,
      });
    }

    const role = input.behaviorOf(step.coreAction);
    const expected: StepType = role === null ? 'function' : role.command ? 'command' : 'query';
    if (step.type !== expected) {
      failures.push({
        code: 'C2',
        seqId: step.seqId,
        field: 'type',
        detail: `type 标为「${step.type}」，但该工具实际是「${expected}」`,
      });
    }

    // C3：dependTools 必须都在本轮可用工具中
    for (const tool of step.dependTools) {
      if (!isAvailable(tool, input.available)) {
        failures.push({
          code: 'C3',
          seqId: step.seqId,
          field: 'dependTools',
          detail: `依赖「${tool}」不在本轮可用工具中`,
        });
      }
    }

    if (expected === 'command') {
      const previous = seenCommands.get(step.coreAction);
      if (previous !== undefined) {
        failures.push({
          code: 'C4',
          seqId: step.seqId,
          field: 'coreAction',
          detail: `与第 ${previous} 步重复使用 command「${step.coreActionLabel}」，同一 command 只能占一步，请把重复的一步推迟到下一批`,
        });
      } else {
        seenCommands.set(step.coreAction, step.seqId);
      }
    }

    if (step.coreAction.trim() === '') {
      failures.push({
        code: 'C5',
        seqId: step.seqId,
        field: 'coreAction',
        detail: 'coreAction 不能为空',
      });
    }
    const nameLength = charLength(step.taskName);
    if (nameLength > TASK_NAME_MAX) {
      failures.push({
        code: 'C5',
        seqId: step.seqId,
        field: 'taskName',
        detail: `taskName 为 ${nameLength} 字，超过上限 ${TASK_NAME_MAX}`,
      });
    }
    const contentLength = charLength(step.content);
    if (contentLength > CONTENT_MAX) {
      failures.push({
        code: 'C5',
        seqId: step.seqId,
        field: 'content',
        detail: `content 为 ${contentLength} 字，超过上限 ${CONTENT_MAX}`,
      });
    }
  }

  return { ok: failures.length === 0, failures };
}

export function charLength(text: string): number {
  return Array.from(text).length;
}

function isAvailable(name: string, available: ReadonlySet<string>): boolean {
  if (name.trim() === '') return false;
  return matchKeys(name).some((key) => available.has(key));
}
