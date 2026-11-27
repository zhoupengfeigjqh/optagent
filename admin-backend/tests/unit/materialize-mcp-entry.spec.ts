/**
 * 单元测试：buildMcpServerEntry（MCP 声明物化口径）
 *
 * 由 materialize.spec.ts 拆出（原则二：单文件 ≤500 行）。落盘格式与用户产物仍在原文件。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServerEntry } from '../../src/domain/deploy/materialize.js';
import { McpServiceConfigService } from '../../src/domain/mcp/service-config.js';
import { OntologyStore } from '../../src/domain/ontology/store.js';
import { SkillLibraryService } from '../../src/domain/skill-library/install.js';
import { PlatformStore } from '../../src/infra/platform-store.js';

let root: string;
let store: PlatformStore;
let mcpConfigs: McpServiceConfigService;
let skills: SkillLibraryService;
let ontologies: OntologyStore;

const OCR_URL = 'http://192.168.1.2:8000/mcp';

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

describe('buildMcpServerEntry', () => {
  it('http：url 取配置里的单一连接地址', () => {
    configure('ocr');
    const entry = buildMcpServerEntry('ocr', { mcpConfigs, skills, ontologies });
    expect(entry).toMatchObject({ name: 'ocr', transport: 'http', url: OCR_URL });
  });

  it('未配置的服务 → null（不凭空造一条声明）', () => {
    expect(buildMcpServerEntry('ghost', { mcpConfigs, skills, ontologies })).toBeNull();
  });

  it('stdio：写 command 与 args，且不产生 url', () => {
    configure('local-mcp', {
      transport: 'stdio',
      url: undefined,
      command: 'python',
      args: ['-u', 'srv.py'],
    });
    const entry = buildMcpServerEntry('local-mcp', { mcpConfigs, skills, ontologies });
    expect(entry).toMatchObject({
      name: 'local-mcp',
      transport: 'stdio',
      command: 'python',
      args: ['-u', 'srv.py'],
    });
    expect(entry).not.toHaveProperty('url');
  });

  it('任何服务都不写 write / permission_boundary（writable 已按 2026-09-15 产品决定移除）', () => {
    configure('ocr', { writable: true, permission_scope: '仅图片识别' });
    const entry = buildMcpServerEntry('ocr', { mcpConfigs, skills, ontologies })!;
    expect(entry).not.toHaveProperty('write');
    expect(entry).not.toHaveProperty('permission_boundary');
  });

  it('file_args 为空时不写该字段（保持产物精简）', () => {
    configure('ocr');
    expect(buildMcpServerEntry('ocr', { mcpConfigs, skills, ontologies })).not.toHaveProperty('file_args');
  });

  it('file_args 非空时原样透传', () => {
    configure('ocr', { file_args: { ocr_image: { image: 'url' } } });
    expect(buildMcpServerEntry('ocr', { mcpConfigs, skills, ontologies })?.file_args).toEqual({
      ocr_image: { image: 'url' },
    });
  });

  it('headers 为空时不写该字段（保持产物精简，与 file_args 同口径）', () => {
    configure('ocr');
    expect(buildMcpServerEntry('ocr', { mcpConfigs, skills, ontologies })).not.toHaveProperty('headers');
  });

  it('headers 非空时**以明文**物化到 MCP.json（运行环境要按原样发送；掩码只用于回显）', () => {
    const token = '6UuE8_4nY683gZ13rNQbHDCfxgMgEF3Z';
    configure('ocr', { headers: { 'X-MCP-Token': token } });
    expect(buildMcpServerEntry('ocr', { mcpConfigs, skills, ontologies })?.headers).toEqual({
      'X-MCP-Token': token,
    });
  });

  it('取值路径原样物化到 MCP.json（对象数组里的字段，2026-09-16）', () => {
    configure('parse', {
      file_args: { parse_excel_files: { 'items[].excelFileUrl': 'url' } },
    });

    expect(buildMcpServerEntry('parse', { mcpConfigs, skills, ontologies })?.file_args).toEqual({
      parse_excel_files: { 'items[].excelFileUrl': 'url' },
    });
  });

  it('confirmation 为 never/缺省时不写该字段（运行环境缺省语义，产物精简）', () => {
    configure('ocr');
    expect(buildMcpServerEntry('ocr', { mcpConfigs, skills, ontologies })).not.toHaveProperty('confirmation');
  });

  it('confirmation 为 always / { tools } 时原样物化到 MCP.json（HITL 下发）', () => {
    configure('svc-a', { confirmation: 'always' });
    configure('svc-b', { confirmation: { tools: ['query_price'] } });

    expect(buildMcpServerEntry('svc-a', { mcpConfigs, skills, ontologies })?.confirmation).toBe('always');
    expect(buildMcpServerEntry('svc-b', { mcpConfigs, skills, ontologies })?.confirmation).toEqual({
      tools: ['query_price'],
    });
  });

  it('rules_fields 缺省为 {}：不写该字段（产物精简）；声明后按工具映射物化到 MCP.json', () => {
    configure('ocr');
    expect(buildMcpServerEntry('ocr', { mcpConfigs, skills, ontologies })).not.toHaveProperty('rules_fields');

    configure('svc-rules', { rules_fields: { optimize: 'rules' } });
    expect(buildMcpServerEntry('svc-rules', { mcpConfigs, skills, ontologies })?.rules_fields).toEqual({
      optimize: 'rules',
    });
  });

  it('工具白名单：非空才写进 MCP.json（运行环境据此只挂这些工具）', () => {
    configure('svc-allowed', { allowed_tools: ['ocr_image', 'query_price'] });
    expect(buildMcpServerEntry('svc-allowed', { mcpConfigs, skills, ontologies })?.allowed_tools).toEqual([
      'ocr_image',
      'query_price',
    ]);
  });

  it('工具白名单为空（存量记录）= 不限制：不写该字段（运行环境放行全部工具）', () => {
    store.writeJson('mcp-services.json', {
      items: {
        'svc-open': { name: 'svc-open', description: 'x', transport: 'http', url: OCR_URL },
      },
    });
    expect(buildMcpServerEntry('svc-open', { mcpConfigs, skills, ontologies })).not.toHaveProperty(
      'allowed_tools',
    );
  });

  it('async_tools（2026-10-17 移除）：存量文档里的该键 MUST NOT 物化进 MCP.json', () => {
    store.writeJson('mcp-services.json', {
      items: {
        'svc-async': {
          name: 'svc-async',
          description: 'x',
          transport: 'http',
          url: OCR_URL,
          async_tools: ['submit_job', 'get_status'],
        },
      },
    });
    expect(buildMcpServerEntry('svc-async', { mcpConfigs, skills, ontologies })).not.toHaveProperty(
      'async_tools',
    );
  });

  it('tool_labels 缺省为 {}：不写该字段（产物精简）；配置后按工具映射物化', () => {
    configure('svc-labels-empty');
    expect(
      buildMcpServerEntry('svc-labels-empty', { mcpConfigs, skills, ontologies }),
    ).not.toHaveProperty('tool_labels');

    configure('svc-labels', { tool_labels: { ocr_image: '识别图片文字' } });
    expect(buildMcpServerEntry('svc-labels', { mcpConfigs, skills, ontologies })?.tool_labels).toEqual({
      ocr_image: '识别图片文字',
    });
  });

  it('tool_labels 按白名单过滤：未启用的工具不写进 MCP.json（孤儿键不下发）', () => {
    configure('svc-labels', {
      allowed_tools: ['ocr_image'],
      tool_labels: { ocr_image: '识别图片文字', query_price: '查询价格' },
    });
    expect(buildMcpServerEntry('svc-labels', { mcpConfigs, skills, ontologies })?.tool_labels).toEqual({
      ocr_image: '识别图片文字',
    });
  });
});
