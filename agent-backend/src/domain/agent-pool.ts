/**
 * Agent 实例池（PoolStore 内存实现）。
 *
 * - key = (user_id, agent_name)
 * - LRU 仅淘汰空闲实例（activeThreads === 0）
 * - 池满且无空闲可淘汰 → PoolExhaustedError（上层映射 409 POOL_EXHAUSTED）
 * - evictIdle 供定时任务回收空闲超时实例
 */
import type { PoolKey } from '../types.js';

export class PoolExhaustedError extends Error {
  readonly code = 'POOL_EXHAUSTED';
  constructor(message: string) {
    super(message);
    this.name = 'PoolExhaustedError';
  }
}

/** 池化实例的最小契约（完整 AgentInstance 在 agent-instance.ts，T020） */
export interface PooledInstance {
  readonly key: PoolKey;
  /** 进行中的 run 数；0 视为空闲 */
  activeThreads: number;
  lastActiveAt: number; // epoch ms
  /** 回收时释放资源（关闭 MCP 连接等） */
  dispose(): Promise<void> | void;
}

export interface AgentPoolOptions {
  maxSize: number;
  /** 注入时钟便于测试 */
  now?: () => number;
}

export class AgentPool {
  private readonly map = new Map<string, PooledInstance>();
  /**
   * **退休实例**：因配置变化被换下、但**仍有进行中的轮次**的实例。
   *
   * `FR-034` 要求"新对话立即生效"与"进行中的回答不中断"**同时成立**——
   * 因此这类实例 MUST NOT 被立即销毁，而是等其轮次结束（`activeThreads` 归零）
   * 后由 `sweepRetired()` 回收。若换代时它已空闲，则直接销毁，不入退休表。
   */
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

  /** 入池；池满时先尝试淘汰最久未用的空闲实例，无可淘汰则抛 PoolExhaustedError */
  put(instance: PooledInstance): void {
    const id = AgentPool.id(instance.key);
    if (this.map.has(id)) {
      this.map.set(id, instance);
      return;
    }
    if (this.map.size >= this.maxSize) {
      const evicted = this.lruEvictOne();
      if (!evicted) {
        throw new PoolExhaustedError(
          `实例池已满（${this.maxSize}）且无空闲实例可淘汰，请稍后再试`,
        );
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

  /** LRU：淘汰最久未用的空闲实例；无空闲实例返回 undefined */
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

  /**
   * 把被换下的实例转入退休表（不立即销毁）。
   * 已空闲则直接销毁——没有需要保护的在途轮次。
   */
  retire(instance: PooledInstance): void {
    if (instance.activeThreads === 0) {
      void instance.dispose();
      return;
    }
    this.retired.push(instance);
  }

  /** 回收已完成全部轮次的退休实例，返回回收数量 */
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
