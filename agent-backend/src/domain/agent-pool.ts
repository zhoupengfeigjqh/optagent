import type { PoolKey } from '../types.js';

export class PoolExhaustedError extends Error {
  readonly code = 'POOL_EXHAUSTED';
  constructor(message: string) {
    super(message);
    this.name = 'PoolExhaustedError';
  }
}

export interface PooledInstance {
  readonly key: PoolKey;
  activeThreads: number;
  lastActiveAt: number;
  dispose(): Promise<void> | void;
}

export interface AgentPoolOptions {
  maxSize: number;
  now?: () => number;
}

export class AgentPool {
  private readonly map = new Map<string, PooledInstance>();
  private readonly retired: PooledInstance[] = [];
  private readonly maxSize: number;
  private readonly now: () => number;

  constructor(opts: AgentPoolOptions) {
    this.maxSize = opts.maxSize;
    this.now = opts.now ?? Date.now;
  }

  private static id(key: PoolKey): string {
    return `${key.userId}${key.agentName}`;
  }

  get(key: PoolKey): PooledInstance | undefined {
    const inst = this.map.get(AgentPool.id(key));
    if (inst) inst.lastActiveAt = this.now();
    return inst;
  }

  put(instance: PooledInstance): void {
    const id = AgentPool.id(instance.key);
    if (this.map.has(id)) {
      this.map.set(id, instance);
      return;
    }
    if (this.map.size >= this.maxSize) {
      const evicted = this.lruEvictOne();
      if (!evicted) {
        throw new PoolExhaustedError(`实例池已满（${this.maxSize}）且无空闲实例可淘汰，请稍后再试`);
      }
    }
    instance.lastActiveAt = this.now();
    this.map.set(id, instance);
  }

  remove(key: PoolKey): void {
    const id = AgentPool.id(key);
    const inst = this.map.get(id);
    if (inst) {
      this.map.delete(id);
      void inst.dispose();
    }
  }

  /** 淘汰空闲超时实例，返回被淘汰的 key 列表 */
  evictIdle(maxIdleMs: number): PoolKey[] {
    const now = this.now();
    const evicted: PoolKey[] = [];
    for (const [id, inst] of this.map) {
      if (inst.activeThreads === 0 && now - inst.lastActiveAt > maxIdleMs) {
        this.map.delete(id);
        void inst.dispose();
        evicted.push(inst.key);
      }
    }
    return evicted;
  }

  lruEvictOne(): PoolKey | undefined {
    let oldest: PooledInstance | undefined;
    for (const inst of this.map.values()) {
      if (inst.activeThreads !== 0) continue;
      if (!oldest || inst.lastActiveAt < oldest.lastActiveAt) oldest = inst;
    }
    if (!oldest) return undefined;
    this.map.delete(AgentPool.id(oldest.key));
    void oldest.dispose();
    return oldest.key;
  }

  retire(instance: PooledInstance): void {
    if (instance.activeThreads === 0) {
      void instance.dispose();
      return;
    }
    this.retired.push(instance);
  }

  sweepRetired(): number {
    let swept = 0;
    for (let i = this.retired.length - 1; i >= 0; i -= 1) {
      const instance = this.retired[i]!;
      if (instance.activeThreads === 0) {
        this.retired.splice(i, 1);
        void instance.dispose();
        swept += 1;
      }
    }
    return swept;
  }

  retiredCount(): number {
    return this.retired.length;
  }

  size(): number {
    return this.map.size;
  }

  list(): PooledInstance[] {
    return [...this.map.values()];
  }
}
