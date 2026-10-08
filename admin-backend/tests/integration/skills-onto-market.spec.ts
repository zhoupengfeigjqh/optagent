/**
 * 集成测试：本体市场导入与更新端点（2026-10-02，契约 §4.6 / §4.7 / §4.8）
 *
 * 覆盖：市场列表（含差异状态与"未配置"降级）、导入成功（201 + origin 回显）、
 * **重名直接拒绝**（409，市场文件已变化也不得覆盖库内版本）、参数与路径安全；
 * 更新：整包原子替换（installed_at 保留、origin.hash 换新、状态回 unchanged）、
 * 人工修改需确认（ADM_SKILL_MODIFIED）、受影响数字人清单。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFixture, type TestFixture } from '../helpers/fixture.js';
import { multipartBody } from '../helpers/multipart.js';
import { zipFixture } from '../helpers/zip-fixture.js';

const SKILL_MD = '---\nname: raw-material-inventory\ndescription: 原材料与库存本体技能\n---\n\n正文\n';

let fx: TestFixture;
let marketDir: string | null = null;

/** 建夹具：withMarket=true 时在临时目录搭一个市场（生产调度/原材料采购和库存/skills/...） */
async function setup(withMarket: boolean): Promise<void> {
  if (withMarket) {
    marketDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-market-'));
    const skillDir = path.join(
      marketDir,
      '生产调度',
      '原材料采购和库存',
      'skills',
      'raw-material-inventory',
    );
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), SKILL_MD);
    fx = await createFixture({ env: { ONTO_MARKET_DIR: marketDir } });
  } else {
    fx = await createFixture();
  }
}

afterEach(async () => {
  await fx.cleanup();
  if (marketDir !== null) {
    fs.rmSync(marketDir, { recursive: true, force: true });
    marketDir = null;
  }
});

function install(scenario: string, ontology: string, skill: string) {
  return fx.app.inject({
    method: 'POST',
    url: '/api/admin/skills/onto-market/install',
    payload: { scenario, ontology, skill },
  });
}

function update(scenario: string, ontology: string, skill: string, confirm = false) {
  return fx.app.inject({
    method: 'POST',
    url: '/api/admin/skills/onto-market/update',
    payload: { scenario, ontology, skill, confirm },
  });
}

/** 市场技能目录的绝对路径（改市场文件用） */
function marketSkillDir(): string {
  return path.join(
    marketDir!,
    '生产调度',
    '原材料采购和库存',
    'skills',
    'raw-material-inventory',
  );
}

describe('GET /api/admin/skills/onto-market', () => {
  it('列出市场技能并标注状态 new', async () => {
    await setup(true);

    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/skills/onto-market' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      scenario: '生产调度',
      ontology: '原材料采购和库存',
      skill_dir: 'raw-material-inventory',
      name: 'raw-material-inventory',
      status: 'new',
    });
  });

  it('市场文件变化后 → status=changed（打开列表即完成一次"是否变化"检查）', async () => {
    await setup(true);
    // 先导入，库内才有一份带 origin.hash 的记录可比对
    expect(
      (await install('生产调度', '原材料采购和库存', 'raw-material-inventory')).statusCode,
    ).toBe(201);
    fs.writeFileSync(
      path.join(
        marketDir!,
        '生产调度',
        '原材料采购和库存',
        'skills',
        'raw-material-inventory',
        'SKILL.md',
      ),
      SKILL_MD.replace('正文', '正文（更新）'),
    );

    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/skills/onto-market' });
    expect(res.json().items[0]!.status).toBe('changed');
  });

  it('未配置 ONTO_MARKET_DIR → configured=false（功能不可用但不报错）', async () => {
    await setup(false);

    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/skills/onto-market' });
    expect(res.statusCode).toBe(200);
    expect(res.json().configured).toBe(false);
    expect(res.json().items).toEqual([]);
  });
});

