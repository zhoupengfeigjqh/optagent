/**
 * 单元测试：物化期的术语字典（017）。
 *
 * 与 `materialize.spec.ts` 分居的理由：那边已接近 500 行门禁（原则二），
 * 而这里验证的是**派生件随本体内容重算**这条独立口径：
 * 同一本体更新后重新物化，字典必须跟着变，不能沿用上一次的产物。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentDesignDocument } from '../../src/domain/config-center/agent-design.js';
import { buildAgentArtifact } from '../../src/domain/deploy/materialize.js';
import { McpServiceConfigService } from '../../src/domain/mcp/service-config.js';
import { OntologyStore } from '../../src/domain/ontology/store.js';
import { SkillLibraryService } from '../../src/domain/skill-library/install.js';
import { PlatformStore } from '../../src/infra/platform-store.js';
import { soulDesign } from '../helpers/soul.js';

const SCENARIO = '生产调度';
const ONTOLOGY = '原材料采购和库存';
const REF = `${SCENARIO}/${ONTOLOGY}`;
const DIR = `ontology/${SCENARIO}/${ONTOLOGY}`;

const SECURITIES = `securities:
- action_name: CreatePurchaseRecord
  op_type: command
`;

let root: string;
let store: PlatformStore;
let mcpConfigs: McpServiceConfigService;
let skills: SkillLibraryService;
let ontologies: OntologyStore;

/** 本体夹具：metadata 两段必须与库内路径一致，否则入库被拒 */
function ontology(concepts: string): string {
  return `metadata:
  created_at: '2026-07-15 16:05:02'
  deployed_version: v1.0
  scenario_name: ${SCENARIO}
  scenario_id: 1
  ontology_name: ${ONTOLOGY}
  ontology_id: 1
concepts:
${concepts}`;
}

function design(): AgentDesignDocument {
  return {
    name: 'demo',
    soul: soulDesign('你是助手'),
    enabled_tools: ['read_file'],
    mcp_services: [],
    skills: [],
    ontologies: [REF],
    scenario: { scenario: '生产', data_prep_dirs: ['生产计划', '算法规则'] },
    updated_at: '2026-11-06T00:00:00.000Z',
  };
}

/** 按当前本体库内容物化一次，取该本体的术语字典原文 */
function mapping(): string {
  const artifact = buildAgentArtifact(design(), { mcpConfigs, skills, ontologies });
  const file = artifact.files.find((item) => item.relPath === `${DIR}/term_mapping.json`);
  if (!file) throw new Error('未产出 term_mapping.json');
  return String(file.content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'materialize-term-'));
  store = new PlatformStore(root);
  store.ensureLayout();
  mcpConfigs = new McpServiceConfigService(store);
  skills = new SkillLibraryService(store);
  ontologies = new OntologyStore(store);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('物化期术语字典', () => {
  it('按 concepts[].terms 生成，同 term 多义用「或」合并', () => {
    ontologies.install({
      scenario: SCENARIO,
      ontology_dir: ONTOLOGY,
      content: ontology(`- name: Supplier
  title: 供应商
  terms: [供应商信息]
- name: SupplierCode
  title: 供应商编号
  terms: [供应商编码, 供应商信息]
`),
      securities: SECURITIES,
    });

    expect(JSON.parse(mapping())).toEqual({
      供应商信息: '供应商或供应商编号',
      供应商编码: '供应商编号',
    });
  });

  it('本体更新后重新部署：字典随内容重算，不沿用上一次产物', () => {
    const pkg = (concepts: string) => ({
      scenario: SCENARIO,
      ontology_dir: ONTOLOGY,
      content: ontology(concepts),
      securities: SECURITIES,
    });
    ontologies.install(
      pkg(`- name: Supplier
  title: 供应商
  terms: [供应商信息]
`),
    );
    expect(JSON.parse(mapping())).toEqual({ 供应商信息: '供应商' });

    ontologies.update(
      pkg(`- name: Supplier
  title: 供应商
  terms: [供应商, 供应商信息]
`),
    );
    expect(JSON.parse(mapping())).toEqual({ 供应商: '供应商', 供应商信息: '供应商' });
  });

  it('terms 为空的本体产出空字典（当前存量本体的常态），不影响两个必需文件', () => {
    ontologies.install({
      scenario: SCENARIO,
      ontology_dir: ONTOLOGY,
      content: ontology(`- name: RawMaterial
  title: 原材料
  terms: []
`),
      securities: SECURITIES,
    });

    const artifact = buildAgentArtifact(design(), { mcpConfigs, skills, ontologies });
    const paths = artifact.files.map((item) => item.relPath);
    expect(paths).toContain(`${DIR}/ontology.yaml`);
    expect(paths).toContain(`${DIR}/securities.yaml`);
    expect(mapping()).toBe('{}\n');
  });
});
