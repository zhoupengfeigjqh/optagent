/**
 * 计划硬校验 C0~C5（028 FR-011/FR-012）。
 *
 * **只判定、不改数据**：不补字段、不修 `type`、不重排步骤。
 * 多失败项同时返回（不短路），每条带 `{code, seqId, field, detail}`。
 *
 * 注意：这里的失败处理是**规划重试**（`planRetryCount`，上限 2），
 * 不是执行期的「失败重规划」（`replanCount`，上限 6），两者计数不同、MUST NOT 混用。
 */
import { matchKeys } from '../ontology-doc.js';
import {
  CONTENT_MAX,
  PLAN_MAX_STEPS,
  TASK_NAME_MAX,
  type CheckFailure,
  type PlanStep,
  type StepType,
} from './types.js';

/** `type` 的三个合法取值 */
const STEP_TYPES: readonly StepType[] = ['command', 'query', 'function'];

/** 本体角色查询（只读；用于 C2 复核 `type`） */
export type BehaviorRoleLookup = (toolName: string) => { command: boolean } | null;

/** 校验输入 */
export interface CheckInput {
  steps: readonly PlanStep[];
  /** 本轮挂载的工具名（已归一） */
  available: ReadonlySet<string>;
  /** 规则闸门只读查询（C2 复核） */
  behaviorOf: BehaviorRoleLookup;
  /** `normalizePlan` 的预检失败（C0/C3），并入最终结果 */
  preFailures?: readonly CheckFailure[];
}

/** 校验结果 */
export interface CheckResult {
  ok: boolean;
  failures: CheckFailure[];
}

/**
 * 执行六条硬校验。
 *
 * 空批次视为**合法**（`FR-004a`：首次 = 无需工具、滚动 = 已完成），
 * 语义由编排器按场景处理，这里不判越界。
 */
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

    // C1：type 取值合法
    if (!STEP_TYPES.includes(step.type)) {
      failures.push({
        code: 'C1',
        seqId: step.seqId,
        field: 'type',
        detail: `type「${String(step.type)}」不是 command / query / function 之一`,
      });
    }

    // C2：type 与本体角色一致（未命中本体 → function）
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

    // C4：批内同一 command 至多占一步（query / function 可重复）
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

    // C5：字段长度与必填
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

/** 按字符数计长（中文与代理对都算 1） */
export function charLength(text: string): number {
  return Array.from(text).length;
}

/** 任一派生键命中即视为已注册（与规则闸门的判定口径一致） */
function isAvailable(name: string, available: ReadonlySet<string>): boolean {
  if (name.trim() === '') return false;
  return matchKeys(name).some((key) => available.has(key));
}
