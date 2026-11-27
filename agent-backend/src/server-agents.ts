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

export function createAgentProvider(opts: AgentProviderOptions): (key: PoolKey) => Promise<ChatAgent> {
  const { root, pool, factory } = opts;
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
      if (creating.get(flightId) === creatingNow) creating.delete(flightId);
    }
  };
}
