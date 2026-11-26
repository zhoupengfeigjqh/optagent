import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import type { AppContext } from '../../src/context.js';
import { agentDir, threadDir } from '../../src/domain/dirs.js';

import { buildServer } from '../../src/server';

const root = mkdtempSync(path.join(tmpdir(), 'optagent-next-actions-'));
let app: FastifyInstance;

beforeAll(async () => {
  mkdirSync(path.join(root, 'users', 'admin'), { recursive: true });
  const configPath = path.join(root, 'config.yaml');
  writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8');
  const config = loadConfig({
    env: { PUBLIC_BASE_URL: 'http://backend:3000', OPT_AGENT_ROOT: root },
    configPath,
  });
  app = await buildServer({ config });
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

function ctx(): AppContext {
  return (app as unknown as { ctx: AppContext }).ctx;
}

function writeSoul(userId: string, agentName: string, frontmatter: string): void {
  const dir = agentDir(root, userId, agentName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'SOUL.md'),
    `---\n${frontmatter}\n---\n\n## 主要使命\n\n你是助手。\n`,
    'utf8',
  );
  writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
  writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');
}

interface Action {
  prompt: string;
  tool_tips: Array<{ name: string; title: string; ontology_id: string; ontology_name: string | null }>;
}

function writeSnapshot(
  userId: string,
  threadId: string,
  agentName: string,
  actions: unknown[],
): void {
  const file = path.join(threadDir(root, userId, agentName, threadId), 'next-actions.json');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      message_id: 'm-1',
      agent_name: agentName,
      created_at: new Date().toISOString(),
      actions,
    }),
    'utf8',
  );
}

function get(threadId: string) {
  return app.inject({ method: 'GET', url: `/api/threads/${threadId}/next-actions` });
}

const ONE_ACTION = [
  {
    prompt: '按交付日期梳理这批订单的风险',
    tool_tips: [
      { name: 'QueryPurchaseRecords', title: '查询采购订单信息', ontology_id: '1', ontology_name: '采购管理' },
    ],
  },
];

describe('GET /api/threads/:id/next-actions', () => {
  it('命中：200 + message_id + actions（tool_tips 原样下发）', async () => {
    const thread = ctx().threadStore.create('admin', 'demo');
    writeSoul('admin', 'demo', 'next_action_hints: true');
    writeSnapshot('admin', thread.threadId, 'demo', ONE_ACTION);
    ctx().currentAgent.select('admin', 'demo');

    const res = await get(thread.threadId);

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json() as { message_id: string | null; actions: Action[] };
    expect(body.message_id).toBe('m-1');
    expect(body.actions).toHaveLength(1);
    expect(body.actions[0]!.prompt).toBe('按交付日期梳理这批订单的风险');
    expect(body.actions[0]!.tool_tips[0]!.name).toBe('QueryPurchaseRecords');
    expect(body.actions[0]!.tool_tips[0]!.ontology_name).toBe('采购管理');
  });

  it('009：会话不属于当前选中数字人 → 404（跨数字人不可达，与"不存在"不可区分）', async () => {
    const thread = ctx().threadStore.create('admin', 'demo');
    writeSoul('admin', 'demo', 'next_action_hints: true');
    writeSoul('admin', 'another', 'next_action_hints: true');
    writeSnapshot('admin', thread.threadId, 'demo', ONE_ACTION);

    ctx().currentAgent.select('admin', 'another');
    const crossAgent = await get(thread.threadId);
    expect(crossAgent.statusCode).toBe(404);
    expect((crossAgent.json() as { error: { code: string } }).error.code).toBe('THREAD_NOT_FOUND');

    ctx().currentAgent.select('admin', 'demo');
    expect(
      ((await (await get(thread.threadId)).json()) as { message_id: string | null }).message_id,
    ).toBe('m-1');
  });

  it('开关已关但快照仍在 → 仍下发（读取侧不再判开关；门控只在提示词装配期）', async () => {
    const thread = ctx().threadStore.create('admin', 'demo');
    writeSoul('admin', 'demo', 'intro: 没有开关键');
    writeSnapshot('admin', thread.threadId, 'demo', ONE_ACTION);
    ctx().currentAgent.select('admin', 'demo');

    const body = (await (await get(thread.threadId)).json()) as { message_id: string | null };
    expect(body.message_id).toBe('m-1');
  });

  it('无快照（新会话）→ 200 空，且不是 404/204', async () => {
    const thread = ctx().threadStore.create('admin', 'demo');
    ctx().currentAgent.select('admin', 'demo');

    const res = await get(thread.threadId);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ message_id: null, actions: [] });
  });

  it('快照损坏 → 200 空（降级不是错误态，MUST NOT 变 5xx）', async () => {
    const thread = ctx().threadStore.create('admin', 'demo');
    writeSoul('admin', 'demo', 'next_action_hints: true');
    ctx().currentAgent.select('admin', 'demo');
    const file = path.join(threadDir(root, 'admin', 'demo', thread.threadId), 'next-actions.json');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{ 半个 JSON', 'utf8');

    const res = await get(thread.threadId);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ message_id: null, actions: [] });
  });

  it('他人会话 → 404 THREAD_NOT_FOUND（与详情接口同码）', async () => {
    const other = ctx().threadStore.create('someone-else', 'demo');

    const res = await get(other.threadId);

    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('THREAD_NOT_FOUND');
  });

  it('既有会话详情接口零变更：不出现 `next_actions`，卡片与隐藏引导都不进历史（契约 §2）', async () => {
    const thread = ctx().threadStore.create('admin', 'demo');
    writeSoul('admin', 'demo', 'next_action_hints: true');
    writeSnapshot('admin', thread.threadId, 'demo', ONE_ACTION);
    ctx().currentAgent.select('admin', 'demo');

    const res = await app.inject({ method: 'GET', url: `/api/threads/${thread.threadId}` });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain('next_actions');
    expect(Array.isArray(body.messages)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('next_actions');
    expect(JSON.stringify(body)).not.toContain('guidance');
    expect(JSON.stringify(body)).not.toContain(ONE_ACTION[0]!.prompt);
  });

  it('P95 时延 ≤ 500ms（20 次，冷热各半）—— 契约 §1.4 的判定门限', async () => {
    const thread = ctx().threadStore.create('admin', 'demo');
    writeSoul('admin', 'demo', 'next_action_hints: true');
    writeSnapshot('admin', thread.threadId, 'demo', ONE_ACTION);
    ctx().currentAgent.select('admin', 'demo');

    const samples: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const started = performance.now();
      expect((await get(thread.threadId)).statusCode).toBe(200);
      samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!;

    expect(p95).toBeLessThanOrEqual(500);
  });
});
