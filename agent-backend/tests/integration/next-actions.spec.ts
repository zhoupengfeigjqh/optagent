/**
 * 集成测试：`GET /api/threads/:id/next-actions`（007，契约 `../contracts/next-actions-api.md` §1）
 *
 * 端点只做两件事：会话归属校验（404）→ 读快照下发。这里逐条钉住契约的
 * 200 空态与 404，并守住"空态不是错误态"（MUST NOT 变 5xx）：
 *
 * - 无快照（新会话 / 0 条 / 失败轮 / 中断轮）→ 200 空；
 * - 快照损坏 / 超限 → 200 空 + 告警（不 5xx）；
 * - 他人会话 → 404 `THREAD_NOT_FOUND`；
 * - 修订 G4：**读取不再判开关与"当前选中数字人"**（旧双判据已废除）——生成侧由
 *   提示词装配期的开关门控，快照在即下发，切换数字人后卡片不消失。
 *
 * 快照直接按落盘格式写入（端点只读不写），故本文件不需要假模型：
 * 生成侧的行为在 `tests/unit/next-actions.spec.ts` 已单独覆盖。
 *
 * 运行方式（本地执行）：npm run test:integration
 */
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

/**
 * 给数字人写一份 SOUL.md（frontmatter 供开关读取）+ 最小可加载的 TOOL/MCP。
 *
 * 009 起数据接口先做**可用性判定**（`resolveAgentScope` → `loadAgentConfig`），
 * 缺 TOOL.json / MCP.json 的数字人会被判"不可用"（409 AGENT_NOT_AVAILABLE），
 * 因此夹具必须是一份完整可加载的配置。
 */
function writeSoul(userId: string, agentName: string, frontmatter: string): void {
  const dir = agentDir(root, userId, agentName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SOUL.md'), `---\n${frontmatter}\n---\n\n## 主要使命\n\n你是助手。\n`, 'utf8');
  writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
  writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');
}

interface Action {
  prompt: string;
  tools: Array<{ kind: string; name: string; service?: string; exposed_name: string }>;
  guidance: string;
}

/** 按落盘格式写一份快照 */
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
    tools: [{ kind: 'mcp', service: 'erp', name: 'query_order' }],
    guidance: '本轮请优先使用以下工具完成任务：erp__query_order',
  },
];

describe('GET /api/threads/:id/next-actions', () => {
  it('命中：200 + message_id + actions（tools 带 exposed_name，guidance 始终出现）', async () => {
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
    expect(body.actions[0]!.tools[0]!.exposed_name).toBe('erp__query_order');
    expect(body.actions[0]!.guidance).toContain('erp__query_order');
  });

  it('009：会话不属于当前选中数字人 → 404（跨数字人不可达，与"不存在"不可区分）', async () => {
    const thread = ctx().threadStore.create('admin', 'demo');
    writeSoul('admin', 'demo', 'next_action_hints: true');
    writeSoul('admin', 'another', 'next_action_hints: true');
    writeSnapshot('admin', thread.threadId, 'demo', ONE_ACTION);

    // 切到另一个数字人：它的数据域里没有这个会话（卡片取不到、存在性也不泄漏）
    ctx().currentAgent.select('admin', 'another');
    const crossAgent = await get(thread.threadId);
    expect(crossAgent.statusCode).toBe(404);
    expect((crossAgent.json() as { error: { code: string } }).error.code).toBe('THREAD_NOT_FOUND');

    // 切回来即可见：归属由目录承载，不随选中态改写
    ctx().currentAgent.select('admin', 'demo');
    expect(((await (await get(thread.threadId)).json()) as { message_id: string | null }).message_id).toBe('m-1');
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
    // 详情接口的既有形状不变（消息列表仍在），且不泄漏卡片内容与隐藏引导
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
