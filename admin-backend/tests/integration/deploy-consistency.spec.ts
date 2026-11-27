import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, snapshotTree, type TestFixture } from '../helpers/fixture.js';
import { soulDesign } from '../helpers/soul.js';

let fx: TestFixture;

const TOOL_FIXTURE = [
  {
    name: 'read_file',
    label: '读取文件',
    description_template: '如 "{示例路径}"',
    parameters: { type: 'object' },
    writable: false,
  },
];

beforeEach(async () => {
  fx = await createFixture({ userIds: ['admin', 'ops'], mcpServices: { ocr: {} } });
  fx.runtime.tools = TOOL_FIXTURE;
  const created = await fx.app.inject({
    method: 'POST',
    url: '/api/admin/agents',
    payload: {
      name: 'demo',
      soul: soulDesign('你是一名生产计划助手。'),
      enabled_tools: ['read_file'],
      mcp_services: ['ocr'],
      skills: [],
      scenario: { scenario: '生产', data_prep_dirs: ['生产计划', '算法规则'] },
    },
  });
  if (created.statusCode !== 201) throw new Error(`创建数字人失败：${created.body}`);
  fx.ctx.users.create('admin', ['demo'], fx.ctx.store.revision());
  fx.ctx.users.create('ops', [], fx.ctx.store.revision());
});

afterEach(async () => {
  await fx.cleanup();
});

function revision(): number {
  return fx.ctx.store.revision();
}

async function deployAdmin() {
  return fx.app.inject({
    method: 'POST',
    url: '/api/admin/deploy',
    payload: { user_ids: ['admin'], revision: revision() },
  });
}

const agentsDir = () => path.join(fx.optAgentRoot, 'users', 'admin', 'agents');
const demoSoul = () => path.join(agentsDir(), 'demo', 'SOUL.md');

describe('`user_ids: []` 必须被拒绝（2026-10-20）', () => {
  it('deploy 返回 400 VALIDATION_FAILED，且运行环境零写入', async () => {
    const before = snapshotTree(path.join(fx.optAgentRoot, 'users'));

    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: [], revision: revision() },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    expect(res.json().error.message).toContain('省略该字段');

    expect(snapshotTree(path.join(fx.optAgentRoot, 'users'))).toEqual(before);
  });

  it('省略 `user_ids` 仍是"全部用户"（脚本口径不受影响）', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { revision: revision() },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json().users as Array<{ user_id: string }>).map((u) => u.user_id)).toEqual(['admin', 'ops']);
  });
});

describe('未知用户 → 404 且指明是哪些用户（2026-10-20）', () => {
  it('`details.user_ids` 精确列出不存在的标识', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: ['admin', 'ghost1', 'ghost2'], revision: revision() },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ADM_USER_NOT_FOUND');
    expect(res.json().error.details.user_ids).toEqual(['ghost1', 'ghost2']);
    expect(fs.existsSync(demoSoul())).toBe(false);
  });
});

describe('`manifest_diff`（FR-032）：部署前与运行环境的差异', () => {
  it('运行环境被手工删掉的数字人目录会被报出来，并在本次部署中恢复', async () => {
    expect((await deployAdmin()).statusCode).toBe(200);
    fs.rmSync(path.join(agentsDir(), 'demo'), { recursive: true, force: true });

    const res = await deployAdmin();
    expect(res.statusCode).toBe(200);

    const diffs = res.json().manifest_diff as Array<Record<string, string>>;
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      user_id: 'admin',
      target: 'demo',
      kind: 'agent_missing_in_runtime',
    });
    expect(diffs[0]!.detail).toContain('手工删除');
    expect(fs.existsSync(demoSoul())).toBe(true);
  });

  it('连续部署（无手工改动）时差异为空——不再用"部署失败"伪装差异', async () => {
    await deployAdmin();
    const res = await deployAdmin();

    expect(res.statusCode).toBe(200);
    expect(res.json().manifest_diff).toEqual([]);
  });

  it('差异同时写入部署历史（可追溯）', async () => {
    await deployAdmin();
    fs.rmSync(path.join(agentsDir(), 'demo'), { recursive: true, force: true });
    await deployAdmin();

    const history = await fx.app.inject({ method: 'GET', url: '/api/admin/deploy/history?limit=1' });
    const item = history.json().items[0] as { manifest_diff: Array<Record<string, string>> };
    expect(item.manifest_diff[0]).toMatchObject({ target: 'demo', kind: 'agent_missing_in_runtime' });
  });
});
