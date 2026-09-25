/**
 * 集成测试：部署端点（T070，契约 §6.5~§6.8 与 §7.1）
 *
 * MUST 覆盖每个端点（宪章原则三），且至少包含：
 * ①核心负向——校验不过 → 运行环境**零写入**且一次性列出全部错误项（`SC-020`）；
 * ②运行形态缺地址 → `ADM_RUNTIME_FORM_NOT_CONFIGURED`；
 * ③单用户失败零写入、其余用户不受影响（`FR-029`）；
 * ④幂等（`FR-030`）；⑤`ADM_DEPLOY_VALIDATION_FAILED` 的 `details.errors` 完整性；
 * ⑥双形态对比（`SC-024`）；⑦既有数据零破坏（`SC-007`）；⑧§7.1 引用清单一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createFixture,
  snapshotTree,
  type TestFixture,
} from '../helpers/fixture.js';

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

/** 配置一个带两种形态地址的 MCP 服务（`FR-056`） */
function configureMcp(
  name = 'ocr',
  endpoints: Record<string, string> = {
    container_network: 'http://ocr:8000/mcp',
    host_local: 'http://127.0.0.1:8000/mcp',
  },
): void {
  fx.ctx.mcpConfigs.upsert(
    name,
    {
      description: 'OCR 识别服务',
      transport: 'http',
      endpoints,
      file_args: { ocr_image: { image: 'url' } },
    },
    fx.ctx.store.revision(),
  );
}

async function createAgent(body: Record<string, unknown>): Promise<void> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: body });
  if (res.statusCode !== 201) throw new Error(`创建数字人失败：${res.body}`);
}

function baseAgent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'demo',
    soul: '你是一名生产计划助手。\n第二行。',
    enabled_tools: ['read_file'],
    mcp_services: ['ocr'],
    skills: [],
    scenario: { scenario: '生产', data_prep_dirs: ['生产计划', '算法规则'] },
    ...overrides,
  };
}

/** 关联用户与数字人 */
function link(userId: string, agents: string[]): void {
  fx.ctx.users.create(userId, agents, fx.ctx.store.revision());
}

function revision(): number {
  return fx.ctx.store.revision();
}

beforeEach(async () => {
  fx = await createFixture({ userIds: ['admin', 'ops'] });
  fx.runtime.tools = TOOL_FIXTURE;
  configureMcp();
  await createAgent(baseAgent());
  link('admin', ['demo']);
});

afterEach(async () => {
  await fx.cleanup();
});

describe('POST /api/admin/deploy/validate', () => {
  it('通过时返回 passed=true 与空错误清单', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy/validate',
      payload: { user_ids: ['admin'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ passed: true, errors: [] });
  });

  it('信息读取不到（运行环境不可达）→ 按失败处理，不视为通过', async () => {
    fx.runtime.unreachable = true;
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy/validate',
      payload: { user_ids: ['admin'] },
    });
    expect(res.json().passed).toBe(false);
    expect(res.json().errors[0].code).toBe('ADM_RUNTIME_UNREACHABLE');
  });

  it('user_ids 含不存在的用户 → 404 ADM_USER_NOT_FOUND', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy/validate',
      payload: { user_ids: ['ghost'] },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ADM_USER_NOT_FOUND');
  });

  it('只读：validate 不产生任何写入', async () => {
    const before = snapshotTree(path.join(fx.optAgentRoot, 'users', 'admin', 'agents'));
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy/validate',
      payload: { user_ids: ['admin'] },
    });
    const after = snapshotTree(path.join(fx.optAgentRoot, 'users', 'admin', 'agents'));
    expect(after).toEqual(before);
  });
});

