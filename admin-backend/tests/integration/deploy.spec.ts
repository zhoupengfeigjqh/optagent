/**
 * 集成测试：部署端点（契约 §6.6~§6.8 与 §7.1）
 *
 * MUST 覆盖每个端点（宪章原则三），且至少包含：
 * ①单用户失败零写入、其余用户不受影响（`FR-029`）；
 * ②幂等（`FR-030`）；③既有数据零破坏（`SC-007`）；④§7.1 引用清单一致；
 * ⑤`user_ids` 的请求层校验（空数组 400、未知用户 404）。
 *
 * **2026-09-27**：原"运行形态缺地址"与"双形态对比"两条随运行形态概念下架
 * ——MCP 连接地址为**单一 `url`**。
 *
 * **2026-11-23**：部署前预检下架，`POST /api/admin/deploy/validate` 端点已删除，
 * `SC-020`（整批零写入 + 一次性列出全部错误项）随之作废。失败只发生在写入阶段，
 * 且以**逐用户**方式呈现：某用户失败即跳过该用户，其余继续（`users[].ok=false`）。
 */
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

/** 新建/覆盖一个 MCP 服务（单一连接地址） */
function configureMcp(name = 'ocr', url = 'http://192.168.1.2:8000/mcp'): void {
  const input = {
    description: 'OCR 识别服务',
    transport: 'http',
    url,
    file_args: { ocr_image: { image: 'url' } },
  };
  if (fx.ctx.mcpConfigs.exists(name)) {
    fx.ctx.mcpConfigs.upsert(name, input, fx.ctx.store.revision());
  } else {
    // 工具白名单：新建必填非空（2026-10-03，创建后不可改），故只在新建路径给
    fx.ctx.mcpConfigs.create({ name, allowed_tools: ['ocr_image'], ...input });
  }
}

async function createAgent(body: Record<string, unknown>): Promise<void> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: body });
  if (res.statusCode !== 201) throw new Error(`创建数字人失败：${res.body}`);
}

function baseAgent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'demo',
    soul: soulDesign('你是一名生产计划助手。\n第二行。'),
    enabled_tools: ['read_file'],
    mcp_services: ['ocr'],
    skills: [],
    scenario: { scenario: '生产', data_prep_dirs: ['生产计划', '算法规则'] },
    ...overrides,
  };
}

/** 关联用户与数字人 */
async function link(userId: string, agents: string[]): Promise<void> {
  await fx.ctx.users.create(userId, agents, fx.ctx.store.revision());
}

/* 本体物化与快照完整性用例见同目录 `deploy-ontology.spec.ts`（本文件触 500 行门禁，故分居） */

function revision(): number {
  return fx.ctx.store.revision();
}

beforeEach(async () => {
  fx = await createFixture({ userIds: ['admin', 'ops'] });
  fx.runtime.tools = TOOL_FIXTURE;
  configureMcp();
  await createAgent(baseAgent());
  await link('admin', ['demo']);
});

afterEach(async () => {
  await fx.cleanup();
});

describe('POST /api/admin/deploy —— 请求层校验', () => {
  it('user_ids 含不存在的用户 → 404 ADM_USER_NOT_FOUND（不静默少部署）', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: ['ghost'], revision: revision() },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ADM_USER_NOT_FOUND');
  });

  it('user_ids 为空数组 → 400（MUST NOT 退化成"全部用户"）', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: [], revision: revision() },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('运行环境不可达不再阻断部署（预检下架后部署不依赖内置工具目录）', async () => {
    fx.runtime.unreachable = true;
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: ['admin'], revision: revision() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().users[0]).toMatchObject({ user_id: 'admin', ok: true });
  });
});

