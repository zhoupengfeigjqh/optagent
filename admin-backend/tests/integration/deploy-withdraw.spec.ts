/**
 * 集成测试：部署产物的**留存与撤回**（`SC-007`、`FR-028`、契约 §6.9，2026-09-16）
 *
 * 守住两条产品决定：
 * ① 部署对 `agents/` 是**整体覆盖**——手工放进该目录的内容会被清掉
 *    （原先"只移除部署清单内的"会让旧目录在清单对不上时永远留下），
 *    但用户文件空间（`user-data/**`）一律不触碰；
 * ② 「撤回」把该用户的数字人从运行环境**整体下架**，而平台侧关联与文件空间保留，
 *    清单条目移除（卡片回到"未部署"），重新部署即可恢复。
 *
 * 与 `deploy.spec.ts` 分文件：部署本体与"留存/撤回"是两件事，各自压在一个文件里
 * 已越过 500 行的门禁（`npm run check:lines`）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, type TestFixture } from '../helpers/fixture.js';

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

const AGENT = {
  name: 'demo',
  soul: '你是一名生产计划助手。\n第二行。',
  enabled_tools: ['read_file'],
  mcp_services: ['ocr'],
  skills: [],
  scenario: { scenario: '生产', data_prep_dirs: ['生产计划'] },
};

function revision(): number {
  return fx.ctx.store.revision();
}

/** 部署 / 撤回（读端与写端都以当前 revision 提交） */
function deploy(userIds: string[] = ['admin']) {
  return fx.app.inject({
    method: 'POST',
    url: '/api/admin/deploy',
    payload: { user_ids: userIds, revision: revision() },
  });
}

function withdraw(userId: string, rev = revision()) {
  return fx.app.inject({
    method: 'POST',
    url: '/api/admin/deploy/withdraw',
    payload: { user_id: userId, revision: rev },
  });
}

beforeEach(async () => {
  fx = await createFixture({ userIds: ['admin', 'ops'] });
  fx.runtime.tools = TOOL_FIXTURE;
  fx.ctx.mcpConfigs.upsert(
    'ocr',
    {
      description: 'OCR 识别服务',
      transport: 'http',
      endpoints: { container_network: 'http://ocr:8000/mcp' },
      file_args: {},
    },
    fx.ctx.store.revision(),
  );
  await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: AGENT });
  fx.ctx.users.create('admin', ['demo'], fx.ctx.store.revision());
});

afterEach(async () => {
  await fx.cleanup();
});

describe('部署产物留存：`agents/` 整体覆盖（SC-007、FR-028）', () => {
  it('既有数字人／SKILL／用户数量不减少，用户文件空间一律不触碰', async () => {
    const shared = path.join(fx.optAgentRoot, 'users', 'admin', 'user-data', '共享空间');
    fs.mkdirSync(shared, { recursive: true });
    fs.writeFileSync(path.join(shared, 'keep.txt'), '业务数据', 'utf8');

    const before = {
      agents: fx.ctx.agents.listAll().length,
      skills: fx.ctx.skills.listAll().length,
      users: fx.ctx.users.listAll().length,
    };

    expect((await deploy()).statusCode).toBe(200);

    expect(fx.ctx.agents.listAll().length).toBe(before.agents);
    expect(fx.ctx.skills.listAll().length).toBe(before.skills);
    expect(fx.ctx.users.listAll().length).toBe(before.users);
    expect(fs.readFileSync(path.join(shared, 'keep.txt'), 'utf8')).toBe('业务数据');
  });

  it('`agents/` 由部署整体覆盖：手工放进去的目录会被清掉（"删不掉数字人"的根治）', async () => {
    const foreign = path.join(fx.optAgentRoot, 'users', 'admin', 'agents', 'manual-agent');
    fs.mkdirSync(foreign, { recursive: true });
    fs.writeFileSync(path.join(foreign, 'SOUL.md'), '手工创建', 'utf8');

    expect((await deploy()).statusCode).toBe(200);

    // 该目录由平台独占管理 → 整体覆盖后不再存在
    expect(fs.existsSync(foreign)).toBe(false);
    // 本次产物照常在位
    expect(
      fs.existsSync(path.join(fx.optAgentRoot, 'users', 'admin', 'agents', 'demo', 'SOUL.md')),
    ).toBe(true);
  });
});

describe('撤回部署（§6.9）', () => {
  it('清空数字人目录：文件空间保留、卡片回到"未部署"、重新部署即可恢复', async () => {
    await deploy();
    const agentDir = path.join(fx.optAgentRoot, 'users', 'admin', 'agents', 'demo');
    expect(fs.existsSync(agentDir)).toBe(true);

    const shared = path.join(fx.optAgentRoot, 'users', 'admin', 'user-data', '共享空间');
    fs.mkdirSync(shared, { recursive: true });
    fs.writeFileSync(path.join(shared, 'keep.txt'), 'keep', 'utf8');

    const res = await withdraw('admin');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ user_id: 'admin', withdrawn: ['demo'] });

    // 数字人目录整目录下架；文件空间原样
    expect(fs.existsSync(path.join(fx.optAgentRoot, 'users', 'admin', 'agents'))).toBe(false);
    expect(fs.readFileSync(path.join(shared, 'keep.txt'), 'utf8')).toBe('keep');

    // 清单条目移除 → 用户卡片显示"未部署"
    const users = await fx.app.inject({ method: 'GET', url: '/api/admin/users?page=1' });
    const admin = users.json().items.find((u: { user_id: string }) => u.user_id === 'admin');
    expect(admin.deployed_at).toBeNull();
    const manifest = await fx.app.inject({ method: 'GET', url: '/api/admin/deploy/manifest' });
    expect(manifest.json().items).toEqual([]);

    // 撤回不动平台侧关联：重新部署即恢复
    expect((await deploy()).statusCode).toBe(200);
    expect(fs.existsSync(agentDir)).toBe(true);
  });

  it('只影响该用户：其他用户的目录不受影响', async () => {
    fx.ctx.users.create('ops', ['demo'], fx.ctx.store.revision());
    await deploy(['admin', 'ops']);
    const opsDir = path.join(fx.optAgentRoot, 'users', 'ops', 'agents', 'demo');
    expect(fs.existsSync(opsDir)).toBe(true);

    await withdraw('admin');

    expect(fs.existsSync(opsDir)).toBe(true);
  });

  it('未知用户 → 404 ADM_USER_NOT_FOUND', async () => {
    const res = await withdraw('ghost');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ADM_USER_NOT_FOUND');
  });

  it('revision 不符 → 409 且零写入；缺 user_id → 400', async () => {
    await deploy();

    const conflict = await withdraw('admin', revision() - 1);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('ADM_CONFIG_REVISION_CONFLICT');
    expect(fs.existsSync(path.join(fx.optAgentRoot, 'users', 'admin', 'agents', 'demo'))).toBe(true);

    const missing = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy/withdraw',
      payload: { revision: revision() },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('VALIDATION_FAILED');
  });
});
