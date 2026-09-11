/**
 * 002 US4 当前数字人查询 + MCP 服务状态集成测试（T018）：
 * 未选中 agent_name=null；选中后返回；MCP 清单全列（无实例时 status=failed）；
 * 有实例时按 unavailableMcp 映射 connected/failed。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { buildServer } from '../../src/server';
import type { LlmChatRequest, LlmProvider } from '../../src/infra/llm/llm-provider';
import type { LlmEvent } from '../../src/types';
import { FakeLlmProvider, simpleScript, type FakeStep } from '../helpers/fake-llm-provider';

type AppInstance = Awaited<ReturnType<typeof buildServer>>;

class QueueProvider implements LlmProvider {
  private readonly queue: FakeStep[][] = [];
  push(s: FakeStep[]): void {
    this.queue.push(s);
  }
  async *streamChat(req: LlmChatRequest): AsyncIterable<LlmEvent> {
    const f = new FakeLlmProvider(this.queue.shift() ?? simpleScript('默认'));
    yield* f.streamChat(req);
  }
}

function writeAgent(root: string, name: string, mcpServers: unknown[] = []): void {
  const dir = path.join(root, '.opt-agent', 'users', 'admin', 'agents', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SOUL.md'), `你是 ${name}。`);
  writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }));
  writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: mcpServers }));
}

describe('当前数字人与 MCP 状态（002 US4 / T018）', () => {
  let root: string;
  let provider: QueueProvider;
  let app: AppInstance;

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-cur-'));
    writeAgent(root, 'demo', [
      { name: 'erp', transport: 'http', url: 'http://localhost:9999/mcp' },
      { name: 'mes', transport: 'stdio', command: 'mes-server' },
    ]);
    writeAgent(root, 'other');
    const configPath = path.join(root, 'config.yaml');
    writeFileSync(configPath, 'models:\n  - model: m1\n');
    const config = loadConfig({
      env: { DEEPSEEK_API_KEY: 'sk-x', OPT_AGENT_ROOT: path.join(root, '.opt-agent') },
      configPath,
    });
    provider = new QueueProvider();
    app = await buildServer({ config, llmProvider: provider });
  });
  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('未选中 → agent_name: null；mcp_servers 为空数组', async () => {
    const cur = await app.inject({ method: 'GET', url: '/api/agents/current' });
    expect(cur.json()).toEqual({ agent_name: null });

    const mcp = await app.inject({ method: 'GET', url: '/api/agents/current/mcp' });
    expect(mcp.json()).toEqual({ agent_name: null, mcp_servers: [] });
  });

  it('选中后 GET /api/agents/current 返回 agent_name；MCP 全列、实例未创建时 status=failed', async () => {
    await app.inject({ method: 'POST', url: '/api/agents/demo/select' });

    const cur = await app.inject({ method: 'GET', url: '/api/agents/current' });
    expect(cur.json()).toEqual({ agent_name: 'demo' });

    const mcp = await app.inject({ method: 'GET', url: '/api/agents/current/mcp' });
    const body = mcp.json();
    expect(body.agent_name).toBe('demo');
    expect(body.mcp_servers).toHaveLength(2);
    expect(body.mcp_servers).toEqual([
      { name: 'erp', transport: 'http', status: 'failed' },
      { name: 'mes', transport: 'stdio', status: 'failed' },
    ]);
  });

  it('实例创建后（发消息触发）MCP 状态按 unavailableMcp 映射为 connected/failed', async () => {
    await app.inject({ method: 'POST', url: '/api/agents/demo/select' });
    const tid = (
      await app.inject({ method: 'POST', url: '/api/threads', payload: { agent_name: 'demo' } })
    ).json().thread_id as string;
    provider.push(simpleScript('好'));
    await app.inject({ method: 'POST', url: `/api/threads/${tid}/messages`, payload: { content: 'hi' } });

    const mcp = await app.inject({ method: 'GET', url: '/api/agents/current/mcp' });
    const body = mcp.json();
    expect(body.mcp_servers).toHaveLength(2);
    // demo 的 MCP 都不可达（假地址/命令），全部 failed
    for (const s of body.mcp_servers as Array<{ status: string }>) {
      expect(['connected', 'failed']).toContain(s.status);
    }
  });

  it('exit 后 current → null，mcp_servers 清空', async () => {
    await app.inject({ method: 'POST', url: '/api/agents/demo/select' });
    await app.inject({ method: 'POST', url: '/api/agents/current/exit' });

    const cur = await app.inject({ method: 'GET', url: '/api/agents/current' });
    expect(cur.json()).toEqual({ agent_name: null });
    const mcp = await app.inject({ method: 'GET', url: '/api/agents/current/mcp' });
    expect(mcp.json()).toEqual({ agent_name: null, mcp_servers: [] });
  });

  it('会话进行中可直接覆盖式切换（无需先 exit），且不影响进行中的 run', async () => {
    await app.inject({ method: 'POST', url: '/api/agents/demo/select' });
    const tid = (
      await app.inject({ method: 'POST', url: '/api/threads', payload: { agent_name: 'demo' } })
    ).json().thread_id as string;
    // 制造进行中的 run
    provider.push([{ type: 'wait', id: 'hold' }]);
    const p1 = app.inject({ method: 'POST', url: `/api/threads/${tid}/messages`, payload: { content: 'hi' } });
    // 等 run 激活
    await new Promise((r) => setTimeout(r, 100));

    // 覆盖式选中：不再要求先 exit；进行中限制仅为前端体验约束（后端不拦截）
    const res = await app.inject({ method: 'POST', url: '/api/agents/other/select' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ agent_name: 'other', selected: true });
    expect((await app.inject({ method: 'GET', url: '/api/agents/current' })).json()).toEqual({
      agent_name: 'other',
    });

    // 进行中的 run 不受切换影响，照常收尾
    await app.inject({ method: 'POST', url: `/api/threads/${tid}/stop` });
    expect((await p1).statusCode).toBe(200);
  });
});
