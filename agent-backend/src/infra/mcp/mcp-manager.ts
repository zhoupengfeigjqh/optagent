/**
 * MCP 连接管理（T021 / FR-024，contracts §5）。
 *
 * - stdio + Streamable HTTP 两种传输
 * - connectAll 并发建连，单 server 失败不抛出：标记 unavailable，实例降级就绪
 * - callTool：30s（可配）超时 + 重试 1 次；server 不可用 → McpUnavailableError
 * - createClient 可注入（单测 mock transport）
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig } from '../../types.js';

export class McpUnavailableError extends Error {
  constructor(server: string) {
    super(`外部服务 ${server} 当前不可用，请稍后尝试`);
    this.name = 'McpUnavailableError';
  }
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** MCP 客户端的最小契约（SDK Client 与其兼容子集） */
export interface McpClientLike {
  listTools(): Promise<{ tools: McpToolInfo[] }>;
  callTool(name: string, args: unknown): Promise<unknown>;
  close(): Promise<void>;
}

export interface McpConnectResult {
  unavailable: string[];
}

export interface McpManagerOptions {
  timeoutMs: number;
  logger?: { warn(msg: string): void };
  createClient?: (cfg: McpServerConfig) => Promise<McpClientLike>;
}

/** SDK 默认建连（stdio / Streamable HTTP） */
async function defaultCreateClient(cfg: McpServerConfig): Promise<McpClientLike> {
  const client = new Client({ name: 'optagent-backend', version: '0.1.0' });
  const transport =
    cfg.transport === 'stdio'
      ? new StdioClientTransport({ command: cfg.command!, args: cfg.args ?? [] })
      : new StreamableHTTPClientTransport(new URL(cfg.url!));
  await client.connect(transport as unknown as Parameters<Client['connect']>[0]);
  return {
    listTools: async () => {
      const res = await client.listTools();
      return {
        tools: res.tools.map((t): McpToolInfo => {
          const info: McpToolInfo = { name: t.name };
          if (t.description !== undefined) info.description = t.description;
          info.inputSchema = t.inputSchema;
          return info;
        }),
      };
    },
    callTool: (name, args) => client.callTool({ name, arguments: args as Record<string, unknown> }),
    close: () => client.close(),
  };
}

export class McpManager {
  private readonly clients = new Map<string, McpClientLike>();
  private readonly unavailableSet = new Set<string>();
  private readonly timeoutMs: number;
  private readonly logger: { warn(msg: string): void } | undefined;
  private readonly createClient: (cfg: McpServerConfig) => Promise<McpClientLike>;

  constructor(opts: McpManagerOptions) {
    this.timeoutMs = opts.timeoutMs;
    this.logger = opts.logger;
    this.createClient = opts.createClient ?? defaultCreateClient;
  }

  /** 并发建连；单 server 失败标记 unavailable（不抛出，不阻断实例就绪） */
  async connectAll(configs: McpServerConfig[]): Promise<McpConnectResult> {
    await Promise.all(
      configs.map(async (cfg) => {
        try {
          const client = await this.createClient(cfg);
          this.clients.set(cfg.name, client);
          this.unavailableSet.delete(cfg.name);
        } catch (err) {
          this.unavailableSet.add(cfg.name);
          this.logger?.warn(
            `MCP server ${cfg.name} 建连失败，实例降级就绪：${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }),
    );
    return { unavailable: this.unavailable() };
  }

  unavailable(): string[] {
    return [...this.unavailableSet];
  }

  isAvailable(server: string): boolean {
    return this.clients.has(server);
  }

  async listTools(server: string): Promise<McpToolInfo[]> {
    const client = this.clients.get(server);
    if (!client) throw new McpUnavailableError(server);
    const res = await this.withTimeout(client.listTools());
    return res.tools;
  }

  /** 调用工具：超时 + 重试 1 次；server 不可用 → McpUnavailableError */
  async callTool(server: string, tool: string, args: unknown): Promise<unknown> {
    const client = this.clients.get(server);
    if (!client) throw new McpUnavailableError(server);
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.withTimeout(client.callTool(tool, args));
      } catch (err) {
        lastErr = err;
        this.logger?.warn(`MCP 调用失败（${server}/${tool}，第 ${attempt + 1} 次）：${String(err)}`);
      }
    }
    throw lastErr;
  }

  async closeAll(): Promise<void> {
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(clients.map((c) => c.close().catch(() => {})));
  }

  private withTimeout<T>(p: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP 调用超时（${this.timeoutMs}ms）`)), this.timeoutMs);
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
  }
}