describe('POST /api/admin/deploy —— 正常路径', () => {
  it('部署后落盘四文件；MCP.json 的 url 取目标运行形态的地址（FR-026、FR-056）', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: ['admin'], revision: revision() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.target_runtime_form).toBe('container_network');
    expect(body.users[0]).toMatchObject({ user_id: 'admin', ok: true });

    const dir = path.join(fx.optAgentRoot, 'users', 'admin', 'agents', 'demo');
    expect(fs.readdirSync(dir).sort()).toEqual(['MCP.json', 'SOUL.md', 'TOOL.json', 'scenario.json']);
    const mcp = JSON.parse(fs.readFileSync(path.join(dir, 'MCP.json'), 'utf8'));
    expect(mcp.servers[0]).toMatchObject({
      name: 'ocr',
      transport: 'http',
      url: 'http://ocr:8000/mcp',
    });
    // writable / permission_scope 已随 2026-09-15 的产品决定移除：产物 MUST NOT 再含写能力声明
    expect(mcp.servers[0].write).toBeUndefined();
    expect(mcp.servers[0].permission_boundary).toBeUndefined();
    expect(mcp.servers[0].file_args).toEqual({ ocr_image: { image: 'url' } });
  });

  it('async_tools（R11）：声明后物化进 MCP.json；清空后重新部署该键**消失**', async () => {
    const upsertConfig = (asyncTools: string[]): void => {
      fx.ctx.mcpConfigs.upsert(
        'ocr',
        {
          description: 'OCR 识别服务',
          transport: 'http',
          endpoints: { container_network: 'http://ocr:8000/mcp' },
          file_args: { ocr_image: { image: 'url' } },
          async_tools: asyncTools,
        },
        fx.ctx.store.revision(),
      );
    };
    const deploy = () =>
      fx.app.inject({
        method: 'POST',
        url: '/api/admin/deploy',
        payload: { user_ids: ['admin'], revision: revision() },
      });
    const mcpPath = path.join(fx.optAgentRoot, 'users', 'admin', 'agents', 'demo', 'MCP.json');

    upsertConfig(['submit_ocr']);
    expect((await deploy()).statusCode).toBe(200);
    const declared = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    expect(declared.servers[0].async_tools).toEqual(['submit_ocr']);

    // 清空声明 → 重新部署：产物里该键**消失**（不留空数组空壳，"整体覆盖"语义）
    upsertConfig([]);
    expect((await deploy()).statusCode).toBe(200);
    const cleared = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    expect(cleared.servers[0]).not.toHaveProperty('async_tools');
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

describe('POST /api/admin/deploy —— 核心负向（SC-020）', () => {
  it('校验不过 → 运行环境零写入，且一次性列出全部错误项 + 指明用户与数字人', async () => {
    // 制造三类错误：SOUL 为空（config_integrity）+ 失效引用 + 缺运行形态地址
    await createAgent(baseAgent({ name: 'broken', soul: 'x', skills: [] }));
    // 直接改写设计态文档以模拟"已保存但后来失效"的引用
    fx.ctx.store.writeJson('agents/broken.json', {
      name: 'broken',
      soul: 'x',
      enabled_tools: ['ghost_tool'],
      mcp_services: ['ocr'],
      skills: [],
      scenario: { scenario: '生产', data_prep_dirs: ['生产计划', '算法规则'] },
      updated_at: '2026-09-15T00:00:00.000Z',
    });
    link('ops', ['broken']);
    // 让 ocr 只声明宿主机本地地址：目标形态（容器编排内网）缺地址 → 第二类错误
    configureMcp('ocr', { host_local: 'http://127.0.0.1:8000/mcp' });

    const before = snapshotTree(path.join(fx.optAgentRoot, 'users'));
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { revision: revision() },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe('ADM_DEPLOY_VALIDATION_FAILED');
    const errors = body.error.details.errors as Array<Record<string, string>>;
    expect(errors.length).toBeGreaterThanOrEqual(2);
    const categories = new Set(errors.map((e) => e.category));
    expect(categories.has('reference_validity')).toBe(true);
    expect(categories.has('runtime_form')).toBe(true);
    for (const err of errors) {
      expect(typeof err.user_id).toBe('string');
      expect(typeof err.agent_name).toBe('string');
      expect(err.message.length).toBeGreaterThan(0);
    }
    // 运行环境写入次数 MUST 为 0
    expect(snapshotTree(path.join(fx.optAgentRoot, 'users'))).toEqual(before);
  });

  it('运行形态缺地址 → 单因同码，直接返回 ADM_RUNTIME_FORM_NOT_CONFIGURED', async () => {
    // 只声明宿主机本地地址，而目标形态是容器编排内网 → 缺地址
    configureMcp('ocr', { host_local: 'http://127.0.0.1:8000/mcp' });
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: ['admin'], revision: revision() },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ADM_RUNTIME_FORM_NOT_CONFIGURED');
    expect(res.json().error.details.errors[0].message).toContain('目标运行形态');
  });
});

describe('POST /api/admin/deploy —— 单用户失败隔离（FR-029）', () => {
  it('单用户写入失败 → 该用户零写入，其余用户正常产出', async () => {
    await createAgent(baseAgent({ name: 'demo2' }));
    // 用文件占住 ops 的 agents 目录，使其写入必然失败
    fs.rmSync(path.join(fx.optAgentRoot, 'users', 'ops', 'agents'), { recursive: true, force: true });
    fs.writeFileSync(path.join(fx.optAgentRoot, 'users', 'ops', 'agents'), 'blocked', 'utf8');
    link('ops', ['demo2']);

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
    expect(
      fs.existsSync(path.join(fx.optAgentRoot, 'users', 'admin', 'agents', 'demo', 'SOUL.md')),
    ).toBe(true);
    expect(fs.readFileSync(path.join(fx.optAgentRoot, 'users', 'ops', 'agents'), 'utf8')).toBe('blocked');
  });
});

describe('POST /api/admin/deploy —— 双形态对比（SC-024）', () => {
  it('同一数字人在两种目标形态下部署，MCP.json 的 url 分别取对应取值（全程不改 hosts、不手工编辑配置）', async () => {
    const deploy = async () =>
      (
        await fx.app.inject({
          method: 'POST',
          url: '/api/admin/deploy',
          payload: { user_ids: ['admin'], revision: revision() },
        })
      ).json();

    const first = await deploy();
    expect(first.target_runtime_form).toBe('container_network');
    const mcpPath = path.join(fx.optAgentRoot, 'users', 'admin', 'agents', 'demo', 'MCP.json');
    expect(JSON.parse(fs.readFileSync(mcpPath, 'utf8')).servers[0].url).toBe('http://ocr:8000/mcp');

    // 切换目标形态后再次部署
    await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/platform/settings',
      payload: { target_runtime_form: 'host_local', revision: revision() },
    });
    const second = await deploy();
    expect(second.target_runtime_form).toBe('host_local');
    expect(JSON.parse(fs.readFileSync(mcpPath, 'utf8')).servers[0].url).toBe(
      'http://127.0.0.1:8000/mcp',
    );
  });
});

describe('GET /api/admin/deploy/history 与 /manifest', () => {
  it('历史有界返回且含操作者、形态、结果（FR-033、SC-008）', async () => {
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: ['admin'], revision: revision() },
    });
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/deploy/history?limit=5' });
    expect(res.statusCode).toBe(200);
    const item = res.json().items[0];
    expect(item.operator).toBe('zyw_admin');
    expect(item.target_runtime_form).toBe('container_network');
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
  beforeEach(() => {
    // 第二个用户（未关联任何数字人）
    link('ops', []);
  });

  it('只选一个用户：预检与部署**只扫该用户**，其余用户零写入，且清单只记本次用户', async () => {
    const before = snapshotTree(path.join(fx.optAgentRoot, 'users', 'admin', 'agents'));

    // ops 未关联数字人 → 预检通过（不会被 admin 那边的情况牵连）
    const validate = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy/validate',
      payload: { user_ids: ['ops'] },
    });
    expect(validate.json()).toEqual({ passed: true, errors: [] });

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
    expect(before.json().items.map((u: { deployed_at: unknown }) => u.deployed_at)).toEqual([
      null,
      null,
    ]);

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
    link('ops', ['demo']);

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
