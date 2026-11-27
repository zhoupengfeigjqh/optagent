import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentDesignDocument } from '../../src/domain/config-center/agent-design.js';
import { McpServiceConfigService } from '../../src/domain/mcp/service-config.js';
import { buildAgentArtifact, buildUserArtifacts } from '../../src/domain/deploy/materialize.js';
import { OntologyStore } from '../../src/domain/ontology/store.js';
import { SkillLibraryService } from '../../src/domain/skill-library/install.js';
import { PlatformStore } from '../../src/infra/platform-store.js';
import { zipFixture } from '../helpers/zip-fixture.js';
import { soulDesign } from '../helpers/soul.js';

let root: string;
let store: PlatformStore;
let mcpConfigs: McpServiceConfigService;
let skills: SkillLibraryService;
let ontologies: OntologyStore;

const OCR_URL = 'http://192.168.1.2:8000/mcp';

/** 本体夹具（2026-10-17）：metadata 的两个名字即身份，必须与库内路径一致 */
const ONTO_REF = '生产调度/原材料采购和库存';
const ONTO_YAML = `metadata:
  created_at: '2026-07-15 16:05:02'
  deployed_version: v1.0
  scenario_name: 生产调度
  scenario_id: 1
  ontology_name: 原材料采购和库存
  ontology_id: 1
concepts: []
`;
const ONTO_SECURITIES = `securities:
- action_name: CreatePurchaseRecord
  op_type: command
`;

function configure(name: string, overrides: Record<string, unknown> = {}): void {
  mcpConfigs.create({
    name,
    description: 'x',
    transport: 'http',
    url: OCR_URL,
    file_args: {},
    allowed_tools: ['ocr_image'],
    ...overrides,
  });
}

