/**
 * 定时任务变更信号总线（015）：与 `ProducedEvents` 同构。
 *
 * 只发"可能已变"的空信号，不携带数据：
 * - 前端收到后重拉列表（与左栏会话），不必处理增量合并；
 * - 信号丢失没有任何后果（列表与记录都能从文件重算），因此不需要重放/补偿。
 */
export type ScheduledTaskChangeListener = () => void;

export class ScheduledTaskEvents {
  private readonly listeners = new Map<string, Set<ScheduledTaskChangeListener>>();

  /** 通知某用户的订阅者（执行完成 / 状态变化时调用） */
  emitChanged(userId: string): void {
    const set = this.listeners.get(userId);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener();
      } catch {
        /* 单个订阅者异常不影响其他订阅者与业务主流程 */
      }
    }
  }

  /** 订阅；返回退订函数（SSE 断连时必须调用，否则泄漏） */
  onChanged(userId: string, listener: ScheduledTaskChangeListener): () => void {
    let set = this.listeners.get(userId);
    if (!set) {
      set = new Set();
      this.listeners.set(userId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) this.listeners.delete(userId);
    };
  }
}
