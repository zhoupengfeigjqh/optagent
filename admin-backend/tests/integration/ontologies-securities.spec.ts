/**
 * 集成测试：本体安全管控同步（2026-10-03 扩展，契约 §10）
 *
 * 独立成文件的原因：`ontologies.spec.ts` 触 500 行门禁（原则二），
 * 与主体端点用例分居两个文件，夹具各自自洽。
 *
 * 覆盖：`securities.yaml` 随本体一并导入/更新（**必需文件**，2026-10-17 起）、
 * 详情 `securities_content` 全文、市场仅改安全管控即 `changed`、
 * 市场缺少/移除该文件时该条 `invalid` 且导入/更新被拒、删除本体连带清除。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTree } from '../../src/infra/fs-remove.js';
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

/**
 * 生成与市场路径**完全一致**的 ontology.yaml（metadata 即身份，入库强校验）。
 */
function yamlFor(scenario: string, ontologyDir: string): string {
  return YAML.replace(`scenario_name: ${SCENARIO}`, `scenario_name: ${scenario}`).replace(
    `ontology_name: ${ONTOLOGY}`,
    `ontology_name: ${ontologyDir}`,
  );
}

/** 行为安全管控样例（必需文件：原样同步，平台不解析其语义） */
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

function writeMarket(
  ontologyDir: string,
  content: string,
  scenario = SCENARIO,
  withSecurities = true,
): void {
  const dir = path.join(marketDir!, scenario, ontologyDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ontology.yaml'), content);
  // 2026-10-17：securities.yaml 为必需文件；测"缺文件"的用例传 false
  if (withSecurities) fs.writeFileSync(path.join(dir, 'securities.yaml'), SECURITIES);
}

/**
 * 写/删市场侧的安全管控文件（`null` = 删掉，模拟本体未配置或后续移除）。
 *
 * 删除走 `removeTree`（见 `src/infra/fs-remove.ts`）：修复前用 `fs.rmSync` 删含非 ASCII
 * 段的路径会**静默不删**，残留会让"移除"用例变成假失败。改后中文场景/目录名也能真删。
 */
function writeMarketSecurities(ontologyDir: string, content: string | null, scenario = SCENARIO): void {
  const file = path.join(marketDir!, scenario, ontologyDir, 'securities.yaml');
  if (content === null) {
    removeTree(file);
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

    const imported = await importOntology();
    expect(imported.statusCode).toBe(201);
    expect(fs.readFileSync(savedSecurities(), 'utf8')).toBe(SECURITIES);

    const listItem = (await fx.app.inject({ method: 'GET', url: '/api/admin/ontologies' })).json().items[0];
    // 列表仍不下发正文（含安全管控正文）
    expect(listItem).not.toHaveProperty('content');
    expect(listItem).not.toHaveProperty('securities_content');
    expect(listItem).not.toHaveProperty('has_securities');

    const detail = await fx.app.inject({
      method: 'GET',
      url: `/api/admin/ontologies/${encodeURIComponent(SCENARIO)}/${encodeURIComponent(ONTOLOGY)}`,
    });
    expect(detail.json().securities_content).toBe(SECURITIES);
    expect(detail.json().securities_size).toBe(Buffer.byteLength(SECURITIES, 'utf8'));
  });

  it('市场缺 securities.yaml → 该条 invalid，导入被拒（400）', async () => {
    // 该用例需要"市场里只有 ontology.yaml"，故自建市场而不走默认 setup
    marketDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-sec-'));
    writeMarket(ONTOLOGY, YAML, SCENARIO, false);
    fx = await createFixture({ env: { ONTO_MARKET_DIR: marketDir } });

    const market = await fx.app.inject({ method: 'GET', url: '/api/admin/ontologies/onto-market' });
    expect(market.json().items[0]).toMatchObject({ status: 'invalid' });
    expect(market.json().items[0].invalid_reason).toContain('securities.yaml');

    const res = await importOntology();
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });
});

describe('安全管控同步 securities.yaml（§10.4 / §10.6）', () => {
  it('市场只改 securities.yaml → changed；更新后同步进库并回 unchanged', async () => {
    await setup();
    await importOntology();
    expect(await marketStatus()).toBe('unchanged');

    const changed = SECURITIES.replace('请再次确认', '请再次核对');
    writeMarketSecurities(ONTOLOGY, changed);
    expect(await marketStatus()).toBe('changed');

    const res = await updateOntology();
    expect(res.statusCode).toBe(200);
    expect(fs.readFileSync(savedSecurities(), 'utf8')).toBe(changed);

    const market = await fx.app.inject({ method: 'GET', url: '/api/admin/ontologies/onto-market' });
    expect(market.json().items[0]).toMatchObject({ status: 'unchanged' });
  });

  it('市场移除该文件 → 该条 invalid、更新被拒；库内副本保留（无半更新）', async () => {
    // 本用例要真删文件（市场侧），用 ASCII 名避开 Windows 对非 ASCII 路径的删除限制
    const ASCII = { scenario: 'demo-scenario', ontology_dir: 'demo-ontology' };
    await setup();
    writeMarket(ASCII.ontology_dir, yamlFor(ASCII.scenario, ASCII.ontology_dir), ASCII.scenario);
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
    const market = await fx.app.inject({ method: 'GET', url: '/api/admin/ontologies/onto-market' });
    expect(market.json().items[0]).toMatchObject({ status: 'invalid' });

    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/ontologies/onto-market/update',
      payload: ASCII,
    });
    expect(res.statusCode).toBe(400);
    // 拒绝发生在写入之前：库内仍是完整快照
    expect(fs.existsSync(saved)).toBe(true);
  });

  it('删除本体一并清掉安全管控文件（目录整体移除）', async () => {
    await setup();
    await importOntology();

    const res = await fx.app.inject({
      method: 'DELETE',
      url: `/api/admin/ontologies/${encodeURIComponent(SCENARIO)}/${encodeURIComponent(ONTOLOGY)}`,
    });

    // 中文路径同样真删（`removeTree` 兜底，2026-10-09）：不留"卡片没了、文件还在"的半删状态
    expect(res.statusCode).toBe(204);
    expect(fs.existsSync(savedSecurities())).toBe(false);
  });
});
