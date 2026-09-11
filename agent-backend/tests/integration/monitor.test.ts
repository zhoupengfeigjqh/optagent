/**
 * monitor / usage 路由集成测试（T046 / US5）：
 * - GET /api/monitor/health：uptime / RSS / 磁盘可用空间
 * - GET /api/monitor/agents：池明细（user/agent/活跃 thread/空闲秒数/unavailable_mcp）
 * - GET /api/usage/summary：过滤 + total/grouped 汇总（snake_case 契约）
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import type { AppContext } from '../../src/context';
import { buildServer } from '../../src/server';
import { FakeLlmProvider, simpleScript } from '../helpers/fake-llm-provider';

type AppInstance = Awaited<ReturnType<typeof buildServer>>;

function writeAgent(root: string, name: string, mcpServers: unknown[] = []): void {
  const dir = path.join(root, '.opt-agent', 'users', 'admin', 'agents', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SOUL.md'), `你是 ${name} 数字人。`);
  writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }));
  writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: mcpServers }));
}

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitFor 超时');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('monitor / usage 路由（US5）', () => {
  let root: string;
  let app: AppInstance;
  let ctx: AppContext;

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-monitor-'));
    // demo 配一个必然连不上的 MCP server（连接拒绝，快速失败）
    writeAgent(root, 'demo', [{ name: 'dead', transport: 'http', url: 'http://127.0.0.1:1/mcp' }]);
    writeAgent(root, 'idle-agent');
    writeFileSync(path.join(root, 'config.yaml'), 'models:\n  - model: m1\n');
    const config = loadConfig({
      env: {
        DEEPSEEK_API_KEY: 'sk-x',
        OPT_AGENT_ROOT: path.join(root, '.opt-agent'),
        MCP_TIMEOUT_MS: '1000',
      },
      configPath: path.join(root, 'config.yaml'),
    });
    app = await buildServer({ config, llmProvider: new FakeLlmProvider(simpleScript('ok')) });
    ctx = (app as unknown as { ctx: AppContext }).ctx;
  });
  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('health：含 uptime / memory_rss_bytes / disk_free_bytes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/monitor/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(body.memory_rss_bytes).toBeGreaterThan(0);
    expect(body.disk_free_bytes).toBeGreaterThan(0);
  });

  it('monitor/agents：空池 → alive 0 + max；建实例后明细含 unavailable_mcp', async () => {
    const empty = (await app.inject({ method: 'GET', url: '/api/monitor/agents' })).json();
    expect(empty).toEqual({ alive: 0, max: ctx.config.poolSize, instances: [] });

    // 发一条消息让 demo 实例入池
    await app.inject({ method: 'POST', url: '/api/agents/demo/select' });
    const t = (
      await app.inject({ method: 'POST', url: '/api/threads', payload: { agent_name: 'demo' } })
    ).json().thread_id as string;
    const msg = await app.inject({
      method: 'POST',
      url: `/api/threads/${t}/messages`,
      payload: { content: 'hi' },
    });
    expect(msg.statusCode).toBe(200);

    // MCP 建连异步失败 → 等 unavailable 标记出现；run.settled 后 activeThreads 归零
    await waitFor(() => {
      const inst = ctx.pool.list().find((i) => i.key.agentName === 'demo');
      const mcp = (inst as { unavailableMcp?: () => string[] } | undefined)?.unavailableMcp?.() ?? [];
      return mcp.includes('dead') && inst?.activeThreads === 0;
    });

    const res = await app.inject({ method: 'GET', url: '/api/monitor/agents' });
    const body = res.json();
    expect(body.alive).toBe(1);
    const inst = body.instances[0];
    expect(inst.user_id).toBe('admin');
    expect(inst.agent_name).toBe('demo');
    expect(inst.active_threads).toBe(0); // run 已结束
    expect(inst.idle_seconds).toBeGreaterThanOrEqual(0);
    expect(inst.unavailable_mcp).toEqual(['dead']);
  });

  it('usage/summary：无过滤返回 total + grouped；过滤后仅命中子集', async () => {
    const base = { userId: 'admin', threadId: 't1', agentName: 'demo', inputTokens: 10, outputTokens: 20, createdAt: '2026-09-09T10:00:00.000Z' };
    ctx.usage.record(base);
    ctx.usage.record({ ...base, inputTokens: 5, outputTokens: 7 });
    ctx.usage.record({ ...base, threadId: 't2', agentName: 'idle-agent', inputTokens: 100, outputTokens: 1 });

    const all = (await app.inject({ method: 'GET', url: '/api/usage/summary' })).json();
    expect(all.total_input_tokens).toBe(115);
    expect(all.total_output_tokens).toBe(28);
    expect(all.records).toBe(3);
    expect(all.grouped).toHaveLength(2);
    const g1 = all.grouped.find((g: { thread_id: string }) => g.thread_id === 't1');
    expect(g1).toMatchObject({ agent_name: 'demo', input_tokens: 15, output_tokens: 27 });

    const filtered = (
      await app.inject({ method: 'GET', url: '/api/usage/summary?agent_name=demo&thread_id=t1' })
    ).json();
    expect(filtered.records).toBe(2);
    expect(filtered.total_input_tokens).toBe(15);

    const byTime = (
      await app.inject({ method: 'GET', url: '/api/usage/summary?from=2026-09-10' })
    ).json();
    expect(byTime.records).toBe(0);
  });
});
