import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { McpCallErrorKind, McpConnectionStatus, McpServerConfig } from '../../types.js';

export class McpUnavailableError extends Error {
  constructor(server: string) {
    super(`外部服务 ${server} 当前不可用，请稍后尝试`);
    this.name = 'McpUnavailableError';
  }
}

export function isTransportFailure(err: unknown): boolean {
  return !(err instanceof McpError);
}

/**
 * 把一次调用失败归类为粗粒度枚举，供观测统计落库（`McpCallEvent.errorKind`）。
 *
 * 刻意只分三类、**不存错误原文**（长度与脱敏不可控）——要细节去 pino 运行日志。
 * 判定从具体到泛化：不可用 > 协议错误 > 传输/其它。
 */
export function classifyMcpError(err: unknown): McpCallErrorKind {
  if (err instanceof McpUnavailableError) return 'unavailable';
  if (err instanceof McpError) return 'protocol';
  return 'transport';
}

export interface McpToolInfo {
  name: string;
  /**
   * 服务端声明的**人读标题**（MCP `tools/list` 的 `Tool.title`）。
   *
   * 仅作**兜底**：平台配置的 `tool_labels` 优先；服务端没声明时才用它，
   * 再没有才回退 `server: tool` 英文拼接（见 `mcp-tool-adapter.ts`）。
   */
  title?: string;
  description?: string;
  inputSchema?: unknown;
}

function isMethodNotFound(err: unknown): boolean {
  return err instanceof McpError && err.code === ErrorCode.MethodNotFound;
}

/** MCP 客户端的最小契约（SDK Client 与其兼容子集） */
export interface McpClientLike {
  listTools(): Promise<{ tools: McpToolInfo[] }>;
  callTool(name: string, args: unknown): Promise<unknown>;
  close(): Promise<void>;
  onClose?(cb: () => void): void;
  ping?(): Promise<unknown>;
}

export interface McpConnectResult {
  unavailable: string[];
}

export interface McpManagerOptions {
  timeoutMs: number;
  /**
   * 单 server 建连超时（毫秒）。缺省取 `timeoutMs`（测试桩友好）。
   * 超时按 failed 落定并交给退避重连——保证 `statusOf()` 不会永久停在 unknown。
   */
  connectTimeoutMs?: number;
  logger?: { warn(msg: string): void };
  createClient?: (cfg: McpServerConfig) => Promise<McpClientLike>;
  onStatusChange?: (server: string, status: McpConnectionStatus) => void;
}

