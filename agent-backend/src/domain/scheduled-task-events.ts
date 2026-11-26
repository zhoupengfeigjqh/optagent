export type ScheduledTaskChangeListener = () => void;

export class ScheduledTaskEvents {
  private readonly listeners = new Map<string, Set<ScheduledTaskChangeListener>>();

  emitChanged(userId: string): void {
    const set = this.listeners.get(userId);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener();
      } catch {
        // 单个订阅者异常不阻断其他订阅者
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
