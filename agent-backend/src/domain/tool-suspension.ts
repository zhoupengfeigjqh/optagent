export interface ToolSuspension {
  suspended: boolean;
  code: string;
  /** 挂起后被调用过几次：第 1 次软拒，`>1` 触发兜底 */
  attempts: number;
  /** 兜底出口是否已触发（每次挂起最多一次） */
  exhausted: boolean;
  /** 兜底出口：装配层接到"纯中止本轮"（与用户点停止同路径） */
  onExhausted?: () => void;
}

/**
 * 挂起后再次被调用时的短文案（020 / 021 共用）。
 *
 * 与各闸门自己的"首次拒绝 + 终局指令"分开：第一次要解释"为什么停"，
 * 后续只需提醒"别再调"。文案的唯一来源在这里，两个包装器只引用不拼字。
 */
export const SUSPENDED_MESSAGE = '本轮已停止执行工具，请直接结束回答。';

export function createToolSuspension(onExhausted?: () => void): ToolSuspension {
  const state: ToolSuspension = { suspended: false, code: '', attempts: 0, exhausted: false };
  if (onExhausted !== undefined) state.onExhausted = onExhausted;
  return state;
}

/** 标记本轮挂起（幂等；已挂起时不覆盖首个触发码） */
export function suspendTools(state: ToolSuspension, code: string): void {
  if (state.suspended) return;
  state.suspended = true;
  state.code = code;
}

export function abortRunFatal(state: ToolSuspension, code: string): void {
  suspendTools(state, code);
  if (state.exhausted) return;
  state.exhausted = true;
  try {
    state.onExhausted?.();
  } catch {
    // 回调异常不阻断挂起
  }
}

/**
 * 挂起后的拦截：返回 `true` 表示"本次调用直接拒绝"。
 *
 * 副作用：累加 `attempts`；第 2 次起触发一次兜底（模型不配合时的有界退出）。
 * 兜底回调抛错被吞掉——可观测性出口不得反过来制造故障。
 */
export function interceptSuspended(state: ToolSuspension): boolean {
  if (!state.suspended) return false;
  state.attempts += 1;
  if (state.attempts > 1 && !state.exhausted) {
    state.exhausted = true;
    try {
      state.onExhausted?.();
    } catch {
      // 兜底出口故障不影响本次拒绝结果
    }
  }
  return true;
}
