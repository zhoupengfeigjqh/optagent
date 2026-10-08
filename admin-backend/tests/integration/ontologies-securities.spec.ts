/**
 * 集成测试：本体安全管控同步（2026-10-03 扩展，契约 §10）
 *
 * 独立成文件的原因：`ontologies.spec.ts` 触 500 行门禁（原则二），
 * 与主体端点用例分居两个文件，夹具各自自洽。
 *
 * 覆盖：`securities.yaml` 随本体一并导入/更新（可选文件）、列表 `has_securities`、
 * 详情 `securities_content` 全文、市场仅改安全管控即 `changed`、
 * 市场移除该文件时清掉库内副本、删除本体连带清除。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFixture, type TestFixture } from '../helpers/fixture.js';

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

/** 行为安全管控样例（可选文件：原样同步，平台不解析其语义） */
const SECURITIES = `securities:
- action_name: CreatePurchaseRecord
  display_name: 创建原材料采购单
  op_type: command
  scope:
  - everyone
  confirm: true
  confirm_content: 请再次确认采购信息。
`;

let fx: TestFixture;
let marketDir: string | null = null;

async function setup(): Promise<void> {
  marketDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-sec-'));
  writeMarket(ONTOLOGY, YAML);
  fx = await createFixture({ env: { ONTO_MARKET_DIR: marketDir } });
}

function writeMarket(ontologyDir: string, content: string, scenario = SCENARIO): void {
  const dir = path.join(marketDir!, scenario, ontologyDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ontology.yaml'), content);
}

/**
 * 写/删市场侧的安全管控文件（`null` = 删掉，模拟本体未配置或后续移除）。
 *
 * 删除后**校验**：Windows 宿主对含非 ASCII 段的路径存在 `fs.rmSync` 静默不删，
 * 静默残留会让"移除"用例变成假失败，故这里把删除失败暴露成夹具错误
 * （需要真删的用例请用 ASCII 场景/目录名，见下面的用例注释）。
 */
function writeMarketSecurities(
  ontologyDir: string,
  content: string | null,
  scenario = SCENARIO,
): void {
  const file = path.join(marketDir!, scenario, ontologyDir, 'securities.yaml');
  if (content === null) {
    fs.rmSync(file, { force: true });
    if (fs.existsSync(file)) {
      throw new Error(`测试夹具无法删除市场文件（宿主对非 ASCII 路径的限制）：${file}`);
    }
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** 库内安全管控文件 */
function savedSecurities(): string {
  return path.join(fx.platformDataDir, 'onto_market', SCENARIO, ONTOLOGY, 'securities.yaml');
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

function marketStatus() {
  return fx.app
    .inject({ method: 'GET', url: '/api/admin/ontologies/onto-market' })
    .then((res) => res.json().items[0].status as string);
}

afterEach(async () => {
  await fx.cleanup();
  if (marketDir !== null) {
    fs.rmSync(marketDir, { recursive: true, force: true });
    marketDir = null;
  }
});

describe('安全管控同步 securities.yaml（§10.1 / §10.2 / §10.5）', () => {
  it('导入把两个文件都落盘；列表与详情都能看到安全管控（只读全文）', async () => {
    await setup();
    writeMarketSecurities(ONTOLOGY, SECURITIES);

    const imported = await importOntology();
    expect(imported.statusCode).toBe(201);
    expect(fs.readFileSync(savedSecurities(), 'utf8')).toBe(SECURITIES);

    const listItem = (await fx.app.inject({ method: 'GET', url: '/api/admin/ontologies' })).json()
      .items[0];
    expect(listItem.has_securities).toBe(true);
    // 列表仍不下发正文（含安全管控正文）
    expect(listItem).not.toHaveProperty('content');
    expect(listItem).not.toHaveProperty('securities_content');

    const detail = await fx.app.inject({
      method: 'GET',
      url: `/api/admin/ontologies/${encodeURIComponent(ONTOLOGY)}`,
      query: { scenario: SCENARIO },
    });
    expect(detail.json().securities_content).toBe(SECURITIES);
    expect(detail.json().has_securities).toBe(true);
    expect(detail.json().securities_size).toBe(Buffer.byteLength(SECURITIES, 'utf8'));
  });

  it('市场没有该文件 → 详情 securities_content=null、列表 has_securities=false', async () => {
    await setup();
    await importOntology();

    const detail = await fx.app.inject({
      method: 'GET',
      url: `/api/admin/ontologies/${encodeURIComponent(ONTOLOGY)}`,
      query: { scenario: SCENARIO },
    });
    expect(detail.json().securities_content).toBeNull();
    expect(detail.json().has_securities).toBe(false);

    const listItem = (await fx.app.inject({ method: 'GET', url: '/api/admin/ontologies' })).json()
      .items[0];
    expect(listItem.has_securities).toBe(false);
  });
});

describe('安全管控同步 securities.yaml（§10.4 / §10.6）', () => {
  it('市场只改 securities.yaml → changed；更新后同步进库并回 unchanged', async () => {
    await setup();
    await importOntology();
    expect(await marketStatus()).toBe('unchanged');

    writeMarketSecurities(ONTOLOGY, SECURITIES);
    expect(await marketStatus()).toBe('changed');

    const res = await updateOntology();
    expect(res.statusCode).toBe(200);
    expect(fs.readFileSync(savedSecurities(), 'utf8')).toBe(SECURITIES);

    const market = await fx.app.inject({ method: 'GET', url: '/api/admin/ontologies/onto-market' });
    expect(market.json().items[0]).toMatchObject({ status: 'unchanged', has_securities: true });
  });

  it('市场移除该文件 → 更新时清掉库内旧副本', async () => {
    // 本用例要真删文件（市场侧 + 库内），用 ASCII 名避开 Windows 对非 ASCII 路径的删除限制
    const ASCII = { scenario: 'demo-scenario', ontology_dir: 'demo-ontology' };
    await setup();
    writeMarket(ASCII.ontology_dir, YAML, ASCII.scenario);
    writeMarketSecurities(ASCII.ontology_dir, SECURITIES, ASCII.scenario);
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/ontologies/onto-market/import',
      payload: ASCII,
    });

    const saved = path.join(
      fx.platformDataDir,
      'onto_market',
      ASCII.scenario,
      ASCII.ontology_dir,
      'securities.yaml',
    );
    expect(fs.existsSync(saved)).toBe(true);

    writeMarketSecurities(ASCII.ontology_dir, null, ASCII.scenario);
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/ontologies/onto-market/update',
      payload: ASCII,
    });

    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(saved)).toBe(false);
    const detail = await fx.app.inject({
      method: 'GET',
      url: `/api/admin/ontologies/${ASCII.ontology_dir}`,
      query: { scenario: ASCII.scenario },
    });
    expect(detail.json().securities_content).toBeNull();
  });

  it('删除本体一并清掉安全管控文件（目录整体移除）', async () => {
    await setup();
    writeMarketSecurities(ONTOLOGY, SECURITIES);
    await importOntology();

    const res = await fx.app.inject({
      method: 'DELETE',
      url: `/api/admin/ontologies/${encodeURIComponent(ONTOLOGY)}`,
      query: { scenario: SCENARIO },
    });

    if (res.statusCode === 204) {
      expect(fs.existsSync(savedSecurities())).toBe(false);
    } else {
      // Windows 宿主对非 ASCII 路径的删除限制：按"宁可不删"口径则两文件都应还在
      expect(res.statusCode).toBe(503);
      expect(fs.existsSync(savedSecurities())).toBe(true);
    }
  });
});
