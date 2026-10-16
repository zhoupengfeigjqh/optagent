/**
 * 集成测试：部署作用域守卫（T071，`FR-028`、`SC-012`、`SC-009`、`SC-019`）
 *
 * ① 部署前后三个文件空间（数据准备／共享空间／临时空间）下既有文件与二级目录
 *    **数量与内容 100% 不变**，含"场景目录清单收缩"场景；
 * ② `SC-009`：改库中一个被 N 个数字人引用的 SKILL 后部署一次，
 *    这 N 个数字人的技能目录内容与库中版本一致；
 * ③ `SC-019`：同一用户关联 N 个数字人且场景各不相同时，各自按自己的场景加载，
 *    改其中一个的场景不影响其余数字人。
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, snapshotTree, type TestFixture } from '../helpers/fixture.js';
import { soulDesign } from '../helpers/soul.js';
import { zipFixture } from '../helpers/zip-fixture.js';

let fx: TestFixture;

const TOOLS = [
  {
    name: 'read_file',
    label: '读取文件',
    description_template: '如 "{示例路径}"',
    parameters: { type: 'object' },
    writable: false,
  },
];

/** 在三个空间下放文件与二级目录，作为"内容不变量"的基准 */
function seedSpaces(): void {
  const data = path.join(fx.optAgentRoot, 'users', 'admin', 'user-data');
  fs.mkdirSync(path.join(data, '数据准备', '生产计划'), { recursive: true });
  fs.mkdirSync(path.join(data, '数据准备', '产线电价', '子目录'), { recursive: true });
  fs.mkdirSync(path.join(data, '共享空间', '资料'), { recursive: true });
  fs.mkdirSync(path.join(data, '临时空间'), { recursive: true });

  fs.writeFileSync(path.join(data, '数据准备', '生产计划', 'a.csv'), 'x,y\n1,2\n', 'utf8');
  fs.writeFileSync(path.join(data, '数据准备', '产线电价', '子目录', 'b.txt'), '内容B\n', 'utf8');
  fs.writeFileSync(path.join(data, '共享空间', '资料', 'c.md'), '# C\n', 'utf8');
  fs.writeFileSync(path.join(data, '临时空间', 'th_1_out.txt'), '产出\n', 'utf8');
}

async function createAgent(body: Record<string, unknown>): Promise<void> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: body });
  if (res.statusCode !== 201) throw new Error(`创建数字人失败：${res.body}`);
}

function agentBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'demo',
    soul: soulDesign('你是助手'),
    enabled_tools: [],
    mcp_services: [],
    skills: [],
    scenario: { scenario: '全量', data_prep_dirs: ['生产计划', '产线电价', '算法规则'] },
    ...overrides,
  };
}

function deployAll() {
  return fx.app.inject({
    method: 'POST',
    url: '/api/admin/deploy',
    payload: { user_ids: ['admin'], revision: fx.ctx.store.revision() },
  });
}

beforeEach(async () => {
  fx = await createFixture({ userIds: ['admin'] });
  fx.runtime.tools = TOOLS;
  seedSpaces();
});

afterEach(async () => {
  await fx.cleanup();
});

describe('作用域：文件空间内容 100% 不变（FR-028 / SC-012）', () => {
  it('部署前后三个空间下的文件与二级目录数量、内容完全一致', async () => {
    await createAgent(agentBody());
    fx.ctx.users.create('admin', ['demo'], fx.ctx.store.revision());

    const dataRoot = path.join(fx.optAgentRoot, 'users', 'admin', 'user-data');
    const before = snapshotTree(dataRoot);

    await deployAll();

    expect(snapshotTree(dataRoot)).toEqual(before);
  });

  it('场景目录清单收缩后部署：被移除的二级目录及其文件仍保留', async () => {
    await createAgent(agentBody());
    fx.ctx.users.create('admin', ['demo'], fx.ctx.store.revision());
    await deployAll();

    const dataRoot = path.join(fx.optAgentRoot, 'users', 'admin', 'user-data');
    const before = snapshotTree(dataRoot);

    // 收缩场景清单（去掉「产线电价」）
    const current = (await fx.app.inject({ method: 'GET', url: '/api/admin/agents/demo' })).json();
    await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/agents/demo',
      payload: {
        name: 'demo',
        soul: current.soul,
        enabled_tools: [],
        mcp_services: [],
        skills: [],
        scenario: { scenario: '精简', data_prep_dirs: ['生产计划', '算法规则'] },
        revision: current.revision,
      },
    });
    await deployAll();

    // 内容零变化：被移除的目录与其文件仍在
    expect(snapshotTree(dataRoot)).toEqual(before);
    expect(fs.existsSync(path.join(dataRoot, '数据准备', '产线电价', '子目录', 'b.txt'))).toBe(true);
  });
});

