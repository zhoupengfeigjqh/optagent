/**
 * 单元测试：MCP 服务清单投影（T108，`FR-043`、`FR-052`）
 *
 * 重点覆盖**编排改名 / 移除时的差异检测**：平台侧配置指向的对象一旦在编排里
 * 消失或改名，必须被标为异常并给出具体差异，而不是安静地消失。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpServiceListService } from '../../src/domain/mcp/service-list.js';
import { McpServiceConfigService } from '../../src/domain/mcp/service-config.js';
import { ComposeReader } from '../../src/infra/compose-reader.js';
import { McpClientService, type McpClientLike } from '../../src/infra/mcp-client.js';
import { PlatformStore } from '../../src/infra/platform-store.js';
import { FakeDockerHost } from '../helpers/fixture.js';

let root: string;
let composePath: string;
let store: PlatformStore;
let configs: McpServiceConfigService;
let docker: FakeDockerHost;

const BASE_COMPOSE = `services:
  gateway:
    build: ./gateway
  backend:
    build: ./agent-backend
  ocr:
    build: ./ocr-service
    container_name: optagent-ocr
    ports:
      - "8000"
`;

function writeCompose(text: string): void {
  fs.writeFileSync(composePath, text, 'utf8');
}

/** 内存 MCP 客户端（单元测试不触碰真实网络） */
function fakeClient(overrides: Partial<McpClientLike> = {}): McpClientLike {
  return {
    listTools: async () => [],
    ping: async () => undefined,
    close: async () => undefined,
    ...overrides,
  };
}

function buildService(overrides: Partial<McpClientLike> = {}): McpServiceListService {
  return new McpServiceListService({
    compose: new ComposeReader(composePath),
    docker,
    configs,
    mcpClient: new McpClientService({
      timeoutMs: 100,
      createClient: async () => fakeClient(overrides),
    }),
    referencesOf: () => [],
    targetForm: () => 'container_network',
    currentRevision: () => store.revision(),
  });
}

