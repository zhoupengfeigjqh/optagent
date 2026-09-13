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
import type { McpConnectionStatus, McpServerConfig } from '../../types.js';

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
  /**
   * 注册"连接意外断开"回调（可选；SDK Client 经 transport onclose 支持）。
   * 仅在实际断线时触发；close() 主动关闭是否触发由实现保证不触发（见 defaultCreateClient）。
   */
  onClose?(cb: () => void): void;
}

export interface McpConnectResult {
  unavailable: string[];
}

export interface McpManagerOptions {
  timeoutMs: number;
  logger?: { warn(msg: string): void };
  createClient?: (cfg: McpServerConfig) => Promise<McpClientLike>;
  /** 单 server 建连落定（connected/failed）时回调；用于 SSE 推送状态快照 */
  onStatusChange?: (server: string, status: McpConnectionStatus) => void;
}

/** SDK 默认建连（stdio / Streamable HTTP） */
async function defaultCreateClient(cfg: McpServerConfig): Promise<McpClientLike> {
  const client = new Client({ name: 'optagent-backend', version: '0.1.0' });
  const transport =
    cfg.transport === 'stdio'
      ? new StdioClientTransport({ command: cfg.command!, args: cfg.args ?? [] })
      : new StreamableHTTPClientTransport(new URL(cfg.url!));
  await client.connect(transport as unknown as Parameters<Client['connect']>[0]);
  // 主动 close 也会触发 SDK 的 onclose：用标志位区分"意外断线"与"主动关闭"，
  // 避免实例回收（closeAll）被误判为断线
  let closed = false;
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
    close: async () => {
      closed = true;
      await client.close();
    },
    onClose: (cb) => {
      client.onclose = () => {
        if (!closed) cb();
      };
    },
  };
}