/**
 * 009（数字人数据隔离）：数据域归到**数字人一级**后，`user-data/**` 对平台依然是**只读区**。
 *
 * 三个要点：
 * 1. 未关联（甚至平台侧不存在）的数字人数据目录同样保留——"未纳管"不等于"可清理"；
 * 2. 已关联数字人的数据域（`user-data/{name}/**`）不被部署覆盖；
 * 3. 平台对数据目录**零创建**（新用户部署后不产生任何 `user-data/**`）。
 */
describe('作用域：未关联数字人的数据目录保留（009 FR-031）', () => {
  it('部署与撤回都不触碰 user-data/**：未关联数字人的数据目录原样保留', async () => {
    const dataRoot = path.join(fx.optAgentRoot, 'users', 'admin', 'user-data');
    // 平台侧**从未纳管**的数字人（移除后遗留 / 手工存在）：数据必须原样保留
    fs.mkdirSync(path.join(dataRoot, '历史数字人', '共享空间'), { recursive: true });
    fs.writeFileSync(path.join(dataRoot, '历史数字人', '共享空间', 'keep.csv'), 'x,y\n1,2\n', 'utf8');
    fs.mkdirSync(path.join(dataRoot, '历史数字人', '数据准备', '生产计划'), { recursive: true });
    fs.writeFileSync(path.join(dataRoot, '历史数字人', '数据准备', '生产计划', 'plan.csv'), 'a\n', 'utf8');
    // 已关联数字人的数据域：部署也不得覆盖
    fs.mkdirSync(path.join(dataRoot, 'demo', '临时空间'), { recursive: true });
    fs.writeFileSync(path.join(dataRoot, 'demo', '临时空间', 'th_out.txt'), '产出\n', 'utf8');

    const before = snapshotTree(dataRoot);

    await createAgent(agentBody());
    fx.ctx.users.create('admin', ['demo'], fx.ctx.store.revision());
    expect((await deployAll()).statusCode).toBe(200);
    expect(snapshotTree(dataRoot)).toEqual(before);

    // 撤回同样零触碰（撤回的是"能力"，不是数据）
    const withdraw = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy/withdraw',
      payload: { user_id: 'admin', revision: fx.ctx.store.revision() },
    });
    expect(withdraw.statusCode).toBe(200);
    expect(snapshotTree(dataRoot)).toEqual(before);
    expect(fs.existsSync(path.join(dataRoot, '历史数字人', '共享空间', 'keep.csv'))).toBe(true);
  });

  it('平台对数据目录零创建：新用户部署后 `user-data` 一个目录都不出现', async () => {
    await createAgent(agentBody({ name: 'a1' }));
    fx.ctx.users.create('admin', ['a1'], fx.ctx.store.revision());
    fx.ctx.users.create('ops', ['a1'], fx.ctx.store.revision());

    // 清掉夹具预置的旧布局目录，观察"平台自己会不会建"
    fs.rmSync(path.join(fx.optAgentRoot, 'users', 'ops', 'user-data'), {
      recursive: true,
      force: true,
    });
    expect(fs.existsSync(path.join(fx.optAgentRoot, 'users', 'ops', 'user-data'))).toBe(false);

    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: ['admin', 'ops'], revision: fx.ctx.store.revision() },
    });
    expect(res.statusCode).toBe(200);

    // 数字人目录才有产物；数据域由运行环境惰性创建（Q2=A：平台零触碰）
    expect(fs.existsSync(path.join(fx.optAgentRoot, 'users', 'ops', 'agents', 'a1'))).toBe(true);
    expect(fs.existsSync(path.join(fx.optAgentRoot, 'users', 'ops', 'user-data'))).toBe(false);
  });
});

