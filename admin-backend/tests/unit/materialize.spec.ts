/**
 * 单元测试：物化映射（`FR-026`、`FR-044`、`FR-056`，`data-model.md` §8）
 *
 * 守住两条最容易出错的口径：
 * ① `MCP.json` 的 `url` **按目标运行形态取值**，缺该形态时**不回退**；
 * ② 落盘格式与运行环境的读取口径一致（写能力必须带权限边界）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentDesignDocument } from '../../src/domain/config-center/agent-design.js';
import { McpServiceConfigService } from '../../src/domain/mcp/service-config.js';
import { buildAgentArtifact, buildMcpServerEntry, buildUserArtifacts } from '../../src/domain/deploy/materialize.js';
import { SkillLibraryService } from '../../src/domain/skill-library/install.js';
import { PlatformStore } from '../../src/infra/platform-store.js';
import { zipFixture } from '../helpers/zip-fixture.js';

let root: string;
let store: PlatformStore;
let mcpConfigs: McpServiceConfigService;
let skills: SkillLibraryService;

const BOTH_FORMS = {
  container_network: 'http://ocr:8000/mcp',
  host_local: 'http://127.0.0.1:8000/mcp',
};

function configure(name: string, overrides: Record<string, unknown> = {}): void {
  mcpConfigs.upsert(
    name,
    {
      description: 'x',
      transport: 'http',
      endpoints: BOTH_FORMS,
      file_args: {},
      ...overrides,
    },
    store.revision(),
  );
}

function design(overrides: Partial<AgentDesignDocument> = {}): AgentDesignDocument {
  return {
    name: 'demo',
    soul: '你是助手\n第二行\n',
    enabled_tools: ['read_file'],
    mcp_services: [],
    skills: [],
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
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('buildMcpServerEntry', () => {
  it('http：url 取**目标运行形态**的地址（FR-056）', () => {
    configure('ocr');
    const container = buildMcpServerEntry('ocr', {
      form: 'container_network',
      mcpConfigs,
      skills,
    });
    const hostLocal = buildMcpServerEntry('ocr', { form: 'host_local', mcpConfigs, skills });

    expect(container).toMatchObject({ name: 'ocr', transport: 'http', url: BOTH_FORMS.container_network });
    expect(hostLocal).toMatchObject({ url: BOTH_FORMS.host_local });
  });

  it('缺目标形态地址 → null（**不静默回退**到另一形态；由部署前校验拦截）', () => {
    configure('ocr', { endpoints: { host_local: BOTH_FORMS.host_local } });
    expect(buildMcpServerEntry('ocr', { form: 'container_network', mcpConfigs, skills })).toBeNull();
  });

  it('未配置的服务 → null（不凭空造一条声明）', () => {
    expect(buildMcpServerEntry('ghost', { form: 'container_network', mcpConfigs, skills })).toBeNull();
  });

  it('stdio：写 command 与 args，且不产生 url', () => {
    configure('local-mcp', {
      transport: 'stdio',
      endpoints: { container_network: 'stdio' },
      command: 'python',
      args: ['-u', 'srv.py'],
    });
    const entry = buildMcpServerEntry('local-mcp', {
      form: 'container_network',
      mcpConfigs,
      skills,
    });
    expect(entry).toMatchObject({ name: 'local-mcp', transport: 'stdio', command: 'python', args: ['-u', 'srv.py'] });
    expect(entry).not.toHaveProperty('url');
  });

  it('任何服务都不写 write / permission_boundary（writable 已按 2026-09-15 产品决定移除）', () => {
    configure('ocr', { writable: true, permission_scope: '仅图片识别' });
    const entry = buildMcpServerEntry('ocr', { form: 'container_network', mcpConfigs, skills })!;
    expect(entry).not.toHaveProperty('write');
    expect(entry).not.toHaveProperty('permission_boundary');
  });

  it('file_args 为空时不写该字段（保持产物精简）', () => {
    configure('ocr');
    expect(buildMcpServerEntry('ocr', { form: 'container_network', mcpConfigs, skills })).not.toHaveProperty(
      'file_args',
    );
  });

  it('file_args 非空时原样透传', () => {
    configure('ocr', { file_args: { ocr_image: { image: 'url' } } });
    expect(
      buildMcpServerEntry('ocr', { form: 'container_network', mcpConfigs, skills })?.file_args,
    ).toEqual({ ocr_image: { image: 'url' } });
  });

  it('取值路径原样物化到 MCP.json（对象数组里的字段，2026-09-16）', () => {
    configure('parse', {
      file_args: { parse_excel_files: { 'items[].excelFileUrl': 'url' } },
    });

    expect(
      buildMcpServerEntry('parse', { form: 'container_network', mcpConfigs, skills })?.file_args,
    ).toEqual({ parse_excel_files: { 'items[].excelFileUrl': 'url' } });
  });

  it('confirmation 为 never/缺省时不写该字段（运行环境缺省语义，产物精简）', () => {
    configure('ocr');
    expect(
      buildMcpServerEntry('ocr', { form: 'container_network', mcpConfigs, skills }),
    ).not.toHaveProperty('confirmation');
  });

  it('confirmation 为 always / { tools } 时原样物化到 MCP.json（HITL 下发）', () => {
    configure('svc-a', { confirmation: 'always' });
    configure('svc-b', { confirmation: { tools: ['query_price'] } });

    expect(
      buildMcpServerEntry('svc-a', { form: 'container_network', mcpConfigs, skills })?.confirmation,
    ).toBe('always');
    expect(
      buildMcpServerEntry('svc-b', { form: 'container_network', mcpConfigs, skills })?.confirmation,
    ).toEqual({ tools: ['query_price'] });
  });

  it('rules_fields 缺省为 {}：不写该字段（产物精简）；声明后按工具映射物化到 MCP.json', () => {
    configure('ocr');
    expect(
      buildMcpServerEntry('ocr', { form: 'container_network', mcpConfigs, skills }),
    ).not.toHaveProperty('rules_fields');

    configure('svc-rules', { rules_fields: { optimize: 'rules' } });
    expect(
      buildMcpServerEntry('svc-rules', { form: 'container_network', mcpConfigs, skills })
        ?.rules_fields,
    ).toEqual({ optimize: 'rules' });
  });

  it('async_tools 缺省为 []：不写该字段（产物精简）；声明后原样物化到 MCP.json（R11）', () => {
    configure('ocr');
    expect(
      buildMcpServerEntry('ocr', { form: 'container_network', mcpConfigs, skills }),
    ).not.toHaveProperty('async_tools');

    configure('svc-async', { async_tools: ['submit_job', 'get_status'] });
    expect(
      buildMcpServerEntry('svc-async', { form: 'container_network', mcpConfigs, skills })
        ?.async_tools,
    ).toEqual(['submit_job', 'get_status']);
  });
});

describe('buildAgentArtifact —— 落盘格式与运行环境读取口径一致', () => {
  it('产出四件套（SOUL.md / TOOL.json / MCP.json / scenario.json）', () => {
    configure('ocr');
    const artifact = buildAgentArtifact(design({ mcp_services: ['ocr'] }), {
      form: 'container_network',
      mcpConfigs,
      skills,
    });

    expect(artifact.files.map((f) => f.relPath).sort()).toEqual([
      'MCP.json',
      'SOUL.md',
      'TOOL.json',
      'scenario.json',
    ]);
    expect(artifact.files.find((f) => f.relPath === 'SOUL.md')?.content).toBe('你是助手\n第二行\n');
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
      { form: 'container_network', mcpConfigs, skills },
    );
    expect(
      JSON.parse(String(withFields.files.find((f) => f.relPath === 'scenario.json')?.content)),
    ).toEqual({
      scenario: '生产',
      data_prep_dirs: ['生产计划', '产线电价', '算法规则'],
      data_prep_fields: { 生产计划: [{ name: '产线编号', type: 'string', required: true }] },
    });

    // 空约束 ⇒ 与"字段缺失"等价，MUST NOT 在运行环境留下空壳键
    const noFields = buildAgentArtifact(
      design({
        scenario: { scenario: '生产', data_prep_dirs: ['生产计划', '算法规则'], data_prep_fields: {} },
      }),
      { form: 'container_network', mcpConfigs, skills },
    );
    expect(
      JSON.parse(String(noFields.files.find((f) => f.relPath === 'scenario.json')?.content)),
    ).toEqual({ scenario: '生产', data_prep_dirs: ['生产计划', '算法规则'] });
  });

  it('未配置任何 MCP 服务时写空 servers 数组（MUST NOT 缺字段）', () => {
    const artifact = buildAgentArtifact(design(), { form: 'container_network', mcpConfigs, skills });
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
      form: 'container_network',
      mcpConfigs,
      skills,
    });
    const paths = artifact.files.map((f) => f.relPath);
    expect(paths).toContain('skills/pdf-parse/SKILL.md');
    expect(paths).toContain('skills/pdf-parse/ref/helper.md');
  });

  it('产物条目顺序稳定（SOUL → TOOL → MCP → scenario → skills）', () => {
    configure('ocr');
    const artifact = buildAgentArtifact(design({ mcp_services: ['ocr'] }), {
      form: 'container_network',
      mcpConfigs,
      skills,
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
      { form: 'container_network', mcpConfigs, skills },
    );
    expect(artifacts.map((a) => a.name)).toEqual(['a', 'b']);
    expect(artifacts[1]?.files.map((f) => f.relPath)).toContain('MCP.json');
  });

  it('边界：无数字人时产出空清单（调用方据此只做移除）', () => {
    expect(buildUserArtifacts([], { form: 'container_network', mcpConfigs, skills })).toEqual([]);
  });
});
