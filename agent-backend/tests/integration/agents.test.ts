/**
 * agents 查询路由集成测试（T042 / US4）：
 * - 列表：结构 { agent_name, description }，description 取 SOUL.md 首行
 * - 详情：soul 全文、skills frontmatter、enabled_tools、mcp_servers（仅 name/transport，不含密钥类字段）
 * - 配置损坏（移走 SOUL.md）→ 列表排除 + 详情 404，恢复后重现
 * - select/exit 与配置校验联动（损坏配置 select → 404）
 */
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { buildServer } from '../../src/server';
import { FakeLlmProvider, simpleScript } from '../helpers/fake-llm-provider';

type AppInstance = Awaited<ReturnType<typeof buildServer>>;

function agentDir(root: string, name: string): string {
  return path.join(root, '.opt-agent', 'users', 'admin', 'agents', name);
}

function writeAgent(root: string, name: string, opts?: { soul?: string; withSkill?: boolean }): void {
  const dir = agentDir(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SOUL.md'), opts?.soul ?? `你是 ${name} 数字人。\n第二行描述。`);
  writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: ['read_file', 'calculator'] }));
  writeFileSync(
    path.join(dir, 'MCP.json'),
    JSON.stringify({
      servers: [{ name: 'erp', transport: 'http', url: 'http://erp.internal/mcp' }],
    }),
  );
  if (opts?.withSkill) {
    const skillDir = path.join(dir, 'skills', 'report');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: report\ndescription: 生成报表\n---\n正文忽略',
    );
  }
}

describe('agents 查询路由（US4）', () => {
  let root: string;
  let app: AppInstance;

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-agents-'));
    writeAgent(root, 'demo', { withSkill: true });
    writeAgent(root, 'planner');
    writeFileSync(path.join(root, 'config.yaml'), 'models:\n  - model: m1\n');
    const config = loadConfig({
      env: { DEEPSEEK_API_KEY: 'sk-x', OPT_AGENT_ROOT: path.join(root, '.opt-agent') },
      configPath: path.join(root, 'config.yaml'),
    });
    app = await buildServer({ config, llmProvider: new FakeLlmProvider(simpleScript('ok')) });
  });
  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('列表：返回全部数字人的 agent_name 与 description（SOUL 首行）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agents' });
    expect(res.statusCode).toBe(200);
    const list = res.json() as Array<{ agent_name: string; description: string }>;
    const names = list.map((a) => a.agent_name).sort();
    expect(names).toEqual(['demo', 'planner']);
    const demo = list.find((a) => a.agent_name === 'demo')!;
    expect(demo.description).toBe('你是 demo 数字人。');
  });

  it('详情：返回 soul 全文、skills、enabled_tools、mcp_servers（仅 name/transport）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agents/demo' });
    expect(res.statusCode).toBe(200);
    const detail = res.json() as Record<string, unknown>;
    expect(detail.agent_name).toBe('demo');
    expect(detail.soul).toBe('你是 demo 数字人。\n第二行描述。');
    expect(detail.skills).toEqual([{ name: 'report', description: '生成报表' }]);
    expect(detail.enabled_tools).toEqual(['read_file', 'calculator']);
    expect(detail.mcp_servers).toEqual([{ name: 'erp', transport: 'http' }]);
    // 不含密钥/连接细节类字段
    const mcp = (detail.mcp_servers as Array<Record<string, unknown>>)[0]!;
    expect(mcp.url).toBeUndefined();
    expect(mcp.command).toBeUndefined();
  });

  it('不存在的数字人详情 → 404 AGENT_NOT_FOUND', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agents/ghost' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('AGENT_NOT_FOUND');
  });

  it('配置损坏：移走 SOUL.md 后从列表消失、详情 404；恢复后重现', async () => {
    const dir = agentDir(root, 'planner');
    renameSync(path.join(dir, 'SOUL.md'), path.join(dir, 'SOUL.md.bak'));

    const list = (await app.inject({ method: 'GET', url: '/api/agents' })).json() as Array<{
      agent_name: string;
    }>;
    expect(list.map((a) => a.agent_name)).toEqual(['demo']);

    const detail = await app.inject({ method: 'GET', url: '/api/agents/planner' });
    expect(detail.statusCode).toBe(404);
    expect(detail.json().error.code).toBe('AGENT_NOT_FOUND');

    // 损坏配置不可 select
    const sel = await app.inject({ method: 'POST', url: '/api/agents/planner/select' });
    expect(sel.statusCode).toBe(404);

    renameSync(path.join(dir, 'SOUL.md.bak'), path.join(dir, 'SOUL.md'));
    const list2 = (await app.inject({ method: 'GET', url: '/api/agents' })).json() as Array<{
      agent_name: string;
    }>;
    expect(list2.map((a) => a.agent_name).sort()).toEqual(['demo', 'planner']);
  });

  it('agents 目录为空 → 列表返回空数组', async () => {
    rmSync(agentDir(root, 'demo'), { recursive: true, force: true });
    rmSync(agentDir(root, 'planner'), { recursive: true, force: true });
    const res = await app.inject({ method: 'GET', url: '/api/agents' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
