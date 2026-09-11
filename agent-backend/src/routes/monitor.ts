/**
 * 运维监控路由（US5 / T047，内网只读）。
 *
 * - GET /api/monitor/agents — 实例池明细：user/agent/活跃 thread 数/空闲秒数/unavailable_mcp
 * - GET /api/monitor/health — uptime / RSS / .opt-agent 所在磁盘可用空间
 */
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

export function registerMonitorRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/monitor/agents', async () => {
    const now = Date.now();
    const instances = ctx.pool.list().map((inst) => {
      // PooledInstance 最小契约之外的能力按存在性探测（测试池可注入裸对象）
      const maybeMcp = inst as { unavailableMcp?: () => string[] };
      return {
        user_id: inst.key.userId,
        agent_name: inst.key.agentName,
        active_threads: inst.activeThreads,
        idle_seconds: Math.max(0, Math.floor((now - inst.lastActiveAt) / 1000)),
        unavailable_mcp: typeof maybeMcp.unavailableMcp === 'function' ? maybeMcp.unavailableMcp() : [],
      };
    });
    return { alive: instances.length, max: ctx.config.poolSize, instances };
  });

  app.get('/api/monitor/health', async () => ({
    status: 'ok',
    uptime_seconds: Math.floor(process.uptime()),
    memory_rss_bytes: process.memoryUsage().rss,
    disk_free_bytes: diskFreeBytes(ctx.config.optAgentRoot),
  }));
}

/** .opt-agent 所在卷的可用字节数；statfs 不可用时降级为 0 并继续 */
function diskFreeBytes(root: string): number {
  try {
    const s = fs.statfsSync(root);
    return Number(s.bfree) * Number(s.bsize);
  } catch {
    return 0;
  }
}
