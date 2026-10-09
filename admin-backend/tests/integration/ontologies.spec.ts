/**
 * 集成测试：本体管理端点（2026-10-03，契约 §10）
 *
 * 覆盖：列表（分页 + 不下发正文）、详情（全文只读）、删除、市场列表与状态、
 * 导入（重复即拒）、更新（不存在即拒）、落盘结构与市场前两级一致、
 * **只读保证**（平台不提供任何编辑本体的端点，且对市场零写入）。
 *
 * 安全管控（`securities.yaml`）的同步用例见同目录 `ontologies-securities.spec.ts`
 * （本文件触 500 行门禁，故分居两处）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFixture, snapshotTree, type TestFixture } from '../helpers/fixture.js';

const SCENARIO = '生产调度';
const ONTOLOGY = '原材料采购和库存';

const YAML = `metadata:
  created_at: '2026-07-15 16:05:02'
  deployed_version: v1.0
  scenario_name: ${SCENARIO}
  scenario_id: 1
  ontology_name: ${ONTOLOGY}
  ontology_id: 1
concepts: []
`;

let fx: TestFixture;
let marketDir: string | null = null;

/** 搭一个市场（默认含一个本体）；withMarket=false 时完全不配置 ONTO_MARKET_DIR */
async function setup(withMarket = true): Promise<void> {
  if (withMarket) {
    marketDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-market-'));
    writeMarket(ONTOLOGY, YAML);
    fx = await createFixture({ env: { ONTO_MARKET_DIR: marketDir } });
  } else {
    fx = await createFixture();
  }
}

