/**
 * 实例取用口（池命中 / 单飞 / 配置换代）——从 `server.ts` 抽出（宪章原则二：≤500 行）。
 *
 * 三条既有语义原样搬运，不在这里改变行为：
 * 1. **池命中 + 指纹比对**（R7 / `FR-034`）：配置未变 → 复用同一实例；
 *    已变 → 换代（空闲立即销毁，有在途轮次的转入退休表，回答不中断）。
 * 2. **在途创建单飞**（2026-10-18）：同一 `(userId, agentName)` 并发取用只创建一次，
 *    否则预热端点与发消息会各建一套 `McpManager`，被覆盖那套的连接/子进程无人关闭。
 * 3. 入池失败（池满）时先销毁刚建好的实例，避免泄漏。
 *
 * 抽出的直接原因：`server.ts` 已贴近 500 行硬门禁，而 015 还要在里面加装配与路由注册。
 */
import path from 'node:path';
import type { AgentPool } from './domain/agent-pool.js';
import { computeConfigFingerprint } from './domain/config-fingerprint.js';
import { userAgentsDir } from './domain/dirs.js';
import type { AgentInstanceFactory, ChatAgent } from './infra/agent-factory.js';
import type { PoolKey } from './types.js';

export interface AgentProviderOptions {
  root: string;
  pool: AgentPool;
  factory: AgentInstanceFactory;
}

/** 返回"取实例"函数：命中返回缓存实例，未命中装配新实例入池（池满抛 `PoolExhaustedError`） */
export function createAgentProvider(opts: AgentProviderOptions): (key: PoolKey) => Promise<ChatAgent> {
  const { root, pool, factory } = opts;
  /** 在途创建表：键与 `AgentPool` 同口径（`userId\0agentName`） */
  const creating = new Map<string, Promise<ChatAgent>>();

  return async (key: PoolKey): Promise<ChatAgent> => {
    const existing = pool.get(key);
    if (existing) {
      const current = existing as unknown as ChatAgent;
      const diskFingerprint = computeConfigFingerprint(
        path.join(userAgentsDir(root, key.userId), key.agentName),
      );
      if (current.configFingerprint === diskFingerprint) return current;
      pool.retire(current);
    }
    const flightId = `${key.userId}\u0000${key.agentName}`;
    const inflight = creating.get(flightId);
    if (inflight) return inflight;
    const creatingNow = (async (): Promise<ChatAgent> => {
      const instance = await factory.create(key);
      try {
        pool.put(instance);
      } catch (err) {
        await instance.dispose();
        throw err;
      }
      return instance;
    })();
    creating.set(flightId, creatingNow);
    try {
      return await creatingNow;
    } finally {
      // 只在仍是自己时删除：换代期间可能有新的在途创建覆盖本表项
      if (creating.get(flightId) === creatingNow) creating.delete(flightId);
    }
  };
}