describe('POST /api/admin/skills/onto-market/install', () => {
  it('导入成功（201）：卡片出现且带 origin；库内正文与市场一致', async () => {
    await setup(true);

    const res = await install('生产调度', '原材料采购和库存', 'raw-material-inventory');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'raw-material-inventory', overwritten: false });

    const list = await fx.app.inject({ method: 'GET', url: '/api/admin/skills?page=1' });
    expect(list.json().items[0]).toMatchObject({
      name: 'raw-material-inventory',
      source: 'onto_market:生产调度/原材料采购和库存',
      origin: { kind: 'onto_market', scenario: '生产调度', ontology: '原材料采购和库存' },
    });
  });

  it('重名直接拒绝（409 ADM_SKILL_NAME_TAKEN）：市场文件已变化也不得覆盖库内版本', async () => {
    await setup(true);
    expect((await install('生产调度', '原材料采购和库存', 'raw-material-inventory')).statusCode).toBe(
      201,
    );
    fs.writeFileSync(
      path.join(
        marketDir!,
        '生产调度',
        '原材料采购和库存',
        'skills',
        'raw-material-inventory',
        'SKILL.md',
      ),
      SKILL_MD.replace('正文', '正文（更新）'),
    );

    const res = await install('生产调度', '原材料采购和库存', 'raw-material-inventory');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ADM_SKILL_NAME_TAKEN');

    const detail = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/skills/raw-material-inventory',
    });
    expect(detail.json().description).toBe('原材料与库存本体技能');
  });

  it('缺参数 / 路径穿越 → 400 VALIDATION_FAILED', async () => {
    await setup(true);

    const missing = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/skills/onto-market/install',
      payload: { scenario: '生产调度' },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('VALIDATION_FAILED');

    const traversal = await install('..', 'x', 'y');
    expect(traversal.statusCode).toBe(400);
    expect(traversal.json().error.code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /api/admin/skills/onto-market/update（§4.8）', () => {
  it('市场变化后更新成功（200）：整包替换、installed_at 保留、origin.hash 换新、状态回 unchanged', async () => {
    await setup(true);
    const installed = (await install('生产调度', '原材料采购和库存', 'raw-material-inventory')).json();
    expect(installed.overwritten).toBe(false);
    fs.writeFileSync(
      path.join(marketSkillDir(), 'SKILL.md'),
      SKILL_MD.replace('正文', '正文（更新）'),
    );
    fs.mkdirSync(path.join(marketSkillDir(), 'references'), { recursive: true });
    fs.writeFileSync(path.join(marketSkillDir(), 'references', '附录.md'), '附录内容');

    const res = await update('生产调度', '原材料采购和库存', 'raw-material-inventory');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      name: 'raw-material-inventory',
      overwritten: true,
      locally_modified: false,
      affected_agents: [],
    });
    expect(body.installed_at).toBe(installed.installed_at);

    // 库内正文 = 市场新版本；附件一并入驻
    const detail = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/skills/raw-material-inventory',
    });
    expect(detail.json().description).toBe('原材料与库存本体技能');
    const file = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/skills/raw-material-inventory/file',
      query: { path: 'references/附录.md' },
    });
    expect(file.json().content).toBe('附录内容');

    // 状态回 unchanged（origin.hash 从新基准起算）
    const listing = await fx.app.inject({ method: 'GET', url: '/api/admin/skills/onto-market' });
    expect(listing.json().items[0]!.status).toBe('unchanged');
  });

  it('库内版本被人工修改 + 未确认 → 409 ADM_SKILL_MODIFIED；confirm=true 后成功且 locally_modified=true', async () => {
    await setup(true);
    await install('生产调度', '原材料采购和库存', 'raw-material-inventory');
    fs.writeFileSync(
      path.join(marketSkillDir(), 'SKILL.md'),
      SKILL_MD.replace('正文', '正文（更新）'),
    );

    // 模拟"库内被人工修改"：**直接改磁盘**（2026-10-03 起市场来源技能已只读，
    // §4.3 编辑接口会 409，所以这里走带外改动——正是本用例要防的场景：
    // 有人绕过平台改了库内文件，`origin.hash` 与库内内容不再一致）
    const libraryFile = path.join(
      fx.platformDataDir,
      'skills',
      'raw-material-inventory',
      'SKILL.md',
    );
    fs.writeFileSync(libraryFile, SKILL_MD.replace('正文', '正文（人工改）'));

    const refused = await update('生产调度', '原材料采购和库存', 'raw-material-inventory');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('ADM_SKILL_MODIFIED');

    const confirmed = await update('生产调度', '原材料采购和库存', 'raw-material-inventory', true);
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().locally_modified).toBe(true);

    // 更新后库内 = 市场版本（人工修改被丢弃，正如确认弹窗所告知）
    const detail = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/skills/raw-material-inventory/file',
      query: { path: 'SKILL.md' },
    });
    expect(detail.json().content).toBe(SKILL_MD.replace('正文', '正文（更新）'));
  });

  it('返回引用该技能的数字人清单（affected_agents）；未引用则为空', async () => {
    await setup(true);
    await install('生产调度', '原材料采购和库存', 'raw-material-inventory');
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      payload: {
        name: '计划员',
        soul: '你是生产计划助手。',
        enabled_tools: [],
        mcp_services: [],
        skills: ['raw-material-inventory'],
        scenario: { scenario: 's', data_prep_dirs: ['算法规则'] },
      },
    });
    fs.writeFileSync(
      path.join(marketSkillDir(), 'SKILL.md'),
      SKILL_MD.replace('正文', '正文（更新）'),
    );

    const res = await update('生产调度', '原材料采购和库存', 'raw-material-inventory');
    expect(res.statusCode).toBe(200);
    expect(res.json().affected_agents).toEqual(['计划员']);
  });

  it('库内不存在同名技能 → 400 VALIDATION_FAILED（更新不凭空创建）；缺参数 → 400', async () => {
    await setup(true);

    const missing = await update('生产调度', '原材料采购和库存', 'raw-material-inventory');
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('VALIDATION_FAILED');

    const noArgs = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/skills/onto-market/update',
      payload: { scenario: '生产调度' },
    });
    expect(noArgs.statusCode).toBe(400);
    expect(noArgs.json().error.code).toBe('VALIDATION_FAILED');
  });
});