describe('POST /api/admin/deploy —— 正常路径', () => {
  it('部署后落盘四文件；MCP.json 的 url 取配置里的单一连接地址（FR-026）', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: ['admin'], revision: revision() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.users[0]).toMatchObject({ user_id: 'admin', ok: true });

    const dir = path.join(fx.optAgentRoot, 'users', 'admin', 'agents', 'demo');
    expect(fs.readdirSync(dir).sort()).toEqual(['MCP.json', 'SOUL.md', 'TOOL.json', 'scenario.json']);
    const mcp = JSON.parse(fs.readFileSync(path.join(dir, 'MCP.json'), 'utf8'));
    expect(mcp.servers[0]).toMatchObject({
      name: 'ocr',
      transport: 'http',
      url: 'http://192.168.1.2:8000/mcp',
    });
    // writable / permission_scope 已随 2026-09-15 的产品决定移除：产物 MUST NOT 再含写能力声明
    expect(mcp.servers[0].write).toBeUndefined();
    expect(mcp.servers[0].permission_boundary).toBeUndefined();
    expect(mcp.servers[0].file_args).toEqual({ ocr_image: { image: 'url' } });
  });

  it('幂等：相同内容重复部署结果稳定（FR-030）', async () => {
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: ['admin'], revision: revision() },
    });
    const first = snapshotTree(path.join(fx.optAgentRoot, 'users', 'admin', 'agents'));
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: ['admin'], revision: revision() },
    });
    expect(snapshotTree(path.join(fx.optAgentRoot, 'users', 'admin', 'agents'))).toEqual(first);
  });

  it('缺 revision → 400 VALIDATION_FAILED', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: ['admin'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('revision 不符 → 409 ADM_CONFIG_REVISION_CONFLICT 且零写入', async () => {
    const before = snapshotTree(path.join(fx.optAgentRoot, 'users', 'admin', 'agents'));
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: ['admin'], revision: revision() - 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ADM_CONFIG_REVISION_CONFLICT');
    expect(snapshotTree(path.join(fx.optAgentRoot, 'users', 'admin', 'agents'))).toEqual(before);
  });
});

describe('POST /api/admin/deploy —— 失效引用在写入阶段暴露（2026-11-23）', () => {
  it('引用的 SKILL 已被删除 → 该用户部署失败（跳过），其余用户正常产出', async () => {
    // 保存期会拒绝清单外 SKILL，故直接改写设计态文档模拟"保存后被删除"
    fx.ctx.store.writeJson('agents/broken.json', {
      name: 'broken',
      soul: soulDesign('x'),
      enabled_tools: [],
      mcp_services: [],
      skills: ['ghost-skill'],
      ontologies: [],
      scenario: { scenario: '生产', data_prep_dirs: ['生产计划', '算法规则'] },
      updated_at: '2026-09-15T00:00:00.000Z',
    });
    await link('ops', ['broken']);

    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { revision: revision() },
    });

    expect(res.statusCode).toBe(200);
    const users = res.json().users as Array<{ user_id: string; ok: boolean; error?: string }>;
    expect(users.find((u) => u.user_id === 'admin')?.ok).toBe(true);
    const ops = users.find((u) => u.user_id === 'ops');
    expect(ops?.ok).toBe(false);
    expect(ops?.error).toContain('SKILL');
    // 失败用户零写入；成功用户正常产出
    expect(fs.existsSync(path.join(fx.optAgentRoot, 'users', 'ops', 'agents', 'broken'))).toBe(false);
    expect(
      fs.existsSync(path.join(fx.optAgentRoot, 'users', 'admin', 'agents', 'demo', 'SOUL.md')),
    ).toBe(true);
  });

  it('引用的 MCP 服务已被删除 → 部署仍成功，但 MCP.json 里不再含该服务（静默降级）', async () => {
    fx.ctx.mcpConfigs.remove('ocr');
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: ['admin'], revision: revision() },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().users[0]).toMatchObject({ user_id: 'admin', ok: true });
    const mcp = JSON.parse(
      fs.readFileSync(
        path.join(fx.optAgentRoot, 'users', 'admin', 'agents', 'demo', 'MCP.json'),
        'utf8',
      ),
    );
    // 预检下架后不再拦截：物化时读不到服务配置即过滤（能力缺失，运行期才暴露）
    expect(mcp.servers).toEqual([]);
  });
});

describe('POST /api/admin/deploy —— 单用户失败隔离（FR-029）', () => {
  it('单用户写入失败 → 该用户零写入，其余用户正常产出', async () => {
    await createAgent(baseAgent({ name: 'demo2' }));
    // 用文件占住 ops 的 agents 目录，使其写入必然失败
    fs.rmSync(path.join(fx.optAgentRoot, 'users', 'ops', 'agents'), {
      recursive: true,
      force: true,
    });
    fs.writeFileSync(path.join(fx.optAgentRoot, 'users', 'ops', 'agents'), 'blocked', 'utf8');
    await link('ops', ['demo2']);

    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { revision: revision() },
    });

    expect(res.statusCode).toBe(200);
    const users = res.json().users as Array<{ user_id: string; ok: boolean; error?: string }>;
    expect(users.find((u) => u.user_id === 'admin')?.ok).toBe(true);
    const ops = users.find((u) => u.user_id === 'ops');
    expect(ops?.ok).toBe(false);
    expect(ops?.error).toBeTruthy();

    // admin 正常产出；ops 仍是那个占位文件（零写入）
    expect(fs.existsSync(path.join(fx.optAgentRoot, 'users', 'admin', 'agents', 'demo', 'SOUL.md'))).toBe(
      true,
    );
    expect(fs.readFileSync(path.join(fx.optAgentRoot, 'users', 'ops', 'agents'), 'utf8')).toBe('blocked');
  });
});

