/**
 * 单元测试：MCP 服务级配置（`FR-044`，`data-model.md` §3.2）
 *
 * 覆盖"同一服务只有一份配置"、**单一连接地址**（2026-09-27：取消按运行形态
 * 分形态声明）、新建/删除，以及五类校验的边界。
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
  url: 'http://ocr:8000/mcp',
  file_args: { ocr_image: { image: 'url' } },
};

/** 建立或更新 'ocr'（多数用例只关心"保存后读到什么"，故两条路径合并） */
function upsert(overrides: Record<string, unknown> = {}): void {
  const input = { ...BASE, ...overrides };
  if (configs.exists('ocr')) configs.upsert('ocr', input, store.revision());
  else configs.create({ name: 'ocr', ...input });
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
    configs.create({ name: 'zeta', ...BASE });
    configs.create({ name: 'alpha', ...BASE });
    expect(configs.listAll().map((c) => c.name)).toEqual(['alpha', 'zeta']);
  });

  it('文档损坏时按空清单处理（不抛错，保证平台可用）', () => {
    store.writeJson('mcp-services.json', { items: 'not-an-object' });
    expect(configs.listAll()).toEqual([]);
  });

  it('url 是单一连接地址（读回原值）', () => {
    upsert();
    expect(configs.read('ocr').url).toBe('http://ocr:8000/mcp');
  });

  it('存量迁移：旧文档的 endpoints 多形态对象收敛为单一 url（优先"宿主机本地"）', () => {
    store.writeJson('mcp-services.json', {
      items: {
        ocr: {
          ...BASE,
          url: undefined,
          endpoints: {
            container_network: 'http://ocr:8000/mcp',
            host_local: 'http://127.0.0.1:8000/mcp',
          },
        },
      },
    });
    expect(configs.read('ocr').url).toBe('http://127.0.0.1:8000/mcp');
  });

  it('存量迁移：只有一种形态时取该形态的值', () => {
    store.writeJson('mcp-services.json', {
      items: {
        ocr: { ...BASE, url: undefined, endpoints: { container_network: 'http://ocr:8000/mcp' } },
      },
    });
    expect(configs.read('ocr').url).toBe('http://ocr:8000/mcp');
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

  it('http 时 url 必填（缺省 / 空串 / 纯空白 → VALIDATION_FAILED）', () => {
    let caught: unknown;
    try {
      upsert({ url: '' });
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect((caught as ApiError).message).toContain('url 必填');

    expect(() => upsert({ url: '   ' })).toThrow(ApiError);
  });

  it('url 须为 http(s) 绝对地址（typo 挡在保存期）', () => {
    expect(() => upsert({ url: 'ocr:8000/mcp' })).toThrow(ApiError);
    expect(() => upsert({ url: 'ws://ocr:8000/mcp' })).toThrow(ApiError);
  });

  it('stdio 时 url 无意义：丢弃（与 http 丢弃 command/args 对称）', () => {
    upsert({ transport: 'stdio', command: 'python' });
    expect(configs.read('ocr').url).toBeNull();
  });

  it('stdio 时 command 必填；给出 command 后可保存并保留 args', () => {
    expect(() => upsert({ transport: 'stdio' })).toThrow(ApiError);

    upsert({ transport: 'stdio', command: 'python', args: ['-u', 'srv.py'] });
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

  it('file_args 支持派生模式 url:from=（原样存贮，与运行环境口径一致）', () => {
    upsert({
      file_args: {
        hd_algorithm_input_parser: { 'items[].excelFileUrl': 'url:from=items[].realRelativePath' },
      },
    });

    expect(configs.read('ocr').file_args).toEqual({
      hd_algorithm_input_parser: { 'items[].excelFileUrl': 'url:from=items[].realRelativePath' },
    });
  });

  it('file_args 派生模式：来源路径非法 / 形状不相容 → VALIDATION_FAILED', () => {
    let caught: unknown;
    try {
      upsert({ file_args: { tool: { excelFileUrl: 'url:from=items[0].path' } } });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).message).toContain('不是合法取值路径');

    caught = undefined;
    try {
      upsert({
        file_args: { tool: { 'items[].excelFileUrl': 'url:from=files[].realRelativePath' } },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).message).toContain('形状不相容');
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
    expect(() => upsert({ url: '' })).toThrow(ApiError);
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

describe('算法规则参数设置（rules_fields，按工具映射）', () => {
  it('缺省 → {}（不启用规则选择器，存量行为不变）', () => {
    upsert();
    expect(configs.read('ocr').rules_fields).toEqual({});
  });

  it('保存 { 工具名: 字段名 }：去空白后按原样读取', () => {
    upsert({ rules_fields: { optimize: '  rules  ' } });
    expect(configs.read('ocr').rules_fields).toEqual({ optimize: 'rules' });
  });

  it('非对象 / 值非非空字符串 → VALIDATION_FAILED（typo 挡在保存期）', () => {
    expect(() => upsert({ rules_fields: 'rules' })).toThrow(ApiError);
    expect(() => upsert({ rules_fields: 42 })).toThrow(ApiError);
    expect(() => upsert({ rules_fields: { optimize: 42 } })).toThrow(ApiError);
    expect(() => upsert({ rules_fields: { optimize: '  ' } })).toThrow(ApiError);
    expect(configs.readOrNull('ocr')).toBeNull();
  });

  it('历史存档无该字段：读取时容错收敛为 {}（不阻断存量文档）', () => {
    store.writeJson('mcp-services.json', {
      items: { ocr: { ...BASE, updated_at: '2026-01-01T00:00:00.000Z' } },
    });
    expect(configs.read('ocr').rules_fields).toEqual({});
  });

  it('历史存档里的 string 版 rules_field（无工具名可归属）：读取时收敛为 {}', () => {
    store.writeJson('mcp-services.json', {
      items: {
        ocr: { ...BASE, rules_field: 'rules', updated_at: '2026-01-01T00:00:00.000Z' },
      },
    });
    expect(configs.read('ocr').rules_fields).toEqual({});
  });

  it('历史存档里的残缺 rules_fields（含非串值）：读取时过滤收敛', () => {
    store.writeJson('mcp-services.json', {
      items: {
        ocr: {
          ...BASE,
          rules_fields: { optimize: 'rules', stale: 42 },
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      },
    });
    expect(configs.read('ocr').rules_fields).toEqual({ optimize: 'rules' });
  });

  it('对象路径：支持嵌套字段（如 input.targetPriorities），去空白后原样读取', () => {
    upsert({ rules_fields: { hd_scheduling_submit: ' input.targetPriorities ' } });

    expect(configs.read('ocr').rules_fields).toEqual({
      hd_scheduling_submit: 'input.targetPriorities',
    });
  });

  it('非法路径（数组段 / 空段）→ VALIDATION_FAILED（typo 挡在保存期）', () => {
    for (const path of ['items[].rules', 'a..b', 'a.', '.a']) {
      expect(() => upsert({ rules_fields: { optimize: path } })).toThrow(ApiError);
    }
  });

  it('历史存档里的非法路径：读取时丢弃，避免物化进运行环境让整只数字人加载失败', () => {
    store.writeJson('mcp-services.json', {
      items: {
        ocr: {
          ...BASE,
          rules_fields: { good: 'input.targetPriorities', bad: 'items[].rules' },
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      },
    });

    expect(configs.read('ocr').rules_fields).toEqual({ good: 'input.targetPriorities' });
  });
});

describe('异步工具声明（async_tools，R11）', () => {
  it('缺省 → []（不启用异步，存量行为不变）', () => {
    upsert();
    expect(configs.read('ocr').async_tools).toEqual([]);
  });

  it('保存工具名数组：去空白后按原样读取（顺序保持）', () => {
    upsert({ async_tools: [' submit_job ', 'get_status'] });
    expect(configs.read('ocr').async_tools).toEqual(['submit_job', 'get_status']);
  });

  it('显式空数组可保存（语义与缺省同为"不启用"）', () => {
    upsert({ async_tools: [] });
    expect(configs.read('ocr').async_tools).toEqual([]);
  });

  it('非数组 / 元素非非空字符串 / 重复 → VALIDATION_FAILED，且不写入', () => {
    for (const bad of ['submit_job', 42, [42], ['  '], ['a', 'a'], [null]]) {
      expect(() => upsert({ async_tools: bad })).toThrow(ApiError);
    }
    expect(configs.readOrNull('ocr')).toBeNull(); // 一次都没保存成功
  });

  it('重复项的报错文案指出工具名（便于自查）', () => {
    let caught: unknown;
    try {
      upsert({ async_tools: ['submit_job', 'submit_job'] });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as Error).message).toContain('重复');
    expect((caught as Error).message).toContain('submit_job');
  });

  it('只校验语法、不校验工具清单（服务不可达时也保存得进去，与 rules_fields 同取向）', () => {
    // 工具清单是**探测结果**：拿不到清单不构成配置错误，否则"服务抖动"会变成"配置改不了"
    upsert({ async_tools: ['not_in_current_catalog'] });
    expect(configs.read('ocr').async_tools).toEqual(['not_in_current_catalog']);
  });

  it('历史存档无该字段：读取时容错收敛为 []（不阻断存量文档）', () => {
    store.writeJson('mcp-services.json', {
      items: { ocr: { ...BASE, updated_at: '2026-01-01T00:00:00.000Z' } },
    });

    expect(configs.read('ocr').async_tools).toEqual([]);
  });

  it('历史存档里的残缺值（非数组 / 含非串 / 空串 / 重复）：读取时过滤收敛', () => {
    store.writeJson('mcp-services.json', {
      items: {
        ocr: {
          ...BASE,
          async_tools: ['keep', 42, '  ', null, 'keep'],
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      },
    });

    expect(configs.read('ocr').async_tools).toEqual(['keep']);
  });
});