describe('本体市场来源的技能只读（2026-10-03，FR-062）', () => {
  /** 读技能内某文件（拿当前内容与乐观锁基准 hash） */
  async function readFile(path = 'SKILL.md') {
    return fx.app.inject({
      method: 'GET',
      url: '/api/admin/skills/raw-material-inventory/file',
      query: { path },
    });
  }

  it('从市场导入后：在线编辑被拒（409 ADM_SKILL_READ_ONLY），且内容零变化', async () => {
    await setup(true);
    expect((await install('生产调度', '原材料采购和库存', 'raw-material-inventory')).statusCode).toBe(
      201,
    );
    const before = await readFile();
    // 只读来源：读取接口即回 `editable: false`（与写入拦截同一口径）
    expect(before.json().editable).toBe(false);

    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/skills/raw-material-inventory/file',
      payload: { path: 'SKILL.md', content: '被改过的正文\n', base_hash: before.json().hash },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ADM_SKILL_READ_ONLY');
    expect(res.json().error.message).toContain('只读');
    // 拦截发生在写入之前：正文与市场快照逐字节一致
    const after = await readFile();
    expect(after.json().content).toBe(SKILL_MD);
    expect(after.json().hash).toBe(before.json().hash);
  });

  it('对照：ZIP 安装的技能（非市场来源）仍可在线编辑——只读判据是来源，不是"一律禁止"', async () => {
    await setup(true);
    const body = multipartBody(
      {},
      {
        name: 'local.zip',
        content: zipFixture({
          'SKILL.md': '---\nname: local-skill\ndescription: 本地上传\n---\n\n正文\n',
        }),
      },
    );
    const installed = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/skills/install',
      payload: body.payload,
      headers: body.headers,
    });
    expect(installed.statusCode).toBe(201);
    expect(installed.json().origin).toBeUndefined(); // 非市场来源：无 origin 标记

    const read = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/skills/local-skill/file',
      query: { path: 'SKILL.md' },
    });
    expect(read.statusCode).toBe(200);
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/skills/local-skill/file',
      payload: {
        path: 'SKILL.md',
        // 保存 SKILL.md 时 frontmatter 的 name 必须与技能名一致（既有校验）
        content: '---\nname: local-skill\ndescription: 本地上传（改过）\n---\n\n正文改过了\n',
        base_hash: read.json().hash,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().size).toBeGreaterThan(0);
  });
});
