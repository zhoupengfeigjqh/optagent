/**
 * MCP 连接管理（T021 / FR-024，contracts §5）。
 *
 * - stdio + Streamable HTTP 两种传输
 * - connectAll 并发建连，单 server 失败不抛出：标记 unavailable，实例降级就绪
 * - callTool：30s（可配）超时 + 重试 1 次；server 不可用 → McpUnavailableError
 * - createClient 可注入（单测 mock transport）
 * - **状态双向自愈（2026-09-23）**：
 *   ① 退避重试用尽后**转入低频保活重试**（不再停止）——服务恢复后自动接回，
 *      不必等实例换代或重启 backend；
 *   ② 新增 `probe()` 主动健康探测——`streamable-http` 无常驻连接，服务停掉时
 *      没有 `onClose` 可听，没有流量就发现不了（假绿）；由外层调度器定期探测补齐。
 */
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

/**
 * 是否为**连接级**失败（连接被拒/超时/`StreamableHTTPError` 等）。
 *
 * 判据与降级决策同源（见 `degradeOnTransportFailure`）：`McpError` 表示服务端活着、
 * 已应答协议错误（参数/schema 类，如 -32602），不算连接级。对外导出以便调用点
 * （如 `mcp-tool-adapter` 的统计埋点）复用同一规则，不各自再实现一遍。
 */
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
  description?: string;
  inputSchema?: unknown;
}

/** 服务端未实现该请求方法（如"可选实现"的 `ping`）——据此切换探测手段，而非判定为故障 */
function isMethodNotFound(err: unknown): boolean {
  return err instanceof McpError && err.code === ErrorCode.MethodNotFound;
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
  /**
   * 健康探针（可选；MCP `ping` 请求）。
   *
   * `ping` 在 MCP 规范里是**可选实现**，未实现的服务返回 `-32601 Method not found`——
   * 探测方据此把该 server 记为"用 `listTools` 探测"（工具服务必然实现 `tools/list`）。
   */
  ping?(): Promise<unknown>;
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
  /**
   * 断线/建连失败后的**快节奏**重连退避表（共 5 次，约 3 分钟）：
   * 覆盖"server 重启、网络抖动"这一最常见恢复窗口。重连成功即清零计数——
   * 时好时坏的 server 不会被永久拉黑。
   */
  private static readonly RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 60_000];

  /**
   * 退避表用尽后的**保活重试**间隔（2026-09-23 修正）。
   *
   * 旧实现"重试 5 次后彻底停止"，并声称由 `callTool/listTools` 的惰性补试兜底——
   * 但那条兜底**实际不成立**：`agent-factory` 每轮装配工具时先判
   * `if (!mcp.isAvailable(server)) continue;`，而 `isAvailable` 在 `markUnavailable`
   * 时已为 false → `listTools`/`callTool` 根本不会被调用 → 惰性补试永远没有机会执行。
   * 结果是服务恢复后状态与工具**永久停在不可用**，只能靠实例换代（空闲回收/重启）恢复。
   *
   * 故改为：退避用尽后进入低频保活重试，服务恢复会在一个周期内自动接回
   * （对齐 gRPC/Envoy 的"指数退避 + 封顶 + 持续重试"，而不是"重试 N 次后放弃"）。
   */
  private static readonly KEEPALIVE_RETRY_MS = 120_000;

  private readonly clients = new Map<string, McpClientLike>();
  private readonly unavailableSet = new Set<string>();
  /** 建连配置留存：重连使用（不重读盘，避免配置已删改后行为诡异） */
  private readonly configs = new Map<string, McpServerConfig>();
  private readonly retryAttempts = new Map<string, number>();
  private readonly retryTimers = new Map<string, NodeJS.Timeout>();
  /** 同 server 重连去重（定时器与惰性补试可能并发触发） */
  private readonly reconnecting = new Map<string, Promise<boolean>>();
  /** 不支持 `ping` 的 server（首次探测遇到 -32601 后记下，后续直接用 listTools 探测） */
  private readonly pingUnsupported = new Set<string>();
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

  /**
   * 安排下一次主动重连。
   *
   * 先按快节奏退避表（5s/15s/30s/60s/60s）覆盖"服务重启"这一常见窗口；
   * **用尽后不停**，转入 `KEEPALIVE_RETRY_MS` 低频保活——这是"服务恢复后能自动接回"
   * 的唯一保障（惰性补试被 `isAvailable` 短路挡住，见常量注释）。
   */
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
   * 主动健康探测（2026-09-23 新增）：对本实例**已连接**的 server 各发一次轻量探针。
   *
   * 为什么需要：`streamable-http` 是无状态请求/响应，服务被停掉时没有 `onClose` 可听；
   * 若此时恰好没有工具调用，状态会恒为 connected（假绿），直到下次调用才发现。
   * 由外层调度器定期调用本方法，即可补齐"停机能被及时发现"。
   *
   * 探针优先级：MCP `ping`（最轻）→ 该 server 未实现 `ping`（`-32601`）时记下并改用
   * `listTools`（工具服务必然实现 `tools/list`）。探测失败且属**连接级**错误才降级
   * （复用 `degradeOnTransportFailure`，协议类 `McpError` 不误判为故障）。
   *
   * 不可用的 server 不在这里处理——它们由保活重连负责（见 `scheduleRetry`）。
   *
   * @returns 本次探测中状态**翻转为 failed** 的 server 名（供调度方日志与测试断言）
   */
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

  /** 单 server 探针：优先 `ping`；未实现则记下并回退 `listTools` */
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
        this.logger?.warn(`MCP 调用失败（${server}/${tool}，第 ${attempt + 1} 次）：${String(err)}`);
      }
    }
    // 两次均失败：连接级错误顺势降级（见 degradeOnTransportFailure）
    this.degradeOnTransportFailure(server, lastErr, '调用失败');
    throw lastErr;
  }

  /**
   * 连接级失败即降级（2026-09-16 十五次调整）。
   *
   * 背景：streamable-http 是无状态请求/响应，进程内不存在常驻连接——服务被关停/重启后
   * `onClose` 不会触发，而调用/取工具清单失败的旧路径又只记日志不清理，结果是旧客户端
   * （连同其已被服务端遗忘的 session id，重启后典型症状：404 "Session not found"）
   * **永久占住 clients 表**：状态恒为 connected（绿灯），工具反复被剔除，直到实例换代。
   *
   * 处置：凡是真正发出过请求却以连接级错误失败（连接被拒/超时/StreamableHTTPError 等），
   * 即调 markUnavailable——状态变红并推送，同时排上既有退避重连；重连做全新 initialize，
   * 拿到合法 session 后自动恢复（无需重启 backend）。
   *
   * `McpError` 除外：服务端活着、应答了协议错误（参数/schema 类，如 -32602），
   * 降级重连对活服务只会造成状态抖动。
   */
  private degradeOnTransportFailure(server: string, err: unknown, reason: string): void {
    if (!isTransportFailure(err)) return;
    this.markUnavailable(server, reason);
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