describe('SC-009：SKILL 内容随库版本覆盖到全部引用者', () => {
  it('改库中 SKILL 正文后部署一次，N 个数字人的技能目录内容与库中一致', async () => {
    const zip = zipFixture({
      'SKILL.md': '---\nname: pdf-parse\ndescription: 解析 PDF\n---\n\n第一版正文\n',
      'helper.txt': '附件\n',
    });
    const install = await fx.ctx.skills.install(zip, { overwrite: false, source: 'test.zip' });
    expect(install.name).toBe('pdf-parse');

    await createAgent(agentBody({ name: 'a1', skills: ['pdf-parse'] }));
    await createAgent(agentBody({ name: 'a2', skills: ['pdf-parse'] }));
    fx.ctx.users.create('admin', ['a1', 'a2'], fx.ctx.store.revision());
    await deployAll();

    // 改库中正文：**在线编辑**（2026-09-16 开放），附件不必随包重传
    const v2 = '---\nname: pdf-parse\ndescription: 解析 PDF\n---\n\n第二版正文\n';
    fx.ctx.skills.writeFile(
      'pdf-parse',
      'SKILL.md',
      v2,
      fx.ctx.skills.readFile('pdf-parse', 'SKILL.md').hash,
    );

    // 编辑只改**库里那一份**：已部署的副本必须原样不动（否则会出现"改库即静默推送"）
    for (const agent of ['a1', 'a2']) {
      const beforeDeploy = fs.readFileSync(
        path.join(fx.optAgentRoot, 'users', 'admin', 'agents', agent, 'skills', 'pdf-parse', 'SKILL.md'),
        'utf8',
      );
      expect(beforeDeploy).toContain('第一版正文');
    }

    await deployAll();

    for (const agent of ['a1', 'a2']) {
      const materialized = fs.readFileSync(
        path.join(fx.optAgentRoot, 'users', 'admin', 'agents', agent, 'skills', 'pdf-parse', 'SKILL.md'),
        'utf8',
      );
      expect(materialized).toBe('---\nname: pdf-parse\ndescription: 解析 PDF\n---\n\n第二版正文\n');
      // 整包物化：附件也在
      expect(
        fs.existsSync(
          path.join(fx.optAgentRoot, 'users', 'admin', 'agents', agent, 'skills', 'pdf-parse', 'helper.txt'),
        ),
      ).toBe(true);
    }
  });
});

describe('SC-019：场景是数字人级的，互不影响', () => {
  it('同一用户关联两个数字人且场景不同 → 各自落盘自己的场景；改其一不影响另一个', async () => {
    await createAgent(
      agentBody({
        name: 'a1',
        scenario: { scenario: '全量', data_prep_dirs: ['生产计划', '产线电价', '算法规则'] },
      }),
    );
    await createAgent(
      agentBody({
        name: 'a2',
        scenario: { scenario: '精简', data_prep_dirs: ['产线电价', '算法规则'] },
      }),
    );
    fx.ctx.users.create('admin', ['a1', 'a2'], fx.ctx.store.revision());
    await deployAll();

    const scenarioOf = (agent: string) =>
      JSON.parse(
        fs.readFileSync(
          path.join(fx.optAgentRoot, 'users', 'admin', 'agents', agent, 'scenario.json'),
          'utf8',
        ),
      );

    expect(scenarioOf('a1')).toEqual({
      scenario: '全量',
      data_prep_dirs: ['生产计划', '产线电价', '算法规则'],
    });
    expect(scenarioOf('a2')).toEqual({
      scenario: '精简',
      data_prep_dirs: ['产线电价', '算法规则'],
    });

    // 改 a1 的场景后再次部署：a2 不受影响
    const current = (await fx.app.inject({ method: 'GET', url: '/api/admin/agents/a1' })).json();
    await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/agents/a1',
      payload: {
        name: 'a1',
        soul: current.soul,
        enabled_tools: [],
        mcp_services: [],
        skills: [],
        scenario: { scenario: '仅生产计划', data_prep_dirs: ['生产计划', '算法规则'] },
        revision: current.revision,
      },
    });
    await deployAll();

    expect(scenarioOf('a1')).toEqual({
      scenario: '仅生产计划',
      data_prep_dirs: ['生产计划', '算法规则'],
    });
    expect(scenarioOf('a2')).toEqual({
      scenario: '精简',
      data_prep_dirs: ['产线电价', '算法规则'],
    });
  });
});