function configure(name: string, endpoints: Record<string, string>): void {
  configs.upsert(
    name,
    {
      description: `${name} 用途`,
      transport: 'http',
      endpoints,
      file_args: {},
    },
    store.revision(),
  );
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-service-list-'));
  composePath = path.join(root, 'docker-compose.yml');
  writeCompose(BASE_COMPOSE);
  store = new PlatformStore(path.join(root, '.platform-data'));
  store.ensureLayout();
  configs = new McpServiceConfigService(store);
  docker = new FakeDockerHost();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('McpServiceListService.list', () => {
  it('清单以编排声明为唯一来源，排除平台自身服务', async () => {
    const views = await buildService().list();
    expect(views.map((v) => v.name)).toEqual(['ocr']);
    expect(views[0]).toMatchObject({ in_compose: true, configured: false, status: 'unknown' });
  });

  it('传输方式：未配置时按编排默认 http（内网服务仍是网络调用，不能判成 stdio）', async () => {
    writeCompose('services:\n  no-port-svc:\n    image: x\n  http-svc:\n    image: y\n    ports: ["1"]\n');
    const views = await buildService().list();
    expect(views.find((v) => v.name === 'no-port-svc')?.transport).toBe('http');
    expect(views.find((v) => v.name === 'http-svc')?.transport).toBe('http');
  });

  it('已配置时以服务级配置的 transport 为准', async () => {
    configure('ocr', { container_network: 'http://ocr:8000/mcp' });
    writeCompose('services:\n  ocr:\n    image: y\n');
    const views = await buildService().list();
    expect(views[0]?.transport).toBe('http');
    expect(views[0]?.configured).toBe(true);
  });

  it('编排改名 → 旧配置项标为异常并给出差异（FR-052）', async () => {
    configure('ocr', { container_network: 'http://ocr:8000/mcp' });
    writeCompose('services:\n  ocr-v2:\n    image: y\n    ports: ["8000"]\n');

    const views = await buildService().list();
    const old = views.find((v) => v.name === 'ocr');
    expect(old).toMatchObject({ in_compose: false, configured: true });
    expect(old?.abnormal_reason).toContain('已不在容器编排声明中');
    // 新名字作为未配置项出现，等待登记
    expect(views.find((v) => v.name === 'ocr-v2')).toMatchObject({ in_compose: true, configured: false });
  });

  it('编排移除 → 配置项仍出现在清单中（而不是安静消失）', async () => {
    configure('ocr', { container_network: 'http://ocr:8000/mcp' });
    writeCompose('services:\n  gateway:\n    build: ./gateway\n');
    const views = await buildService().list();
    expect(views.map((v) => v.name)).toEqual(['ocr']);
    expect(views[0]?.in_compose).toBe(false);
  });

  it('容器状态按服务名合成，异常状态给出原因', async () => {
    docker.statuses.set('ocr', 'abnormal');
    const views = await buildService().list();
    expect(views[0]?.status).toBe('abnormal');
    expect(views[0]?.abnormal_reason).toContain('容器状态异常');
  });

  it('Docker 不可达时状态为 unknown，清单照常返回', async () => {
    const broken = new McpServiceListService({
      compose: new ComposeReader(composePath),
      docker: new (class extends FakeDockerHost {
        override async statusMap(): Promise<never> {
          throw new Error('docker 不可达');
        }
      })(),
      configs,
      mcpClient: new McpClientService({ timeoutMs: 100 }),
      referencesOf: () => [],
      targetForm: () => 'container_network',
      currentRevision: () => store.revision(),
    });
    const views = await broken.list();
    expect(views[0]?.status).toBe('unknown');
  });

  it('按名称稳定排序（分页结果稳定）', async () => {
    writeCompose('services:\n  zeta:\n    image: a\n  alpha:\n    image: b\n');
    const views = await buildService().list();
    expect(views.map((v) => v.name)).toEqual(['alpha', 'zeta']);
  });
});

describe('McpServiceListService.detail', () => {
  it('返回服务级配置、编排原始声明与工具清单', async () => {
    configure('ocr', { container_network: 'http://ocr:8000/mcp' });
    const detail = await buildService({
      listTools: async () => [
        { name: 'ocr_image', description: '识别图片', parameters: { type: 'object' } },
      ],
    }).detail('ocr');

    expect(detail).not.toBeNull();
    expect(detail?.endpoints.container_network).toBe('http://ocr:8000/mcp');
    expect(detail?.compose_declaration).toMatchObject({ container_name: 'optagent-ocr' });
    expect(detail?.tools).toHaveLength(1);
    expect(detail?.tools_error).toBeNull();
  });

  it('工具清单不可得时**不报错**，而是返回空清单 + 可读原因（FR-045 降级）', async () => {
    configure('ocr', { container_network: 'http://ocr:8000/mcp' });
    const detail = await buildService({
      listTools: async () => {
        throw new Error('连接被拒绝');
      },
    }).detail('ocr');

    expect(detail?.tools).toEqual([]);
    expect(detail?.tools_truncated).toBe(false);
    expect(detail?.tools_error).toContain('连接被拒绝');
  });

  it('既不在编排也无配置 → null（由路由映射 404）', async () => {
    expect(await buildService().detail('ghost')).toBeNull();
  });

  it('仅平台有配置（已从编排移除）也能取到详情', async () => {
    configure('ocr', { container_network: 'http://ocr:8000/mcp' });
    writeCompose('services:\n  gateway:\n    build: ./gateway\n');
    const detail = await buildService().detail('ocr');
    expect(detail?.in_compose).toBe(false);
  });

  it('服务详情里的 references 由注入的引用推导提供（不落库）', async () => {
    configure('ocr', { container_network: 'http://ocr:8000/mcp' });
    const service = new McpServiceListService({
      compose: new ComposeReader(composePath),
      docker,
      configs,
      mcpClient: new McpClientService({ timeoutMs: 100 }),
      referencesOf: (name) => [{ user_id: 'admin', agent_name: `${name}-user` }],
      targetForm: () => 'container_network',
      currentRevision: () => store.revision(),
    });
    const detail = await service.detail('ocr');
    expect(detail?.references).toEqual([{ user_id: 'admin', agent_name: 'ocr-user' }]);
  });
});