export class McpManager {
  /**
   * 断线/建连失败后的主动重连退避表（共 5 次，约 3 分钟窗口）：
   * 覆盖"server 重启、网络抖动"这一最常见恢复窗口；全部失败后停止后台重试，
   * 之后由 callTool/listTools 的惰性补试在"下次真正使用时"顺势恢复（零后台成本）。
   * 重连成功即清零计数——时好时坏的 server 不会被永久拉黑。
   */
  private static readonly RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 60_000];

  private readonly clients = new Map<string, McpClientLike>();
  private readonly unavailableSet = new Set<string>();
  /** 建连配置留存：重连使用（不重读盘，避免配置已删改后行为诡异） */
  private readonly configs = new Map<string, McpServerConfig>();
  private readonly retryAttempts = new Map<string, number>();
  private readonly retryTimers = new Map<string, NodeJS.Timeout>();
  /** 同 server 重连去重（定时器与惰性补试可能并发触发） */
  private readonly reconnecting = new Map<string, Promise<boolean>>();
  private closed = false;
  private readonly timeoutMs: number;
  private readonly logger: { warn(msg: string): void } | undefined;
  private readonly createClient: (cfg: McpServerConfig) => Promise<McpClientLike>;
  private readonly onStatusChange: ((server: string, status: McpConnectionStatus) => void) | undefined;

  constructor(opts: McpManagerOptions) {
    this.timeoutMs = opts.timeoutMs;
    this.logger = opts.logger;
    this.createClient = opts.createClient ?? defaultCreateClient;
    this.onStatusChange = opts.onStatusChange;
  }

  /** 并发建连；单 server 失败标记 unavailable（不抛出，不阻断实例就绪），并进入有界重连 */
  async connectAll(configs: McpServerConfig[]): Promise<McpConnectResult> {
    for (const cfg of configs) this.configs.set(cfg.name, cfg);
    await Promise.all(
      configs.map(async (cfg) => {
        try {
          const client = await this.createClient(cfg);
          this.adoptClient(cfg.name, client);
        } catch (err) {
          this.unavailableSet.add(cfg.name);
          this.onStatusChange?.(cfg.name, 'failed');
          this.logger?.warn(
            `MCP server ${cfg.name} 建连失败，实例降级就绪：${err instanceof Error ? err.message : String(err)}`,
          );
          this.scheduleRetry(cfg.name);
        }
      }),
    );
    return { unavailable: this.unavailable() };
  }

  /** 建连/重连成功后的统一登记：入池、清重试状态、注册断线钩子、通知 */
  private adoptClient(server: string, client: McpClientLike): void {
    this.clients.set(server, client);
    this.unavailableSet.delete(server);
    this.cancelRetry(server);
    this.retryAttempts.delete(server);
    client.onClose?.(() => this.markUnavailable(server, '连接断开'));
    this.onStatusChange?.(server, 'connected');
  }

  /** 连接断开后降级为 unavailable（幂等：已不在 clients 时不再重复通知），并进入有界重连 */
  private markUnavailable(server: string, reason: string): void {
    if (!this.clients.delete(server)) return;
    this.unavailableSet.add(server);
    this.logger?.warn(`MCP server ${server} ${reason}，标记为不可用`);
    this.onStatusChange?.(server, 'failed');
    this.scheduleRetry(server);
  }

  /** 安排下一次主动重连；退避表用尽后停止（此后靠惰性补试） */
  private scheduleRetry(server: string): void {
    if (this.closed || this.retryTimers.has(server)) return;
    const attempt = this.retryAttempts.get(server) ?? 0;
    const delay = McpManager.RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
      this.logger?.warn(`MCP server ${server} 重连 ${attempt} 次均失败，停止后台重试（下次使用时再试）`);
      return;
    }
    this.retryAttempts.set(server, attempt + 1);
    const timer = setTimeout(() => {
      this.retryTimers.delete(server);
      void this.tryReconnect(server);
    }, delay);
    // 不阻止进程退出（测试与 shutdown 场景）
    timer.unref?.();
    this.retryTimers.set(server, timer);
  }

  private cancelRetry(server: string): void {
    const timer = this.retryTimers.get(server);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(server);
  }

  /**
   * 单次重连（同 server 以 in-flight Promise 去重）。
   * 成功 → adoptClient（清计数、重注册断线钩子、推 connected）；
   * 失败 → 若仍不可用则按退避表安排下一次。
   */
  private async tryReconnect(server: string): Promise<boolean> {
    const existing = this.reconnecting.get(server);
    if (existing) return existing;
    const cfg = this.configs.get(server);
    if (!cfg || this.closed) return false;

    const pending = (async () => {
      try {
        const client = await this.createClient(cfg);
        if (this.closed || !this.unavailableSet.has(server)) {
          // 期间实例已回收，或已被其它路径恢复：丢弃多余连接
          await client.close().catch(() => {});
          return false;
        }
        this.adoptClient(server, client);
        return true;
      } catch {
        if (!this.closed && this.unavailableSet.has(server)) this.scheduleRetry(server);
        return false;
      } finally {
        this.reconnecting.delete(server);
      }
    })();
    this.reconnecting.set(server, pending);
    return pending;
  }

  /** 取可用连接；不可用时若有留存配置则顺势惰性补试一次（防并发由 tryReconnect 去重） */
  private async requireClient(server: string): Promise<McpClientLike> {
    const existing = this.clients.get(server);
    if (existing) return existing;
    if (this.configs.has(server) && !this.closed && (await this.tryReconnect(server))) {
      return this.clients.get(server)!;
    }
    throw new McpUnavailableError(server);
  }

  unavailable(): string[] {
    return [...this.unavailableSet];
  }

  isAvailable(server: string): boolean {
    return this.clients.has(server);
  }

  /**
   * 单服务连接状态（FR-019）：`clients` 命中 → connected；`unavailableSet` 命中 → failed；
   * 两者皆无 → unknown（首次建连进行中，或未纳入建连）。
   * 建连为异步 fire-and-forget，故必须区分"尚无结果"与"建连失败"。
   */
  statusOf(server: string): McpConnectionStatus {
    if (this.clients.has(server)) return 'connected';
    if (this.unavailableSet.has(server)) return 'failed';
    return 'unknown';
  }

  async listTools(server: string): Promise<McpToolInfo[]> {
    const client = await this.requireClient(server);
    const res = await this.withTimeout(client.listTools());
    return res.tools;
  }

  /** 调用工具：超时 + 重试 1 次；server 不可用（惰性补试亦失败）→ McpUnavailableError */
  async callTool(server: string, tool: string, args: unknown): Promise<unknown> {
    const client = await this.requireClient(server);
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
    this.closed = true;
    // 清理全部待执行重连定时器；进行中的重连在落定时会见 closed 标志自行丢弃连接
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
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
