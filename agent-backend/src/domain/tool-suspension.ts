/**
 * 本轮工具挂起状态（2026-11-09，020 权限闸门 / 021 规则闸门共用）。
 *
 * 语义：**任一次拒绝之后，本轮不再执行任何工具**，但本轮对话继续——
 * 模型收到结果后向用户说明并收尾（软收尾），不硬切断。
 *
 * 为什么做成共享对象：021 的包装器在 020 内侧，模型后续的工具调用会先过 020。
 * 两个闸门必须看到同一份状态，否则"规则拒绝"之后仍可能被 020 放行并执行。
 *
 * 生命周期：由装配层在**每轮**创建一次，随工具数组丢弃（不落实例、不跨轮）。
 */
export interface ToolSuspension {
  /** 本轮是否已出现过拒绝 */
  suspended: boolean;
  /** 触发挂起的错误码（挂起后的拦截沿用同一码，不新增错误码） */
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

/** 新建一份本轮挂起状态（装配层每轮调用一次） */
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
