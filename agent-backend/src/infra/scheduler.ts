/**
 * Scheduler 接口实现（T040）：setInterval 注册 + 优雅关闭 stopAll。
 *
 * 任务异常只记日志不中断调度；定时器 unref，不阻碍进程退出。
 */
export interface SchedulerLogger {
  warn(msg: string): void;
}

export class IntervalScheduler {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly logger?: SchedulerLogger) {}

  /** 每 intervalMs 执行一次 task；同名重复注册会替换旧任务 */
  every(intervalMs: number, task: () => Promise<void>, name: string): void {
    this.clear(name);
    const timer = setInterval(() => {
      task().catch((err) => {
        this.logger?.warn(
          `后台任务 ${name} 执行失败：${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, intervalMs);
    timer.unref();
    this.timers.set(name, timer);
  }

  private clear(name: string): void {
    const t = this.timers.get(name);
    if (t) clearInterval(t);
    this.timers.delete(name);
  }

  /** 优雅关闭：停止全部任务 */
  stopAll(): void {
    for (const name of [...this.timers.keys()]) this.clear(name);
  }

  get size(): number {
    return this.timers.size;
  }
}
