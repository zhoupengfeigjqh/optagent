/**
 * 集成测试：MCP 预热端点（2026-10-18）。
 *
 * 背景：实例是**惰性创建**的（只有发消息才建），而状态端点只读池 —— 于是新登录 /
 * 切换数字人后状态恒为 `unknown`（界面上的灰），此前唯一能变绿的方式就是发一轮对话。
 *
 * 本文件钉住预热端点的四条契约：
 * 1. 未选中 → 与 GET 同形的空快照（不建实例、不报错）；
 * 2. 未预热 → GET 仍只读（仍是 unknown，不因查询而建实例）；
 * 3. 预热 → 实例入池，且**返回时已有连接结果**（此处用不可达地址 ⇒ failed，不是 unknown）；
 * 4. 幂等 → 重复预热命中同一实例（不重复建连）。
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
import { agentDir } from '../../src/domain/dirs.js';
import type { ChatAgent } from '../../src/infra/agent-factory.js';
import { buildServer } from '../../src/server';

const root = mkdtempSync(path.join(tmpdir(), 'optagent-mcp-warm-'));
const USER = 'admin';
const AGENT = '预热数字人';

let app: FastifyInstance;

interface McpSnapshot {
  agent_name: string | null;
  mcp_servers: Array<{ name: string; transport: string; status: string }>;
}

/**
 * 写一份挂载"不可达 MCP 服务"的数字人配置。
 *
 * 用 127.0.0.1:1（必然 ECONNREFUSED）而不是挂起地址：本用例要验的是"预热后**有结果**"，
 * 失败（failed）也是结果；挂起地址会让用例依赖建连超时才结束。
 */
function writeAgent(name: string): void {
  const dir = agentDir(root, USER, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SOUL.md'), '你是助手。\n', 'utf8');
  writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
  writeFileSync(
    path.join(dir, 'MCP.json'),
    JSON.stringify({
      servers: [{ name: 'dead', transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp' }],
    }),
    'utf8',
  );
}

function ctx(): AppContext {
  return (app as unknown as { ctx: AppContext }).ctx;
}

const warm = () => app.inject({ method: 'POST', url: '/api/agents/current/mcp/warm' });
const readMcp = () => app.inject({ method: 'GET', url: '/api/agents/current/mcp' });
const select = (name: string) =>
  app.inject({ method: 'POST', url: `/api/agents/${encodeURIComponent(name)}/select` });

/** 池内该数字人的实例（预热是否真的建了实例） */
function pooled(): ChatAgent | undefined {
  const selected = ctx().currentAgent.current(USER);
  if (!selected) return undefined;
  return ctx().pool.get(selected) as ChatAgent | undefined;
}

beforeAll(async () => {
  mkdirSync(path.join(root, 'users', USER), { recursive: true });
  const configPath = path.join(root, 'config.yaml');
  writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8');
  const config = loadConfig({
    env: { PUBLIC_BASE_URL: 'http://backend:3000', OPT_AGENT_ROOT: root },
    configPath,
  });
  app = await buildServer({ config });
  writeAgent(AGENT);
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('POST /api/agents/current/mcp/warm —— 显式唤醒 MCP 建连', () => {
  it('未选中：返回与 GET 同形的空快照（不建实例、不报错）', async () => {
    const res = await warm();

    expect(res.statusCode).toBe(200);
    expect(res.json() as McpSnapshot).toEqual({ agent_name: null, mcp_servers: [] });
  });

  it('未预热：GET 仍是 unknown（只读，不因查询而建实例）', async () => {
    expect((await select(AGENT)).statusCode).toBe(200);
    expect(pooled()).toBeUndefined();

    const res = await readMcp();

    expect(res.statusCode).toBe(200);
    const body = res.json() as McpSnapshot;
    expect(body.agent_name).toBe(AGENT);
    expect(body.mcp_servers.map((s) => s.status)).toEqual(['unknown']);
    expect(pooled()).toBeUndefined(); // 关键：观测不产生副作用
  });

  it('预热：实例入池，且返回时已有连接结果（不再是灰色 unknown）', async () => {
    const res = await warm();

    expect(res.statusCode).toBe(200);
    const body = res.json() as McpSnapshot;
    expect(body.agent_name).toBe(AGENT);
    expect(body.mcp_servers).toHaveLength(1);
    // 不可达服务 = failed（"有结果"）；重点是**不是 unknown**
    expect(body.mcp_servers[0]?.status).toBe('failed');
    expect(pooled()).toBeDefined();
  });

  it('幂等：重复预热命中同一实例，不重复建连', async () => {
    const before = pooled();
    expect(before).toBeDefined();

    const res = await warm();

    expect(res.statusCode).toBe(200);
    expect(pooled()).toBe(before);
    expect((res.json() as McpSnapshot).mcp_servers[0]?.status).toBe('failed');
  });

  it('预热后 GET 与 POST 返回同一份结果（两个入口不各说一套）', async () => {
    const posted = (await warm()).json() as McpSnapshot;
    const got = (await readMcp()).json() as McpSnapshot;

    expect(got).toEqual(posted);
  });
});
