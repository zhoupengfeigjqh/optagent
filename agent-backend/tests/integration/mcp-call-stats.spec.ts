import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config';
import type { AppContext } from '../../src/context';
import { buildServer } from '../../src/server';

const root = mkdtempSync(path.join(tmpdir(), 'optagent-mcp-stats-'));

interface StatsWindow {
  ok: number;
  failed: number;
  total: number;
}

interface StatsGroupItem {
  service: string;
  tool_name: string | null;
  user_id: string | null;
  calls_total: number;
  calls_ok: number;
  calls_failed: number;
  last_called_at: string | null;
  windows: { h24: StatsWindow; d7: StatsWindow; d30: StatsWindow; d365: StatsWindow };
}

interface StatsItem {
  name: string;
  calls_total: number;
  calls_ok: number;
  calls_failed: number;
  last_called_at: string | null;
}

let app: FastifyInstance;
let ctx: AppContext;

beforeAll(async () => {
  mkdirSync(path.join(root, 'users', 'admin'), { recursive: true });
  const configPath = path.join(root, 'config.yaml');
  writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8');
  const config = loadConfig({
    env: { PUBLIC_BASE_URL: 'http://backend:3000', OPT_AGENT_ROOT: root },
    configPath,
  });
  app = await buildServer({ config });
  ctx = (app as unknown as { ctx: AppContext }).ctx;
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

interface StatsBody {
  stats_available: boolean;
  items: StatsItem[];
  groups: StatsGroupItem[];
}

async function stats(): Promise<StatsBody> {
  const res = await app.inject({ method: 'GET', url: '/api/mcp-call-stats' });
  expect(res.statusCode).toBe(200);
  return res.json() as StatsBody;
}

describe('GET /api/mcp-call-stats', () => {
  it('初始：统计可用但没有服务出现过 → items 为空', async () => {
    const body = await stats();
    expect(body.stats_available).toBe(true);
    expect(body.items).toEqual([]);
  });

  it('未出现过的服务不出现于 items（平台侧以 0 呈现）', async () => {
    ctx.usage.recordMcpCall({ service: 'ocr', tool: 'ocr_image', ok: true, durationMs: 10 });
    const body = await stats();
    expect(body.items.map((i) => i.name)).toEqual(['ocr']);
    expect(body.items.find((i) => i.name === 'never-called')).toBeUndefined();
  });

  it('计数随调用递增，成功/失败分列，calls_total 为二者之和', async () => {
    ctx.usage.recordMcpCall({ service: 'ocr', tool: 'ocr_image', ok: true, durationMs: 10 });
    ctx.usage.recordMcpCall({ service: 'ocr', tool: 'ocr_image', ok: true, durationMs: 20 });
    ctx.usage.recordMcpCall({
      service: 'ocr',
      tool: 'ocr_image',
      ok: false,
      durationMs: 30,
      errorKind: 'protocol',
    });

    const item = (await stats()).items.find((i) => i.name === 'ocr')!;
    expect(item.calls_ok).toBe(3);
    expect(item.calls_failed).toBe(1);
    expect(item.calls_total).toBe(4);
  });

  it('last_called_at 为 ISO8601 且随调用更新', async () => {
    const before = (await stats()).items.find((i) => i.name === 'ocr')!.last_called_at;
    expect(before).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    ctx.usage.recordMcpCall({ service: 'ocr', tool: 'ocr_image', ok: true, durationMs: 10 });
    const after = (await stats()).items.find((i) => i.name === 'ocr')!.last_called_at;
    expect(after).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(new Date(after!).getTime()).toBeGreaterThanOrEqual(new Date(before!).getTime());
  });

  it('多服务各自独立统计，按服务名排序', async () => {
    ctx.usage.recordMcpCall({ service: 'zzz', tool: 'z_tool', ok: true, durationMs: 10 });
    ctx.usage.recordMcpCall({
      service: 'aaa',
      tool: 'a_tool',
      ok: false,
      durationMs: 10,
      errorKind: 'transport',
    });
    const names = (await stats()).items.map((i) => i.name);
    expect(names).toEqual([...names].sort());
    expect(names).toContain('ocr');
  });

  it('分组行：按「服务 × 工具 × 用户」成行，带四个时间窗（2026-09-23）', async () => {
    ctx.usage.recordMcpCall({ service: 'ocr', tool: 'ocr_pdf', ok: true, durationMs: 10 });

    const body = await stats();
    const rows = body.groups.filter((group) => group.service === 'ocr');
    const byTool = new Map(rows.map((group) => [group.tool_name, group]));
    expect(byTool.get('ocr_pdf')).toMatchObject({
      service: 'ocr',
      user_id: null,
      calls_ok: 1,
      calls_failed: 0,
      calls_total: 1,
    });
    expect(byTool.get('ocr_image')).toMatchObject({ calls_failed: 1 });
    expect(byTool.get('ocr_pdf')!.windows.h24).toEqual({ ok: 1, failed: 0, total: 1 });
    expect(byTool.get('ocr_pdf')!.last_called_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const item = body.items.find((i) => i.name === 'ocr')!;
    const sum = rows.reduce((acc, group) => acc + group.calls_total, 0);
    expect(item.calls_total).toBe(sum);
  });

  it('只读端点：重复调用不改变统计', async () => {
    const first = await stats();
    const second = await stats();
    expect(second).toEqual(first);
  });

  it('统计存储不可读 → stats_available=false（**不以 0 冒充**，FR-009）', async () => {
    const usage = ctx.usage as unknown as { mcpCallStats: () => unknown };
    const original = usage.mcpCallStats;
    usage.mcpCallStats = () => {
      throw new Error('db is gone');
    };
    try {
      const body = await stats();
      expect(body.stats_available).toBe(false);
      expect(body.items).toEqual([]);
      expect(body.groups).toEqual([]);
    } finally {
      usage.mcpCallStats = original;
    }
  });
});
