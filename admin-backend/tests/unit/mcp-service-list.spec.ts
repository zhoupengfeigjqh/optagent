/**
 * 单元测试：MCP 服务清单投影（`FR-043`、`FR-045`）
 *
 * **2026-09-27 改版**：清单来源为**平台侧调用配置**（不再读容器编排声明、
 * 不再读 Docker 容器状态），因此覆盖点相应变为：
 * - 列表 = 平台配置集合（名称稳定排序、单一 `url`、传输方式）；
 * - 详情 = 配置 + 工具清单（不可得时降级为可读原因，不报错）；
 * - 引用清单由注入的推导提供（不落库）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpServiceListService } from '../../src/domain/mcp/service-list.js';
import { McpServiceConfigService } from '../../src/domain/mcp/service-config.js';
import { McpClientService, type McpClientLike } from '../../src/infra/mcp-client.js';
import { PlatformStore } from '../../src/infra/platform-store.js';

let root: string;
let store: PlatformStore;
let configs: McpServiceConfigService;

/** 内存 MCP 客户端（单元测试不触碰真实网络） */
function fakeClient(overrides: Partial<McpClientLike> = {}): McpClientLike {
  return {
    listTools: async () => [],
    ping: async () => undefined,
    close: async () => undefined,
    ...overrides,
  };
}

function buildService(
  overrides: Partial<McpClientLike> = {},
  referencesOf: (name: string) => Array<{ user_id: string; agent_name: string }> = () => [],
): McpServiceListService {
  return new McpServiceListService({
    configs,
    mcpClient: new McpClientService({
      timeoutMs: 100,
      createClient: async () => fakeClient(overrides),
    }),
    referencesOf,
    currentRevision: () => store.revision(),
  });
}

function configure(name: string, overrides: Record<string, unknown> = {}): void {
  configs.create({
    name,
    description: `${name} 用途`,
    transport: 'http',
    url: `http://${name}:8000/mcp`,
    file_args: {},
    // 工具白名单（2026-10-03）：新建必填非空；默认放开下面假客户端返回的那个工具
    allowed_tools: ['ocr_image'],
    ...overrides,
  });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-service-list-'));
  store = new PlatformStore(path.join(root, '.platform-data'));
  store.ensureLayout();
  configs = new McpServiceConfigService(store);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('McpServiceListService.list', () => {
  it('清单以平台配置为唯一来源，并带上用途描述与连接地址', async () => {
    configure('ocr');
    const views = await buildService().list();
    expect(views.map((v) => v.name)).toEqual(['ocr']);
    expect(views[0]).toMatchObject({
      description: 'ocr 用途',
      transport: 'http',
      url: 'http://ocr:8000/mcp',
    });
  });

  it('未创建任何服务时为**空清单**（不再从编排里凭空出现）', async () => {
    expect(await buildService().list()).toEqual([]);
  });

  it('传输方式与地址取自配置（stdio 服务的 url 为 null）', async () => {
    configure('local-mcp', { transport: 'stdio', url: undefined, command: 'python' });
    const views = await buildService().list();
    expect(views[0]).toMatchObject({ transport: 'stdio', url: null });
  });

  it('按名称稳定排序（分页结果稳定）', async () => {
    configure('zeta');
    configure('alpha');
    const views = await buildService().list();
    expect(views.map((v) => v.name)).toEqual(['alpha', 'zeta']);
  });
});

describe('McpServiceListService.detail', () => {
  it('返回调用配置与工具清单', async () => {
    configure('ocr');
    const detail = await buildService({
      listTools: async () => [
        { name: 'ocr_image', description: '识别图片', parameters: { type: 'object' } },
      ],
    }).detail('ocr');

    expect(detail).not.toBeNull();
    expect(detail?.url).toBe('http://ocr:8000/mcp');
    expect(detail?.tools).toHaveLength(1);
    expect(detail?.tools_error).toBeNull();
  });

  it('工具清单不可得时**不报错**，而是返回空清单 + 可读原因（FR-045 降级）', async () => {
    configure('ocr');
    const detail = await buildService({
      listTools: async () => {
        throw new Error('连接被拒绝');
      },
    }).detail('ocr');

    expect(detail?.tools).toEqual([]);
    expect(detail?.tools_truncated).toBe(false);
    expect(detail?.tools_error).toContain('连接被拒绝');
  });

  it('未在平台新建 → null（由路由映射 404）', async () => {
    expect(await buildService().detail('ghost')).toBeNull();
  });

  it('服务详情里的 references 由注入的引用推导提供（不落库）', async () => {
    configure('ocr');
    const service = buildService({}, (name) => [
      { user_id: 'admin', agent_name: `${name}-user` },
    ]);
    const detail = await service.detail('ocr');
    expect(detail?.references).toEqual([{ user_id: 'admin', agent_name: 'ocr-user' }]);
  });
});

describe('McpServiceListService.detail —— 工具白名单（2026-10-03）', () => {
  const CATALOG = [
    { name: 'ocr_image', description: '识别图片', parameters: { type: 'object' } },
    { name: 'ocr_pdf', description: '识别 PDF', parameters: { type: 'object' } },
    { name: 'query_price', description: '查价', parameters: { type: 'object' } },
  ];

  it('详情只呈现白名单里的工具，顺序与白名单一致，且回显白名单', async () => {
    configure('ocr', { allowed_tools: ['query_price', 'ocr_image'] });
    const detail = await buildService({ listTools: async () => CATALOG }).detail('ocr');

    expect(detail?.allowed_tools).toEqual(['query_price', 'ocr_image']);
    expect(detail?.tools.map((t) => t.name)).toEqual(['query_price', 'ocr_image']);
    expect(detail?.missing_tools).toEqual([]);
  });

  it('白名单里有服务当前**不存在**的工具 → missing_tools 列出它（界面据此标异常）', async () => {
    configure('ocr', { allowed_tools: ['ocr_image', 'gone_tool'] });
    const detail = await buildService({ listTools: async () => CATALOG }).detail('ocr');

    expect(detail?.tools.map((t) => t.name)).toEqual(['ocr_image']);
    expect(detail?.missing_tools).toEqual(['gone_tool']);
  });

  it('服务不可达 → 不误报：missing 恒为空，用 tools_error 表达"核对不了"', async () => {
    configure('ocr', { allowed_tools: ['ocr_image', 'gone_tool'] });
    const detail = await buildService({
      listTools: async () => {
        throw new Error('连接被拒绝');
      },
    }).detail('ocr');

    expect(detail?.tools).toEqual([]);
    expect(detail?.missing_tools).toEqual([]);
    expect(detail?.tools_error).toContain('连接被拒绝');
  });

  it('存量服务（白名单为空）= 不限制：服务全量工具都呈现', async () => {
    // 直接写文档模拟"白名单上线前的记录"：空白名单**无法经 create 产出**（新建必填非空）
    store.writeJson('mcp-services.json', {
      items: { ocr: { name: 'ocr', description: 'x', transport: 'http', url: 'http://ocr:8000/mcp' } },
    });
    const detail = await buildService({ listTools: async () => CATALOG }).detail('ocr');

    expect(detail?.allowed_tools).toEqual([]);
    expect(detail?.tools).toHaveLength(3);
    expect(detail?.missing_tools).toEqual([]);
  });
});
