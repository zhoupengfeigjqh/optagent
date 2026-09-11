import { describe, expect, it } from 'vitest';
import { AgentPool, PoolExhaustedError, type PooledInstance } from '../../src/domain/agent-pool';

const inst = (
  userId: string,
  agentName: string,
  over: Partial<PooledInstance> = {},
): PooledInstance => ({
  key: { userId, agentName },
  activeThreads: 0,
  lastActiveAt: 0,
  dispose: () => {},
  ...over,
});

describe('AgentPool', () => {
  it('put/get/list/size 基本行为，get 刷新 lastActiveAt', () => {
    let now = 1000;
    const pool = new AgentPool({ maxSize: 3, now: () => now });
    const a = inst('admin', 'a');
    pool.put(a);
    now = 2000;
    expect(pool.get({ userId: 'admin', agentName: 'a' })).toBe(a);
    expect(a.lastActiveAt).toBe(2000);
    expect(pool.size()).toBe(1);
    expect(pool.list()).toEqual([a]);
  });

  it('LRU 淘汰最久未用的空闲实例', () => {
    let now = 0;
    const pool = new AgentPool({ maxSize: 2, now: () => now });
    const a = inst('admin', 'a');
    const b = inst('admin', 'b');
    now = 1;
    pool.put(a);
    now = 2;
    pool.put(b);
    now = 3;
    pool.put(inst('admin', 'c')); // 池满 → 淘汰 a
    expect(pool.get({ userId: 'admin', agentName: 'a' })).toBeUndefined();
    expect(pool.size()).toBe(2);
  });

  it('忙碌实例豁免 LRU；全部忙碌且池满 → POOL_EXHAUSTED', () => {
    const pool = new AgentPool({ maxSize: 2 });
    const busy1 = inst('admin', 'b1', { activeThreads: 1 });
    const busy2 = inst('admin', 'b2', { activeThreads: 2 });
    const idle = inst('admin', 'idle');
    pool.put(busy1);
    pool.put(busy2);
    // 池满无空闲 → 拒绝
    expect(() => pool.put(idle)).toThrow(PoolExhaustedError);
    // 腾出一个空闲后：淘汰空闲而非忙碌
    pool.put(inst('admin', 'b1', { activeThreads: 0, lastActiveAt: 0 }));
    expect(pool.size()).toBe(2);
  });

  it('evictIdle 仅回收超时空闲实例', () => {
    let now = 0;
    const pool = new AgentPool({ maxSize: 5, now: () => now });
    pool.put(inst('admin', 'old-idle'));
    pool.put(inst('admin', 'old-busy', { activeThreads: 1 }));
    now = 11 * 60 * 1000;
    pool.put(inst('admin', 'fresh')); // lastActiveAt = now
    const evicted = pool.evictIdle(10 * 60 * 1000);
    expect(evicted).toEqual([{ userId: 'admin', agentName: 'old-idle' }]);
    expect(pool.size()).toBe(2);
  });

  it('remove 调用 dispose', () => {
    const pool = new AgentPool({ maxSize: 5 });
    let disposed = false;
    pool.put(inst('admin', 'x', { dispose: () => (disposed = true) }));
    pool.remove({ userId: 'admin', agentName: 'x' });
    expect(disposed).toBe(true);
    expect(pool.size()).toBe(0);
  });
});
