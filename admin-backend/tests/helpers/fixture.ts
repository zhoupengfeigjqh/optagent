/**
 * 集成测试夹具：每个用例一套**隔离的临时目录**（平台设计态 + `.opt-agent`）。
 *
 * 之所以每个用例各建一套：部署类用例会真实写入 `.opt-agent`，
 * 共用目录会让用例之间互相污染（尤其是"零写入""100% 不变"这类断言）。
 *
 * **2026-09-27**：随「MCP 服务全人工配置」，夹具不再需要编排文件与假 Docker
 * ——平台已不读这两者。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadConfig, type AppConfig } from '../../src/config.js';
import type { AppContext } from '../../src/context.js';
import { buildServer } from '../../src/server.js';
import { RuntimeClient } from '../../src/infra/runtime-client.js';
import { McpClientService, type McpTestReport, type McpToolDescriptor } from '../../src/infra/mcp-client.js';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';

/** 假运行环境：预置内置工具目录与调用统计；可切换"不可达" */
export class FakeRuntimeClient extends RuntimeClient {
  tools: unknown[] = [];
  stats: unknown = { stats_available: true, items: [], groups: [] };
  unreachable = false;

  constructor() {
    super({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 100 });
  }

  override async builtinTools(): Promise<never[]> {
    if (this.unreachable) {
      throw new ApiError(ERROR_CODES.ADM_RUNTIME_UNREACHABLE, '运行环境不可达（测试桩）');
    }
    return this.tools as never[];
  }

  override async mcpCallStats(): Promise<never> {
    if (this.unreachable) {
      throw new ApiError(ERROR_CODES.ADM_RUNTIME_UNREACHABLE, '运行环境不可达（测试桩）');
    }
    return this.stats as never;
  }
}

/** 假 MCP 客户端：默认"服务未连通"，可按服务名预置工具清单与测试结果 */
export class FakeMcpClient extends McpClientService {
  toolsByService = new Map<string, McpToolDescriptor[]>();
  failListTools = new Set<string>();
  /** 测试结果覆盖：`connectivity`/`capability` 各自是否成功 */
  probe = { connectivity: true, capability: true };

  constructor() {
    super({ timeoutMs: 100 });
  }

  override async listTools(serviceName: string): Promise<McpToolDescriptor[]> {
    if (this.failListTools.has(serviceName)) {
      throw new ApiError(ERROR_CODES.ADM_RUNTIME_UNREACHABLE, `MCP 服务 ${serviceName} 不可达`);
    }
    return this.toolsByService.get(serviceName) ?? [];
  }

  override async test(
    serviceName: string,
    target?: { transport: 'http' | 'stdio'; url?: string | null; command?: string | null },
  ): Promise<McpTestReport> {
    const step = (ok: boolean, message?: string) => ({
      ok,
      duration_ms: 1,
      ...(ok ? {} : { error_code: 'MCP_CONNECTION_REFUSED', message: message ?? '连接被拒绝' }),
    });
    const connectivity = step(this.probe.connectivity, `无法连接 ${serviceName}`);
    const capability = step(this.probe.capability, '能力验证失败');
    return {
      ok: connectivity.ok && capability.ok,
      connectivity,
      capability: { ...capability, method: 'ping' },
      target: {
        transport: target?.transport ?? 'http',
        url: target?.url ?? null,
        command: target?.command ?? null,
      },
      checked_at: new Date().toISOString(),
    };
  }
}

export interface TestFixture {
  root: string;
  platformDataDir: string;
  optAgentRoot: string;
  config: AppConfig;
  app: FastifyInstance;
  ctx: AppContext;
  runtime: FakeRuntimeClient;
  mcpClient: FakeMcpClient;
  cleanup(): Promise<void>;
}

export interface FixtureOptions {
  /** 预置用户（创建 `.opt-agent/users/{uid}/` 与三个文件空间） */
  userIds?: string[];
  /** 预置 MCP 服务（key = 服务名，value = 传给 `create` 的入参片段） */
  mcpServices?: Record<string, Record<string, unknown>>;
}

export async function createFixture(options: FixtureOptions = {}): Promise<TestFixture> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-admin-'));
  const platformDataDir = path.join(root, '.platform-data');
  const optAgentRoot = path.join(root, '.opt-agent');

  fs.mkdirSync(platformDataDir, { recursive: true });
  fs.mkdirSync(optAgentRoot, { recursive: true });

  for (const userId of options.userIds ?? []) {
    for (const space of ['数据准备', '共享空间', '临时空间']) {
      fs.mkdirSync(path.join(optAgentRoot, 'users', userId, 'user-data', space), { recursive: true });
    }
    fs.mkdirSync(path.join(optAgentRoot, 'users', userId, 'agents'), { recursive: true });
  }

  const config = loadConfig({
    cwd: root,
    env: {
      PORT: '3000',
      PLATFORM_DATA_DIR: platformDataDir,
      OPT_AGENT_ROOT: optAgentRoot,
      OPT_AGENT_BACKEND_URL: 'http://127.0.0.1:1',
      RUNTIME_TIMEOUT_MS: '200',
    },
  });

  const runtime = new FakeRuntimeClient();
  const mcpClient = new FakeMcpClient();
  const app = await buildServer({ config, runtime, mcpClient });
  const ctx = (app as unknown as { ctx: AppContext }).ctx;

  for (const [name, input] of Object.entries(options.mcpServices ?? {})) {
    ctx.mcpConfigs.create({ name, transport: 'http', url: `http://127.0.0.1:1/${name}/mcp`, ...input });
  }

  return {
    root,
    platformDataDir,
    optAgentRoot,
    config,
    app,
    ctx,
    runtime,
    mcpClient,
    async cleanup() {
      await app.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/** 递归清点目录结构（"100% 不变"类断言用）：返回 相对路径 → 内容哈希 */
export function snapshotTree(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!fs.existsSync(dir)) return out;
  const walk = (current: string, prefix: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        out.set(`${rel}/`, '<dir>');
        walk(abs, rel);
      } else {
        out.set(rel, fs.readFileSync(abs).toString('base64'));
      }
    }
  };
  walk(dir, '');
  return out;
}
