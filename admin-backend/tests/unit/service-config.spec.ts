/**
 * 单元测试：MCP 服务级配置（`FR-044`、`FR-056`，`data-model.md` §3.2）
 *
 * 覆盖"同一服务只有一份配置"、按运行形态分别声明地址、以及五类校验的边界。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import { McpServiceConfigService } from '../../src/domain/mcp/service-config.js';
import { PlatformStore } from '../../src/infra/platform-store.js';

let root: string;
let store: PlatformStore;
let configs: McpServiceConfigService;

const BASE = {
  description: 'OCR 识别服务',
  transport: 'http' as const,
  endpoints: { container_network: 'http://ocr:8000/mcp' },
  file_args: { ocr_image: { image: 'url' } },
};

function upsert(overrides: Record<string, unknown> = {}): void {
  configs.upsert('ocr', { ...BASE, ...overrides }, store.revision());
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'service-config-'));
  store = new PlatformStore(root);
  store.ensureLayout();
  configs = new McpServiceConfigService(store);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('读写与索引', () => {
  it('初始为空', () => {
    expect(configs.listAll()).toEqual([]);
    expect(configs.readOrNull('ocr')).toBeNull();
    expect(configs.exists('ocr')).toBe(false);
  });

  it('保存后可按名称读取，且只有一份（FR-044）', () => {
    upsert();
    upsert({ description: '改后的用途' });

    expect(configs.listAll()).toHaveLength(1);
    expect(configs.read('ocr').description).toBe('改后的用途');
    expect(configs.exists('ocr')).toBe(true);
  });

  it('未配置时 read 抛 ADM_MCP_SERVICE_NOT_FOUND（与"配置为空"区分）', () => {
    let caught: unknown;
    try {
      configs.read('ghost');
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_MCP_SERVICE_NOT_FOUND);
  });

  it('listAll 按名称排序（列表稳定）', () => {
    configs.upsert('zeta', BASE, store.revision());
    configs.upsert('alpha', BASE, store.revision());
    expect(configs.listAll().map((c) => c.name)).toEqual(['alpha', 'zeta']);
  });

  it('文档损坏时按空清单处理（不抛错，保证平台可用）', () => {
    store.writeJson('mcp-services.json', { items: 'not-an-object' });
    expect(configs.listAll()).toEqual([]);
  });

  it('endpointFor 只返回该形态的非空地址（缺形态返回 null，供部署前校验拦截）', () => {
    upsert({ endpoints: { container_network: 'http://ocr:8000/mcp' } });
    expect(configs.endpointFor('ocr', 'container_network')).toBe('http://ocr:8000/mcp');
    expect(configs.endpointFor('ocr', 'host_local')).toBeNull();
    expect(configs.endpointFor('ghost', 'container_network')).toBeNull();
  });

  it('保存时递增 revision（乐观锁）', () => {
    const before = store.revision();
    upsert();
    expect(store.revision()).toBe(before + 1);
  });

  it('版本不符 → ADM_CONFIG_REVISION_CONFLICT，且不写入', () => {
    upsert();
    let caught: unknown;
    try {
      configs.upsert('ocr', { ...BASE, description: '不该生效' }, 1);
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_CONFIG_REVISION_CONFLICT);
    expect(configs.read('ocr').description).toBe(BASE.description);
  });
});

describe('校验', () => {
  it('transport 非法 → VALIDATION_FAILED', () => {
    expect(() => upsert({ transport: 'grpc' })).toThrow(ApiError);
  });

  it('transport 接受生态叫法 streamable-http，并归一到规范值 http（2026-09-16）', () => {
    // 管理员按 MCP 生态习惯写别名时不能拦住他（运行环境侧同样接受该别名）
    upsert({ transport: 'streamable-http' });
    expect(configs.read('ocr').transport).toBe('http');
    // 归一后再存一次，落盘文档里也只有规范值
    expect(store.readJson<{ items: Record<string, { transport: string }> }>('mcp-services.json')
      ?.items.ocr?.transport).toBe('http');
  });

  it('历史文档里写着别名时，读取即归一（界面与物化都只用规范值）', () => {
    store.writeJson('mcp-services.json', {
      items: { ocr: { ...BASE, transport: 'streamable-http' } },
    });
    expect(configs.read('ocr').transport).toBe('http');
    expect(configs.listAll()[0]?.transport).toBe('http');
  });

  it('别名不影响 stdio 的判定：仅 http 才丢 command / args', () => {
    upsert({ transport: 'streamable-http', command: 'drop-me', args: ['x'] });
    const saved = configs.read('ocr');
    expect(saved.command).toBeNull();
    expect(saved.args).toBeNull();
  });

  it('endpoints 至少一个形态（FR-056）', () => {
    let caught: unknown;
    try {
      upsert({ endpoints: {} });
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect((caught as ApiError).message).toContain('至少需要一个运行形态的连接地址');
  });

  it('endpoints 非对象 / 地址为空 → VALIDATION_FAILED', () => {
    expect(() => upsert({ endpoints: 'http://x' })).toThrow(ApiError);
    expect(() => upsert({ endpoints: { host_local: '   ' } })).toThrow(ApiError);
  });

  it('stdio 时 command 必填；给出 command 后可保存并保留 args', () => {
    expect(() => upsert({ transport: 'stdio', endpoints: { container_network: 'stdio' } })).toThrow(
      ApiError,
    );

    upsert({
      transport: 'stdio',
      endpoints: { container_network: 'stdio' },
      command: 'python',
      args: ['-u', 'srv.py'],
    });
    const saved = configs.read('ocr');
    expect(saved.command).toBe('python');
    expect(saved.args).toEqual(['-u', 'srv.py']);
  });

  it('http 时 command / args 归一为 null（不残留无关字段）', () => {
    upsert({ command: 'should-be-dropped', args: ['x'] });
    const saved = configs.read('ocr');
    expect(saved.command).toBeNull();
    expect(saved.args).toBeNull();
  });

  it('已废弃的 writable / permission_scope 不再校验也不再透出（2026-09-15 产品决定）', () => {
    // 旧客户端仍可能把这两个字段发上来：接受请求但不落任何效果
    upsert({ writable: true, permission_scope: '仅图片识别' });
    const saved = configs.read('ocr') as Record<string, unknown>;
    expect(saved.writable).toBeUndefined();
    expect(saved.permission_scope).toBeUndefined();
    // 历史存档里的遗留字段在读取时被收敛掉（sanitize）
    store.writeJson('mcp-services.json', {
      items: {
        ocr: { ...BASE, writable: false, permission_scope: '旧边界', updated_at: '2026-01-01T00:00:00.000Z' },
      },
    });
    const legacy = configs.read('ocr') as Record<string, unknown>;
    expect(legacy.writable).toBeUndefined();
    expect(legacy.permission_scope).toBeUndefined();
    expect(legacy.description).toBe(BASE.description);
  });

  it('file_args 缺省为 {}；非法结构 / 非 "url" 值 → VALIDATION_FAILED', () => {
    upsert({ file_args: undefined });
    expect(configs.read('ocr').file_args).toEqual({});

    expect(() => upsert({ file_args: [] })).toThrow(ApiError);
    expect(() => upsert({ file_args: { tool: 'x' } })).toThrow(ApiError);
    let caught: unknown;
    try {
      upsert({ file_args: { tool: { param: 'base64' } } });
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).message).toContain('仅支持 "url"');
  });

  it('file_args 支持取值路径：对象数组的元素字段（items[].excelFileUrl）', () => {
    upsert({ file_args: { parse_excel_files: { 'items[].excelFileUrl': 'url' } } });

    expect(configs.read('ocr').file_args).toEqual({
      parse_excel_files: { 'items[].excelFileUrl': 'url' },
    });
  });

  it('file_args 的路径写法非法 → VALIDATION_FAILED（不留"配了不生效"的声明）', () => {
    let caught: unknown;
    try {
      upsert({ file_args: { parse_excel_files: { 'items[0]': 'url' } } });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    const message = (caught as ApiError).message;
    expect(message).toContain('items[0]');
    expect(message).toContain('items[].excelFileUrl');
  });

  it('description 允许为空串（供卡片展示，FR-006）', () => {
    upsert({ description: '' });
    expect(configs.read('ocr').description).toBe('');
  });

  it('保存失败时**不递增** revision（失败不留痕）', () => {
    const before = store.revision();
    expect(() => upsert({ endpoints: {} })).toThrow(ApiError);
    expect(store.revision()).toBe(before);
  });
});

describe('调用确认策略（HITL confirmation）', () => {
  it('缺省为 never（存量行为不变）', () => {
    upsert();
    expect(configs.read('ocr').confirmation).toBe('never');
  });

  it('保存 always 与 { tools } 后按原样读取', () => {
    upsert({ confirmation: 'always' });
    expect(configs.read('ocr').confirmation).toBe('always');

    upsert({ confirmation: { tools: ['query_price', 'create_order'] } });
    expect(configs.read('ocr').confirmation).toEqual({ tools: ['query_price', 'create_order'] });
  });

  it('非法形状（typo / tools 空 / 非字符串元素）→ VALIDATION_FAILED，不写入', () => {
    expect(() => upsert({ confirmation: 'when_write' })).toThrow(ApiError);
    expect(() => upsert({ confirmation: { tools: [] } })).toThrow(ApiError);
    expect(() => upsert({ confirmation: { tools: ['ok', 42] } })).toThrow(ApiError);
    expect(configs.readOrNull('ocr')).toBeNull();
  });

  it('历史存档无该字段：读取时容错收敛为 never（不阻断存量文档）', () => {
    store.writeJson('mcp-services.json', {
      items: { ocr: { ...BASE, updated_at: '2026-01-01T00:00:00.000Z' } },
    });
    expect(configs.read('ocr').confirmation).toBe('never');
  });

  it('历史存档里的残缺 confirmation：读取时收敛为 never（不抛错）', () => {
    store.writeJson('mcp-services.json', {
      items: {
        ocr: { ...BASE, confirmation: { tool_names: ['x'] }, updated_at: '2026-01-01T00:00:00.000Z' },
      },
    });
    expect(configs.read('ocr').confirmation).toBe('never');
  });
});