function design(overrides: Partial<AgentDesignDocument> = {}): AgentDesignDocument {
  return {
    name: 'demo',
    soul: soulDesign('你是助手\n第二行'),
    enabled_tools: ['read_file'],
    mcp_services: [],
    skills: [],
    ontologies: [],
    scenario: { scenario: '生产', data_prep_dirs: ['生产计划', '算法规则'] },
    updated_at: '2026-09-15T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'materialize-'));
  store = new PlatformStore(root);
  store.ensureLayout();
  mcpConfigs = new McpServiceConfigService(store);
  skills = new SkillLibraryService(store);
  ontologies = new OntologyStore(store);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('buildAgentArtifact —— 落盘格式与运行环境读取口径一致', () => {
  it('产出四件套（SOUL.md / TOOL.json / MCP.json / scenario.json）', () => {
    configure('ocr');
    const artifact = buildAgentArtifact(design({ mcp_services: ['ocr'] }), {
      mcpConfigs,
      skills,
      ontologies,
    });

    expect(artifact.files.map((f) => f.relPath).sort()).toEqual([
      'MCP.json',
      'SOUL.md',
      'TOOL.json',
      'scenario.json',
    ]);
    const soulMd = String(artifact.files.find((f) => f.relPath === 'SOUL.md')?.content);
    expect(soulMd.startsWith('---\nsoul_version: 1')).toBe(true);
    expect(soulMd).toContain('intro: 测试用简介');
    expect(soulMd).toContain('## 主要使命\n\n你是助手\n第二行');
    expect(JSON.parse(String(artifact.files.find((f) => f.relPath === 'TOOL.json')?.content))).toEqual({
      enabled: ['read_file'],
    });
    expect(JSON.parse(String(artifact.files.find((f) => f.relPath === 'scenario.json')?.content))).toEqual({
      scenario: '生产',
      data_prep_dirs: ['生产计划', '算法规则'],
    });
  });

  it('有字段约束时写入 data_prep_fields；无约束时**不写空壳键**', () => {
    const withFields = buildAgentArtifact(
      design({
        scenario: {
          scenario: '生产',
          data_prep_dirs: ['生产计划', '产线电价', '算法规则'],
          data_prep_fields: {
            生产计划: [{ name: '产线编号', type: 'string', required: true }],
          },
        },
      }),
      { mcpConfigs, skills, ontologies },
    );
    expect(JSON.parse(String(withFields.files.find((f) => f.relPath === 'scenario.json')?.content))).toEqual({
      scenario: '生产',
      data_prep_dirs: ['生产计划', '产线电价', '算法规则'],
      data_prep_fields: { 生产计划: [{ name: '产线编号', type: 'string', required: true }] },
    });

    // 空约束 ⇒ 与"字段缺失"等价，MUST NOT 在运行环境留下空壳键
    const noFields = buildAgentArtifact(
      design({
        scenario: {
          scenario: '生产',
          data_prep_dirs: ['生产计划', '算法规则'],
          data_prep_fields: {},
        },
      }),
      { mcpConfigs, skills, ontologies },
    );
    expect(JSON.parse(String(noFields.files.find((f) => f.relPath === 'scenario.json')?.content))).toEqual({
      scenario: '生产',
      data_prep_dirs: ['生产计划', '算法规则'],
    });
  });

  it('2026-10-13：有可上传类型时写入 data_prep_uploads；空对象 / 缺失时**不写空壳键**', () => {
    const scenarioJson = (artifact: ReturnType<typeof buildAgentArtifact>): unknown =>
      JSON.parse(String(artifact.files.find((f) => f.relPath === 'scenario.json')?.content));

    const withUploads = buildAgentArtifact(
      design({
        scenario: {
          scenario: '生产',
          data_prep_dirs: ['生产计划', '算法规则'],
          data_prep_uploads: { 生产计划: ['.csv', '.xlsx', '.txt'] },
        },
      }),
      { mcpConfigs, skills, ontologies },
    );
    expect(scenarioJson(withUploads)).toEqual({
      scenario: '生产',
      data_prep_dirs: ['生产计划', '算法规则'],
      data_prep_uploads: { 生产计划: ['.csv', '.xlsx', '.txt'] },
    });

    // 空对象 ⇒ 与"键缺失"等价（运行环境按平台默认处理），MUST NOT 留下空壳键
    const emptyUploads = buildAgentArtifact(
      design({
        scenario: {
          scenario: '生产',
          data_prep_dirs: ['生产计划', '算法规则'],
          data_prep_uploads: {},
        },
      }),
      { mcpConfigs, skills, ontologies },
    );
    expect(scenarioJson(emptyUploads)).toEqual({
      scenario: '生产',
      data_prep_dirs: ['生产计划', '算法规则'],
    });
  });

  it('007：下一步动作提示开关**只影响 SOUL.md 的两行 frontmatter**（开关 + 条数），正文与其余三件套逐字一致', () => {
    const off = buildAgentArtifact(
      design({ soul: soulDesign('你是助手\n第二行', { intent_focus: true }) }),
      { mcpConfigs, skills, ontologies },
    );
    const on = buildAgentArtifact(
      design({ soul: soulDesign('你是助手\n第二行', { intent_focus: true, next_action_hints: true }) }),
      { mcpConfigs, skills, ontologies },
    );

    const soulOf = (artifact: typeof off) =>
      String(artifact.files.find((f) => f.relPath === 'SOUL.md')?.content);
    const offMd = soulOf(off);
    const onMd = soulOf(on);

    expect(offMd).not.toContain('next_action_hints');
    expect(onMd).toContain('next_action_hints: true');
    expect(onMd).toContain('next_action_hints_count: 3');
    const stripSwitch = (md: string) =>
      md
        .split('\n')
        .filter((line) => !line.startsWith('next_action_hints'))
        .join('\n');
    expect(stripSwitch(onMd)).toBe(stripSwitch(offMd));
    expect(onMd.split('\n').length - offMd.split('\n').length).toBe(2);
    expect(onMd.slice(onMd.indexOf('## 主要使命'))).toBe(offMd.slice(offMd.indexOf('## 主要使命')));

    // 其余三件套与开关无关（配置面变更不得扩散到别的产物）
    for (const relPath of ['TOOL.json', 'MCP.json', 'scenario.json']) {
      expect(on.files.find((f) => f.relPath === relPath)?.content).toBe(
        off.files.find((f) => f.relPath === relPath)?.content,
      );
    }
  });

  it('027：两个新开关只影响 SOUL.md 的 frontmatter，关闭态产物与改造前逐字一致', () => {
    const soulOf = (artifact: ReturnType<typeof buildAgentArtifact>) =>
      String(artifact.files.find((f) => f.relPath === 'SOUL.md')?.content);
    const build = (extra: Parameters<typeof soulDesign>[1]) =>
      buildAgentArtifact(design({ soul: soulDesign('你是助手\n第二行', { intent_focus: true, ...extra }) }), {
        mcpConfigs,
        skills,
        ontologies,
      });

    const off = build({});
    const on = build({ input_rewrite: true, term_normalize: true });
    const offMd = soulOf(off);
    const onMd = soulOf(on);

    expect(offMd).not.toContain('input_rewrite');
    expect(offMd).not.toContain('term_normalize');
    expect(onMd).toContain('input_rewrite: true');
    expect(onMd).toContain('term_normalize: true');

    expect(onMd.split('\n').length - offMd.split('\n').length).toBe(2);
    const stripSwitch = (md: string) =>
      md
        .split('\n')
        .filter((line) => !line.startsWith('input_rewrite') && !line.startsWith('term_normalize'))
        .join('\n');
    expect(stripSwitch(onMd)).toBe(stripSwitch(offMd));

    expect(onMd.slice(onMd.indexOf('## 主要使命'))).toBe(offMd.slice(offMd.indexOf('## 主要使命')));

    // 配置面变更不得扩散到别的产物
    for (const relPath of ['TOOL.json', 'MCP.json', 'scenario.json']) {
      expect(on.files.find((f) => f.relPath === relPath)?.content).toBe(
        off.files.find((f) => f.relPath === relPath)?.content,
      );
    }
  });

  it('027：意图聚焦关闭时两个新开关不物化（即使设计态值仍为 true）', () => {
    const artifact = buildAgentArtifact(
      design({
        soul: soulDesign('你是助手', {
          intent_focus: false,
          input_rewrite: true,
          term_normalize: true,
        }),
      }),
      { mcpConfigs, skills, ontologies },
    );
    const md = String(artifact.files.find((f) => f.relPath === 'SOUL.md')?.content);

    expect(md).not.toContain('intent_focus');
    expect(md).not.toContain('input_rewrite');
    expect(md).not.toContain('term_normalize');
  });

  it('未配置任何 MCP 服务时写空 servers 数组（MUST NOT 缺字段）', () => {
    const artifact = buildAgentArtifact(design(), { mcpConfigs, skills, ontologies });
    expect(JSON.parse(String(artifact.files.find((f) => f.relPath === 'MCP.json')?.content))).toEqual({
      servers: [],
    });
  });

  it('SKILL 是**整包物化**（含附件），而不只是 SKILL.md（SC-009）', async () => {
    await skills.install(
      zipFixture({
        'SKILL.md': '---\nname: pdf-parse\ndescription: 解析\n---\n\n正文\n',
        'ref/helper.md': '附件',
      }),
      { overwrite: false, source: 'a.zip' },
    );

    const artifact = buildAgentArtifact(design({ skills: ['pdf-parse'] }), {
      mcpConfigs,
      skills,
      ontologies,
    });
    const paths = artifact.files.map((f) => f.relPath);
    expect(paths).toContain('skills/pdf-parse/SKILL.md');
    expect(paths).toContain('skills/pdf-parse/ref/helper.md');
  });

  it('本体把**两个必需文件**整包复制到 ontology/{场景}/{本体}/（2026-10-17）', () => {
    ontologies.install({
      scenario: '生产调度',
      ontology_dir: '原材料采购和库存',
      content: ONTO_YAML,
      securities: ONTO_SECURITIES,
    });

    const artifact = buildAgentArtifact(design({ ontologies: [ONTO_REF] }), {
      mcpConfigs,
      skills,
      ontologies,
    });
    const dir = 'ontology/生产调度/原材料采购和库存';
    expect(artifact.files.find((f) => f.relPath === `${dir}/ontology.yaml`)?.content).toBe(ONTO_YAML);
    expect(artifact.files.find((f) => f.relPath === `${dir}/securities.yaml`)?.content).toBe(ONTO_SECURITIES);
    expect(artifact.files.find((f) => f.relPath === `${dir}/term_mapping.json`)?.content).toBe('{}\n');
  });

  it('形状非法的存量引用被跳过：不拼出三段路径，也不凭空造目录', () => {
    const artifact = buildAgentArtifact(design({ ontologies: ['场景/本体/多余段'] }), {
      mcpConfigs,
      skills,
      ontologies,
    });
    expect(artifact.files.map((f) => f.relPath)).toEqual([
      'SOUL.md',
      'TOOL.json',
      'MCP.json',
      'scenario.json',
    ]);
  });

  it('产物条目顺序稳定（SOUL → TOOL → MCP → scenario → skills）', () => {
    configure('ocr');
    const artifact = buildAgentArtifact(design({ mcp_services: ['ocr'] }), {
      mcpConfigs,
      skills,
      ontologies,
    });
    expect(artifact.files.slice(0, 4).map((f) => f.relPath)).toEqual([
      'SOUL.md',
      'TOOL.json',
      'MCP.json',
      'scenario.json',
    ]);
  });
});

describe('buildUserArtifacts', () => {
  it('按用户对每个数字人产出完整清单（整体覆盖语义）', () => {
    configure('ocr');
    const artifacts = buildUserArtifacts(
      [design({ name: 'a' }), design({ name: 'b', mcp_services: ['ocr'] })],
      { mcpConfigs, skills, ontologies },
    );
    expect(artifacts.map((a) => a.name)).toEqual(['a', 'b']);
    expect(artifacts[1]?.files.map((f) => f.relPath)).toContain('MCP.json');
  });

  it('边界：无数字人时产出空清单（调用方据此只做移除）', () => {
    expect(buildUserArtifacts([], { mcpConfigs, skills, ontologies })).toEqual([]);
  });
});
