/**
 * 集成测试：写操作留痕与日志内容的边界（任务 2026-09-16）
 *
 * 背景：逐请求访问日志关闭后，admin 侧的写操作一度只剩"部署"与"技能文件保存"
 * 有记录——"谁删了数字人""谁关了 MCP 服务"在日志里查不到。
 *
 * 这里守住四条：
 * 1. **成功的写操作**留一条 `admin.write`（含 action/target/字段名/状态/耗时/版本/req_id）；
 * 2. **被拒的写操作**（4xx）留一条 `admin.write.rejected`，**带错误码**（可与界面提示对齐）；
 * 3. **GET 不留**写操作日志（否则又变回逐请求访问日志）；
 * 4. **业务内容不进日志**——只记"改了哪些字段（键名）"，不记值（`SC-014` 口径）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, type TestFixture } from '../helpers/fixture.js';
import { multipartBody } from '../helpers/multipart.js';
import { zipFixture } from '../helpers/zip-fixture.js';

let fx: TestFixture;

type LogLine = Record<string, unknown>;

const SKILL_MD = '---\nname: pdf-parse\ndescription: 解析 PDF\n---\n\n正文\n';

function logFile(): string {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(fx.platformDataDir, 'logs', `app-${day}.log`);
}

/** 读取已落盘的日志行（最后一行可能是写了一半的，跳过） */
function readLogLines(): LogLine[] {
  const file = logFile();
  if (!fs.existsSync(file)) return [];
  const out: LogLine[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      out.push(JSON.parse(trimmed) as LogLine);
    } catch {
      /* 尾部半行：忽略 */
    }
  }
  return out;
}

/** 日志是异步落盘的，轮询等待目标行出现（避免用固定 sleep 造成偶发失败） */
async function waitForLog(
  predicate: (lines: LogLine[]) => boolean,
  timeoutMs = 2000,
): Promise<LogLine[]> {
  const deadline = Date.now() + timeoutMs;
  let lines = readLogLines();
  while (!predicate(lines) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    lines = readLogLines();
  }
  return lines;
}

interface AgentBody {
  name: string;
  soul: string;
  enabled_tools: string[];
  mcp_services: string[];
  skills: string[];
  scenario: { scenario: string; data_prep_dirs: string[] };
}

function agentBody(overrides: Partial<AgentBody> = {}): AgentBody {
  return {
    name: 'demo',
    soul: '你是助手',
    enabled_tools: [],
    mcp_services: [],
    skills: [],
    scenario: { scenario: '全量', data_prep_dirs: ['算法规则'] },
    ...overrides,
  };
}

function createAgent(overrides: Partial<AgentBody> = {}) {
  return fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: agentBody(overrides) });
}

function writeRows(lines: LogLine[], actionPart: string): LogLine[] {
  return lines.filter((line) => String(line.action ?? '').includes(actionPart));
}

beforeEach(async () => {
  fx = await createFixture();
  fx.runtime.tools = [{ name: 'read_file', label: '读取文件', description_template: 'x', parameters: {}, writable: false }];
});

afterEach(async () => {
  await fx.cleanup();
});

describe('写操作留痕（admin.write / admin.write.rejected）', () => {
  it('成功的写操作留一条 admin.write，含对象、字段名、状态、耗时、版本与 req_id', async () => {
    const res = await createAgent();
    expect(res.statusCode).toBe(201);

    const lines = await waitForLog((rows) =>
      rows.some((row) => row.event === 'admin.write' && String(row.action).includes('/agents')),
    );

    const row = writeRows(lines, '/agents').find((item) => item.event === 'admin.write');
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      event: 'admin.write',
      action: 'POST /api/admin/agents',
      method: 'POST',
      target: 'demo',
      status: 201,
      user_id: 'zyw_admin',
    });
    // 只记"改了哪些字段"的键名，不记值
    expect(row?.fields).toEqual(
      expect.arrayContaining(['name', 'soul', 'enabled_tools', 'mcp_services', 'skills', 'scenario']),
    );
    expect(typeof row?.duration_ms).toBe('number');
    expect(typeof row?.revision).toBe('number');
    expect(typeof row?.req_id).toBe('string');
    // 每行都带进程实例标识（容器里 pid 恒为 1、hostname 是容器 ID，无法区分运行）
    expect(typeof row?.instance_id).toBe('string');
  });

  it('被拒的写操作留一条 admin.write.rejected，并带错误码与对象（界面报错可直接对到日志）', async () => {
    await createAgent();
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/agents/demo',
      payload: { ...agentBody(), revision: 999 },
    });
    expect(res.statusCode).toBe(409);

    const lines = await waitForLog((rows) => rows.some((row) => row.event === 'admin.write.rejected'));
    const row = lines.find((item) => item.event === 'admin.write.rejected');
    expect(row).toMatchObject({
      event: 'admin.write.rejected',
      target: 'demo',
      status: 409,
      code: 'ADM_CONFIG_REVISION_CONFLICT',
      user_id: 'zyw_admin',
    });
    expect(String(row?.action)).toContain('PUT /api/admin/agents');
  });

  it('GET 不留写操作日志（否则等于把逐请求访问日志又打开了）', async () => {
    await fx.app.inject({ method: 'GET', url: '/api/admin/agents?page=1' });
    await clockTick();

    const rows = readLogLines().filter((row) => String(row.action ?? '').startsWith('GET '));
    expect(rows).toEqual([]);
  });

  it('业务内容不进日志：只记字段名，SOUL 正文一字不落（SC-014 口径）', async () => {
    const canary = 'CANARY-SOUL-7f31d';
    await createAgent({ soul: `你是助手 ${canary}` });
    await waitForLog((rows) => rows.some((row) => row.event === 'admin.write'));

    const raw = fs.readFileSync(logFile(), 'utf8');
    expect(raw).not.toContain(canary);
    // 但"改了 soul 这个字段"要能看出来
    const row = writeRows(readLogLines(), '/agents').find((item) => item.event === 'admin.write');
    expect(row?.fields).toEqual(expect.arrayContaining(['soul']));
  });

  it('multipart 写操作（技能安装）也能记下对象名：由路由标注补齐', async () => {
    const body = multipartBody(
      {},
      { name: 'skill-1.zip', content: zipFixture({ 'SKILL.md': SKILL_MD }) },
    );
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/skills/install',
      payload: body.payload,
      headers: body.headers,
    });
    expect(res.statusCode).toBe(201);

    const lines = await waitForLog((rows) => rows.some((row) => row.event === 'admin.write' && String(row.action).includes('skills/install')));
    const row = lines.find((item) => String(item.action ?? '').includes('skills/install'));
    expect(row).toMatchObject({
      event: 'admin.write',
      target: 'pdf-parse',
      source: 'skill-1.zip',
      overwritten: false,
      status: 201,
    });
  });
});

/** 等一小会儿，用于确认"没有新日志产生"这类否定断言 */
async function clockTick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 60));
}