async function defaultCreateClient(cfg: McpServerConfig): Promise<McpClientLike> {
  const client = new Client({ name: 'optagent-backend', version: '0.1.0' });
  // 避免"平台测通、运行期连不上"这类协议口径漂移。空对象不传，保持既有行为。
  const headers = cfg.headers && Object.keys(cfg.headers).length > 0 ? cfg.headers : null;
  const transport =
    cfg.transport === 'stdio'
      ? new StdioClientTransport({ command: cfg.command!, args: cfg.args ?? [] })
      : new StreamableHTTPClientTransport(
          new URL(cfg.url!),
          headers ? { requestInit: { headers } } : undefined,
        );
  await client.connect(transport as unknown as Parameters<Client['connect']>[0]);
  // 避免实例回收（closeAll）被误判为断线
  let closed = false;
  return {
    listTools: async () => {
      const res = await client.listTools();
      return {
        tools: res.tools.map((t): McpToolInfo => {
          const info: McpToolInfo = { name: t.name };
          if (t.title !== undefined) info.title = t.title;
          if (t.description !== undefined) info.description = t.description;
          info.inputSchema = t.inputSchema;
          return info;
        }),
      };
    },
    callTool: (name, args) => client.callTool({ name, arguments: args as Record<string, unknown> }),
    ping: () => client.ping(),
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
  private static readonly RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 60_000];

  private static readonly KEEPALIVE_RETRY_MS = 120_000;

  private readonly clients = new Map<string, McpClientLike>();
  private readonly unavailableSet = new Set<string>();
  /** 建连配置留存：重连使用（不重读盘，避免配置已删改后行为诡异） */
  private readonly configs = new Map<string, McpServerConfig>();
  private readonly retryAttempts = new Map<string, number>();
  private readonly retryTimers = new Map<string, NodeJS.Timeout>();
  /** 同 server 重连去重（定时器与惰性补试可能并发触发） */
  private readonly reconnecting = new Map<string, Promise<boolean>>();
  private readonly pingUnsupported = new Set<string>();
  private closed = false;
  private readonly timeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly logger: { warn(msg: string): void } | undefined;
  private readonly createClient: (cfg: McpServerConfig) => Promise<McpClientLike>;
  private readonly onStatusChange:
    ((server: string, status: McpConnectionStatus) => void) | undefined;
  private settled: Promise<void> | null = null;

  constructor(opts: McpManagerOptions) {
    this.timeoutMs = opts.timeoutMs;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? opts.timeoutMs;
    this.logger = opts.logger;
    this.createClient = opts.createClient ?? defaultCreateClient;
    this.onStatusChange = opts.onStatusChange;
  }

  connectAndTrack(configs: McpServerConfig[]): Promise<void> {
    this.settled = this.connectAll(configs).then(
      () => undefined,
      () => undefined,
    );
    return this.settled;
  }

  /**
   * 等待本次建连全部落定（每台 server 非 connected 即 failed，不再有 unknown）。
   *
   * @returns `true` = 已落定（含"从未发起建连"，视为无待等）；`false` = 超时。
   *   超时**不改状态**：仍在飞行的建连照旧自行落定并推送，只是调用方不再等。
   */
  async waitSettled(timeoutMs: number): Promise<boolean> {
    const settled = this.settled;
    if (!settled) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    try {
      return await Promise.race([settled.then(() => true as const), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** 并发建连；单 server 失败标记 unavailable（不抛出，不阻断实例就绪），并进入有界重连 */
  async connectAll(configs: McpServerConfig[]): Promise<McpConnectResult> {
    for (const cfg of configs) this.configs.set(cfg.name, cfg);
    await Promise.all(
      configs.map(async (cfg) => {
        try {
          const client = await this.boundedConnect(cfg);
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

  /**
   * 有界建连（2026-10-18）：SDK 的 `client.connect()` 本身无超时，stdio 拉起卡住或
   * HTTP 黑洞时可能永不返回 → 状态永久 unknown（灰），发消息前的等待只能靠外部超时。
   * 这里给出确定上限：超时即按 failed 落定（走既有退避重连），迟到的连接立即关闭防泄漏。
   */
  private boundedConnect(cfg: McpServerConfig): Promise<McpClientLike> {
    const creating = this.createClient(cfg);
    return new Promise<McpClientLike>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`MCP 建连超时（${this.connectTimeoutMs}ms）`));
        // 超时后若连接迟到，主动关闭：否则会在 clients 之外留下一个无人管的客户端进程/会话
        void creating.then((c) => c.close().catch(() => undefined)).catch(() => undefined);
      }, this.connectTimeoutMs);
      creating.then(
        (client) => {
          clearTimeout(timer);
          resolve(client);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

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

  private scheduleRetry(server: string): void {
    if (this.closed || this.retryTimers.has(server)) return;
    const attempt = this.retryAttempts.get(server) ?? 0;
    const delay = McpManager.RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
      // 首次进入保活档才告警，避免每 2 分钟刷一条日志
      if (attempt === McpManager.RETRY_DELAYS_MS.length) {
        this.logger?.warn(
          `MCP server ${server} 重连 ${attempt} 次均失败，转入保活重试（每 ${
            McpManager.KEEPALIVE_RETRY_MS / 1000
          }s，服务恢复后自动接回）`,
        );
      }
      this.retryAttempts.set(server, attempt + 1);
      this.scheduleTimer(server, McpManager.KEEPALIVE_RETRY_MS);
      return;
    }
    this.retryAttempts.set(server, attempt + 1);
    this.scheduleTimer(server, delay);
  }

  private scheduleTimer(server: string, delay: number): void {
    const timer = setTimeout(() => {
      this.retryTimers.delete(server);
      void this.tryReconnect(server);
    }, delay);
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

  async probe(): Promise<string[]> {
    if (this.closed) return [];
    const changed: string[] = [];
    await Promise.all(
      [...this.clients.keys()].map(async (server) => {
        const client = this.clients.get(server);
        if (!client) return;
        try {
          await this.probeOne(server, client);
        } catch (err) {
          this.degradeOnTransportFailure(server, err, '健康探测失败');
          if (this.statusOf(server) === 'failed') changed.push(server);
        }
      }),
    );
    return changed;
  }

  private async probeOne(server: string, client: McpClientLike): Promise<void> {
    if (client.ping && !this.pingUnsupported.has(server)) {
      try {
        await this.withTimeout(client.ping());
        return;
      } catch (err) {
        if (!isMethodNotFound(err)) throw err;
        this.pingUnsupported.add(server);
      }
    }
    await this.withTimeout(client.listTools());
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
    try {
      const res = await this.withTimeout(client.listTools());
      return res.tools;
    } catch (err) {
      this.degradeOnTransportFailure(server, err, '工具清单获取失败');
      throw err;
    }
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
        this.logger?.warn(
          `MCP 调用失败（${server}/${tool}，第 ${attempt + 1} 次）：${String(err)}`,
        );
      }
    }
    // 两次均失败：连接级错误顺势降级（见 degradeOnTransportFailure）
    this.degradeOnTransportFailure(server, lastErr, '调用失败');
    throw lastErr;
  }

  private degradeOnTransportFailure(server: string, err: unknown, reason: string): void {
    if (!isTransportFailure(err)) return;
    this.markUnavailable(server, reason);
  }

  async closeAll(): Promise<void> {
    this.closed = true;
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(clients.map((c) => c.close().catch(() => {})));
  }

  private withTimeout<T>(p: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`MCP 调用超时（${this.timeoutMs}ms）`)),
        this.timeoutMs,
      );
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