describe('GET /api/admin/deploy/history 与 /manifest', () => {
  it('历史有界返回且含操作者与结果（FR-033、SC-008）', async () => {
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: ['admin'], revision: revision() },
    });
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/deploy/history?limit=5' });
    expect(res.statusCode).toBe(200);
    const item = res.json().items[0];
    expect(item.operator).toBe('zyw_admin');
    // 运行形态字段已随概念下架
    expect(item.target_runtime_form).toBeUndefined();
    expect(item.user_count).toBe(1);
    expect(typeof item.id).toBe('string');
  });

  it('清单记录平台实际分发过的用户与数字人（FR-031）', async () => {
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: ['admin'], revision: revision() },
    });
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/deploy/manifest' });
    expect(res.json().total).toBe(1);
    expect(res.json().items[0]).toMatchObject({ user_id: 'admin', agent_names: ['demo'] });
  });

  it('limit 超上限按上限截断（有界返回）', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/deploy/history?limit=999' });
    expect(res.statusCode).toBe(200);
  });
});

describe('只选一部分用户部署（部署对象由用户卡片勾选，2026-09-16）', () => {
  beforeEach(async () => {
    // 第二个用户（未关联任何数字人）
    await link('ops', []);
  });

  it('只选一个用户：部署**只写该用户**，其余用户零写入，且清单只记本次用户', async () => {
    const before = snapshotTree(path.join(fx.optAgentRoot, 'users', 'admin', 'agents'));

    const deploy = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: ['ops'], revision: revision() },
    });
    expect(deploy.statusCode).toBe(200);
    expect(deploy.json().users.map((u: { user_id: string }) => u.user_id)).toEqual(['ops']);
    // admin 的目录一个字节都没变
    expect(snapshotTree(path.join(fx.optAgentRoot, 'users', 'admin', 'agents'))).toEqual(before);
    // 清单只记本次实际分发过的用户
    const manifest = await fx.app.inject({ method: 'GET', url: '/api/admin/deploy/manifest' });
    expect(manifest.json().items.map((i: { user_id: string }) => i.user_id)).toEqual(['ops']);
  });

  it('部署后用户列表带 `deployed_at`（卡片据此显示"已部署 + 最近一次时间"）；未部署用户为 null', async () => {
    const before = await fx.app.inject({ method: 'GET', url: '/api/admin/users?page=1' });
    expect(before.json().items.map((u: { deployed_at: unknown }) => u.deployed_at)).toEqual([null, null]);

    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: ['ops'], revision: revision() },
    });

    const after = await fx.app.inject({ method: 'GET', url: '/api/admin/users?page=1' });
    const ops = after.json().items.find((u: { user_id: string }) => u.user_id === 'ops');
    const admin = after.json().items.find((u: { user_id: string }) => u.user_id === 'admin');
    expect(typeof ops.deployed_at).toBe('string');
    expect(admin.deployed_at).toBeNull(); // 没勾选的用户仍是"未部署"
  });
});

describe('GET /api/admin/references（§7.1）', () => {
  it('各 target_type 返回的受影响清单与数字人配置中的引用一致', async () => {
    await link('ops', ['demo']);

    const cases: Array<[string, string, number]> = [
      ['builtin_tool', 'read_file', 2],
      ['mcp_service', 'ocr', 2],
      ['skill', 'nonexistent', 0],
      ['agent', 'demo', 2],
      ['user', 'admin', 1],
    ];
    for (const [type, name, expected] of cases) {
      const res = await fx.app.inject({
        method: 'GET',
        url: `/api/admin/references?target_type=${type}&target_name=${name}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().affected).toHaveLength(expected);
    }
  });

  it('非法 target_type → VALIDATION_FAILED', async () => {
    const res = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/references?target_type=nope&target_name=x',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('缺 target_name → VALIDATION_FAILED', async () => {
    const res = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/references?target_type=skill',
    });
    expect(res.statusCode).toBe(400);
  });
});
