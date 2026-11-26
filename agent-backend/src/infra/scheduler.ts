export interface SchedulerLogger {
  warn(msg: string): void;
}

export class IntervalScheduler {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly logger?: SchedulerLogger) {}

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

  stopAll(): void {
    for (const name of [...this.timers.keys()]) this.clear(name);
  }

  get size(): number {
    return this.timers.size;
  }
}