function writeMarket(ontologyDir: string, content: string, scenario = SCENARIO): void {
  const dir = path.join(marketDir!, scenario, ontologyDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ontology.yaml'), content);
}

/** 库内落盘文件（断言结构与内容用） */
function savedFile(): string {
  return path.join(fx.platformDataDir, 'onto_market', SCENARIO, ONTOLOGY, 'ontology.yaml');
}

function importOntology(scenario = SCENARIO, ontologyDir = ONTOLOGY) {
  return fx.app.inject({
    method: 'POST',
    url: '/api/admin/ontologies/onto-market/import',
    payload: { scenario, ontology_dir: ontologyDir },
  });
}

function updateOntology(scenario = SCENARIO, ontologyDir = ONTOLOGY) {
  return fx.app.inject({
    method: 'POST',
    url: '/api/admin/ontologies/onto-market/update',
    payload: { scenario, ontology_dir: ontologyDir },
  });
}

afterEach(async () => {
  await fx.cleanup();
  if (marketDir !== null) {
    fs.rmSync(marketDir, { recursive: true, force: true });
    marketDir = null;
  }
});

describe('GET /api/admin/ontologies（§10.1）', () => {
  it('空库 → total=0；导入后卡片字段齐备且**不下发正文**', async () => {
    await setup();
    const empty = await fx.app.inject({ method: 'GET', url: '/api/admin/ontologies' });
    expect(empty.json()).toMatchObject({ total: 0, page: 1, page_size: 8 });
    expect(empty.json().items).toEqual([]);

    await importOntology();
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/ontologies' });
    expect(res.statusCode).toBe(200);
    const item = res.json().items[0];
    expect(item).toMatchObject({
      scenario: SCENARIO,
      ontology_dir: ONTOLOGY,
      name: ONTOLOGY,
      source: `onto_market:${SCENARIO}`,
    });
    expect(item.metadata).toMatchObject({
      created_at: '2026-07-15 16:05:02',
      deployed_version: 'v1.0',
      scenario_name: SCENARIO,
      scenario_id: 1,
      ontology_name: ONTOLOGY,
      ontology_id: 1,
    });
    expect(item).not.toHaveProperty('content');
  });
});

describe('GET /api/admin/ontologies/{name}?scenario=（§10.2）', () => {
  it('返回 ontology.yaml 全文、大小与指纹', async () => {
    await setup();
    await importOntology();

    const res = await fx.app.inject({
      method: 'GET',
      url: `/api/admin/ontologies/${encodeURIComponent(ONTOLOGY)}`,
      query: { scenario: SCENARIO },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toBe(YAML);
    expect(res.json().size).toBe(Buffer.byteLength(YAML, 'utf8'));
    expect(res.json().hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('缺 scenario → 400；本体不存在 → 404 ADM_ONTOLOGY_NOT_FOUND', async () => {
    await setup();
    const missingScenario = await fx.app.inject({
      method: 'GET',
      url: `/api/admin/ontologies/${encodeURIComponent(ONTOLOGY)}`,
    });
    expect(missingScenario.statusCode).toBe(400);
    expect(missingScenario.json().error.code).toBe('VALIDATION_FAILED');

    const ghost = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/ontologies/ghost',
      query: { scenario: SCENARIO },
    });
    expect(ghost.statusCode).toBe(404);
    expect(ghost.json().error.code).toBe('ADM_ONTOLOGY_NOT_FOUND');
  });
});

describe('DELETE /api/admin/ontologies/{name}?scenario=（§10.3）', () => {
  /** ASCII 名（场景 + 目录名）——删除的落地断言用它们，避开 Windows 宿主的非 ASCII 路径限制 */
  const ASCII = { scenario: 'demo-scenario', ontology_dir: 'demo-ontology' };

  it('删除 204：磁盘目录清除、记录消失、再读 404、再删 404、缺 scenario 400', async () => {
    await setup();
    writeMarket(ASCII.ontology_dir, YAML, ASCII.scenario);
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/ontologies/onto-market/import',
      payload: ASCII,
    });
    const dir = path.join(fx.platformDataDir, 'onto_market', ASCII.scenario, ASCII.ontology_dir);
    expect(fs.existsSync(dir)).toBe(true);

    const res = await fx.app.inject({
      method: 'DELETE',
      url: `/api/admin/ontologies/${ASCII.ontology_dir}`,
      query: { scenario: ASCII.scenario },
    });
    expect(res.statusCode).toBe(204);
    expect(fs.existsSync(dir)).toBe(false);

    const detail = await fx.app.inject({
      method: 'GET',
      url: `/api/admin/ontologies/${ASCII.ontology_dir}`,
      query: { scenario: ASCII.scenario },
    });
    expect(detail.statusCode).toBe(404);

    const again = await fx.app.inject({
      method: 'DELETE',
      url: `/api/admin/ontologies/${ASCII.ontology_dir}`,
      query: { scenario: ASCII.scenario },
    });
    expect(again.statusCode).toBe(404);

    const noScenario = await fx.app.inject({
      method: 'DELETE',
      url: `/api/admin/ontologies/${ASCII.ontology_dir}`,
    });
    expect(noScenario.statusCode).toBe(400);
  });

  /**
   * 中文路径删除：**环境相关**，但两种结果都必须自洽（2026-10-03）。
   *
   * - 宿主能删（Linux 容器等）→ 204，记录消失；
   * - 宿主删不掉（Windows 对非 ASCII 路径存在 `fs.rmSync` 静默失败）→ 平台**不静默**：
   *   返回 503 `ADM_STORAGE_UNAVAILABLE` + 可读原因，且**记录仍在**（索引未被改写）——
   *   宁可不删，也不留"卡片没了、文件还在"的半删状态。
   */
  it('中文名本体删除：成功则 204；宿主限制下报可读 503 且不半删', async () => {
    await setup();
    await importOntology();

    const res = await fx.app.inject({
      method: 'DELETE',
      url: `/api/admin/ontologies/${encodeURIComponent(ONTOLOGY)}`,
      query: { scenario: SCENARIO },
    });

    if (res.statusCode === 204) {
      const detail = await fx.app.inject({
        method: 'GET',
        url: `/api/admin/ontologies/${encodeURIComponent(ONTOLOGY)}`,
        query: { scenario: SCENARIO },
      });
      expect(detail.statusCode).toBe(404);
    } else {
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('ADM_STORAGE_UNAVAILABLE');
      expect(res.json().error.message).toContain('手工删除');
      // 不半删：记录仍在，且市场状态仍为 unchanged（索引没被改写）
      const detail = await fx.app.inject({
        method: 'GET',
        url: `/api/admin/ontologies/${encodeURIComponent(ONTOLOGY)}`,
        query: { scenario: SCENARIO },
      });
      expect(detail.statusCode).toBe(200);
      const market = await fx.app.inject({ method: 'GET', url: '/api/admin/ontologies/onto-market' });
      const item = market.json().items.find((i: { ontology_dir: string }) => i.ontology_dir === ONTOLOGY);
      expect(item.status).toBe('unchanged');
    }
  });
});

describe('GET /api/admin/ontologies/onto-market（§10.4）', () => {
  it('未配置 ONTO_MARKET_DIR → configured=false（不报错）', async () => {
    await setup(false);
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/ontologies/onto-market' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ configured: false, items: [] });
    expect(res.json().reason).toContain('ONTO_MARKET_DIR');
  });

  it('状态流转：new → 导入后 unchanged → 市场文件改动后 changed', async () => {
    await setup();
    const before = await fx.app.inject({ method: 'GET', url: '/api/admin/ontologies/onto-market' });
    expect(before.json().items[0]).toMatchObject({ scenario: SCENARIO, status: 'new' });

    await importOntology();
    const after = await fx.app.inject({ method: 'GET', url: '/api/admin/ontologies/onto-market' });
    expect(after.json().items[0].status).toBe('unchanged');

    writeMarket(ONTOLOGY, YAML.replace('v1.0', 'v1.1'));
    const changed = await fx.app.inject({ method: 'GET', url: '/api/admin/ontologies/onto-market' });
    expect(changed.json().items[0].status).toBe('changed');
  });

  it('缺 ontology.yaml 的二级目录 → invalid（单条失效不影响整体）', async () => {
    await setup();
    fs.mkdirSync(path.join(marketDir!, SCENARIO, '无正文'), { recursive: true });

    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/ontologies/onto-market' });
    const broken = res.json().items.find((item: { ontology_dir: string }) => item.ontology_dir === '无正文');
    expect(broken.status).toBe('invalid');
    expect(broken.invalid_reason).toContain('ontology.yaml');
  });
});

describe('POST /api/admin/ontologies/onto-market/import（§10.5）', () => {
  it('导入 201：落盘 onto_market/{场景}/{本体}/ontology.yaml，内容与市场一致', async () => {
    await setup();
    const res = await importOntology();

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      scenario: SCENARIO,
      ontology_dir: ONTOLOGY,
      name: ONTOLOGY,
      overwritten: false,
    });
    expect(fs.readFileSync(savedFile(), 'utf8')).toBe(YAML);
  });

  it('重复导入 → 409 ADM_ONTOLOGY_EXISTS；缺参数 → 400', async () => {
    await setup();
    await importOntology();

    const again = await importOntology();
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ADM_ONTOLOGY_EXISTS');

    const missing = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/ontologies/onto-market/import',
      payload: { scenario: SCENARIO },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('导入**不触碰**本体市场：整棵市场树逐字节不变（对市场只读）', async () => {
    await setup();
    const beforeMarket = snapshotTree(marketDir!);

    await importOntology();
    await updateOntology();

    expect(snapshotTree(marketDir!)).toEqual(beforeMarket);
  });
});

describe('POST /api/admin/ontologies/onto-market/update（§10.6）', () => {
  it('更新 200：overwritten=true、installed_at 保留、正文换为市场新版本', async () => {
    await setup();
    const imported = (await importOntology()).json();

    writeMarket(ONTOLOGY, YAML.replace('v1.0', 'v2.0'));
    const res = await updateOntology();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ overwritten: true, installed_at: imported.installed_at });
    expect(fs.readFileSync(savedFile(), 'utf8')).toContain('v2.0');
  });

  it('库内不存在 → 400 VALIDATION_FAILED（提示先导入）', async () => {
    await setup();
    const res = await updateOntology();

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });
});

describe('只读保证（FR-059）', () => {
  it('平台不提供任何编辑本体的端点：PUT/PATCH → 404；库内文件内容不因读取而变', async () => {
    await setup();
    await importOntology();
    const before = fs.readFileSync(savedFile(), 'utf8');

    for (const method of ['PUT', 'PATCH'] as const) {
      const res = await fx.app.inject({
        method,
        url: `/api/admin/ontologies/${encodeURIComponent(ONTOLOGY)}`,
        query: { scenario: SCENARIO },
        payload: { content: 'metadata: {}' },
      });
      expect(res.statusCode).toBe(404);
    }
    expect(fs.readFileSync(savedFile(), 'utf8')).toBe(before);
  });
});

/* 安全管控（securities.yaml）的用例已迁至同目录 `ontologies-securities.spec.ts` */
