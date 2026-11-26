import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeTree } from '../../src/infra/fs-remove.js';
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

/** 本体夹具：两段身份必须与 metadata 完全一致，否则入库被拒 */
const ONTO_SCENARIO = '生产调度';
const ONTO_NAME = '原材料采购和库存';
const ONTO_YAML = `metadata:
  created_at: '2026-07-15 16:05:02'
  deployed_version: v1.0
  scenario_name: ${ONTO_SCENARIO}
  scenario_id: 1
  ontology_name: ${ONTO_NAME}
  ontology_id: 1
concepts: []
`;
const ONTO_SECURITIES = `securities:
- action_name: CreatePurchaseRecord
  op_type: command
`;

function installOntology(): void {
  fx.ctx.ontologies.install({
    scenario: ONTO_SCENARIO,
    ontology_dir: ONTO_NAME,
    content: ONTO_YAML,
    securities: ONTO_SECURITIES,
  });
}

function libraryOntologyDir(): string {
  return path.join(fx.platformDataDir, 'onto_market', ONTO_SCENARIO, ONTO_NAME);
}

async function linkOntologyAgent(): Promise<void> {
  installOntology();
  await createAgent(baseAgent({ name: 'onto', ontologies: [`${ONTO_SCENARIO}/${ONTO_NAME}`] }));
  fx.ctx.users.update('admin', ['demo', 'onto'], fx.ctx.store.revision());
}

function revision(): number {
  return fx.ctx.store.revision();
}

beforeEach(async () => {
  fx = await createFixture({ userIds: ['admin'] });
  fx.runtime.tools = TOOL_FIXTURE;
  configureMcp();
  await createAgent(baseAgent());
  fx.ctx.users.create('admin', ['demo'], fx.ctx.store.revision());
});

afterEach(async () => {
  await fx.cleanup();
});

describe('POST /api/admin/deploy —— 本体物化', () => {
  it('ontology/{场景}/{本体}/ 下两个必需文件与库内逐字节一致，且与 skills/ 平级', async () => {
    await linkOntologyAgent();
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: ['admin'], revision: revision() },
    });
    expect(res.statusCode).toBe(200);

    const dir = path.join(
      fx.optAgentRoot,
      'users',
      'admin',
      'agents',
      'onto',
      'ontology',
      ONTO_SCENARIO,
      ONTO_NAME,
    );
    expect(fs.readdirSync(dir).sort()).toEqual([
      'ontology.yaml',
      'securities.yaml',
      'term_mapping.json',
    ]);
    expect(fs.readFileSync(path.join(dir, 'ontology.yaml'), 'utf8')).toBe(ONTO_YAML);
    expect(fs.readFileSync(path.join(dir, 'securities.yaml'), 'utf8')).toBe(ONTO_SECURITIES);
    expect(fs.readFileSync(path.join(dir, 'term_mapping.json'), 'utf8')).toBe('{}\n');
    expect(fs.readdirSync(path.join(fx.optAgentRoot, 'users', 'admin', 'agents', 'onto')).sort()).toEqual([
      'MCP.json',
      'SOUL.md',
      'TOOL.json',
      'ontology',
      'scenario.json',
    ]);
  });
});

describe('本体库快照完整性（2026-10-17）', () => {
  it('库内缺 securities.yaml → 预检失败并给出可读原因，部署零写入', async () => {
    await linkOntologyAgent();
    removeTree(path.join(libraryOntologyDir(), 'securities.yaml'));

    const validate = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy/validate',
      payload: { user_ids: ['admin'] },
    });
    expect(validate.json().passed).toBe(false);
    const errors = validate.json().errors as Array<Record<string, string>>;
    expect(errors[0]).toMatchObject({
      agent_name: 'onto',
      category: 'reference_validity',
      code: 'ADM_ONTOLOGY_NOT_FOUND',
    });
    expect(errors[0]!.detail).toContain('securities.yaml');

    const before = snapshotTree(path.join(fx.optAgentRoot, 'users'));
    const deploy = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { user_ids: ['admin'], revision: revision() },
    });
    expect(deploy.json().error.code).toBe('ADM_ONTOLOGY_NOT_FOUND');
    expect(snapshotTree(path.join(fx.optAgentRoot, 'users'))).toEqual(before);
  });
});
