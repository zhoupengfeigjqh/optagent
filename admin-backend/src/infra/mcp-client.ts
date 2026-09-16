/**
 * MCP 客户端（`FR-045`、`FR-047`）。
 *
 * 复用既有 `@modelcontextprotocol/sdk`（`research.md` D1 第 2 条理由）——
 * 与运行环境**同一个客户端实现**，避免"平台测试通过、运行环境连不上"
 * 这类协议口径漂移。
 *
 * 与运行环境的 `McpManager` 的差别在于**生命周期**：管理平台是"按需连接、
 * 用完即断"，不维持长连接池——因为这里的调用是低频的运维动作。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ApiError } from '../domain/api-error.js';
import { ERROR_CODES } from '../domain/error-codes.js';

export interface McpConnectionTarget {
  transport: 'http' | 'stdio';
  url?: string | null;
  command?: string | null;
  args?: string[] | null;
}

export interface McpToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface McpProbeStep {
  ok: boolean;
  duration_ms: number;
  error_code?: string;
  message?: string;
}

export interface McpTestReport {
  ok: boolean;
  connectivity: McpProbeStep;
  capability: McpProbeStep & { method: string };
  /** 实际被测试的连接目标——界面上 MUST 展示，否则管理员无从知道"测的是谁" */
  target: { transport: 'http' | 'stdio'; url: string | null; command: string | null };
  checked_at: string;
}

/** 连接目标非法（缺 url/command 等）：属配置问题，不属"服务不可用" */
function assertTargetUsable(target: McpConnectionTarget, serviceName: string): void {
  if (target.transport === 'http' && !target.url) {
    throw new ApiError(
      ERROR_CODES.ADM_RUNTIME_FORM_NOT_CONFIGURED,
      `MCP 服务 ${serviceName} 在当前目标运行形态下没有连接地址`,
    );
  }
  if (target.transport === 'stdio' && !target.command) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `MCP 服务 ${serviceName} 为 stdio 传输但未配置 command`,
    );
  }
}

/** 把底层异常归类为可读的失败原因（`FR-047` 要求"明确的失败原因"） */
export function classifyMcpError(err: unknown): { code: string; message: string } {
  // fetch（undici）的顶层 message 只有 "fetch failed"，真实原因在 cause 链上
  // （如 cause.code = ECONNREFUSED）——必须展开，否则归类退化成泛化错误
  const parts: string[] = [err instanceof Error ? err.message : String(err)];
  const seen = new Set<unknown>([err]);
  let cursor = (err as { cause?: unknown })?.cause;
  while (cursor && !seen.has(cursor) && parts.length < 6) {
    seen.add(cursor);
    const c = cursor as NodeJS.ErrnoException;
    if (c.code) parts.push(c.code);
    if (c.message) parts.push(c.message);
    cursor = c.cause;
  }
  const message = parts.filter(Boolean).join('；');
  if (/abort|timeout|timed out|ETIMEDOUT|ECONNRESET/i.test(message)) {
    return { code: 'MCP_TIMEOUT', message: `连接或调用超时：${message}` };
  }
  if (/ECONNREFUSED|connection refused/i.test(message)) {
    return { code: 'MCP_CONNECTION_REFUSED', message: `连接被拒绝（服务未监听或端口不通）：${message}` };
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) {
    return { code: 'MCP_HOST_UNRESOLVED', message: `主机名无法解析：${message}` };
  }
  if (/403|404|405|unexpected status|invalid content-type|JSON-RPC/i.test(message)) {
    return {
      code: 'MCP_PROTOCOL_ERROR',
      message: `协议不匹配或服务未实现 MCP 端点：${message}`,
    };
  }
  return { code: 'MCP_ERROR', message };
}

export interface McpClientOptions {
  timeoutMs: number;
  /** 测试可注入假客户端工厂 */
  createClient?: (target: McpConnectionTarget) => Promise<McpClientLike>;
}

/** MCP 客户端的最小契约（SDK Client 的子集） */
export interface McpClientLike {
  listTools(): Promise<McpToolDescriptor[]>;
  /** 一次**实际能力验证**：调用一个只读方法确认服务真的可用（`FR-047`） */
  ping(): Promise<void>;
  close(): Promise<void>;
}

async function defaultCreateClient(target: McpConnectionTarget): Promise<McpClientLike> {
  const client = new Client({ name: 'optagent-admin-backend', version: '0.1.0' });
  const transport =
    target.transport === 'stdio'
      ? new StdioClientTransport({ command: target.command!, args: target.args ?? [] })
      : new StreamableHTTPClientTransport(new URL(target.url!));
  await client.connect(transport as unknown as Parameters<Client['connect']>[0]);

  return {
    listTools: async () => {
      const res = await client.listTools();
      return res.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? '',
        parameters: (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<
          string,
          unknown
        >,
      }));
    },
    // `ping` 是 MCP 协议内建的**只读**方法：能返回即证明协议层真的通了，
    // 比"TCP 连上了"强得多——这正是 FR-047 要的"一次实际能力验证"。
    ping: async () => {
      await client.ping();
    },
    close: async () => {
      await client.close();
    },
  };
}

export class McpClientService {
  private readonly timeoutMs: number;
  private readonly createClient: (target: McpConnectionTarget) => Promise<McpClientLike>;

  constructor(options: McpClientOptions) {
    this.timeoutMs = options.timeoutMs;
    this.createClient = options.createClient ?? defaultCreateClient;
  }

  /** 列工具（`FR-045`）；失败抛 `ADM_RUNTIME_UNREACHABLE` 并给出可读原因 */
  async listTools(serviceName: string, target: McpConnectionTarget): Promise<McpToolDescriptor[]> {
    assertTargetUsable(target, serviceName);
    return this.withClient(target, serviceName, (client) => client.listTools());
  }

  /**
   * 测试 = **连通性检查 + 一次实际能力验证**（`FR-047`）。
   *
   * **MUST NOT 把失败误报为成功**：任一步失败即 `ok: false`，
   * 并且给出**明确的失败原因**（超时／连接被拒／协议不匹配等）。
   */
  async test(serviceName: string, target: McpConnectionTarget): Promise<McpTestReport> {
    const checkedAt = new Date().toISOString();
    const echoedTarget = {
      transport: target.transport,
      url: target.url ?? null,
      command: target.command ?? null,
    };
    const connectivity: McpProbeStep = { ok: false, duration_ms: 0 };
    const capability: McpProbeStep & { method: string } = {
      ok: false,
      method: 'ping',
      duration_ms: 0,
    };

    try {
      assertTargetUsable(target, serviceName);
    } catch (err) {
      const info =
        err instanceof ApiError
          ? { code: err.code, message: err.message }
          : classifyMcpError(err);
      connectivity.error_code = info.code;
      connectivity.message = info.message;
      capability.error_code = info.code;
      capability.message = info.message;
      return { ok: false, connectivity, capability, target: echoedTarget, checked_at: checkedAt };
    }

    let client: McpClientLike | null = null;
    try {
      const connectStart = Date.now();
      client = await this.withTimeout(this.createClient(target));
      connectivity.ok = true;
      connectivity.duration_ms = Date.now() - connectStart;

      const capabilityStart = Date.now();
      await this.withTimeout(client.ping());
      capability.ok = true;
      capability.duration_ms = Date.now() - capabilityStart;
    } catch (err) {
      const info = classifyMcpError(err);
      if (connectivity.ok) {
        capability.error_code = info.code;
        capability.message = info.message;
      } else {
        connectivity.error_code = info.code;
        connectivity.message = info.message;
        // 连通性都没过：能力验证不可能是成功的，明确标注为未执行
        capability.error_code = 'MCP_NOT_ATTEMPTED';
        capability.message = '连通性检查未通过，未执行能力验证';
      }
    } finally {
      await client?.close().catch(() => undefined);
    }

    return {
      ok: connectivity.ok && capability.ok,
      connectivity,
      capability,
      target: echoedTarget,
      checked_at: checkedAt,
    };
  }

  private async withClient<T>(
    target: McpConnectionTarget,
    serviceName: string,
    fn: (client: McpClientLike) => Promise<T>,
  ): Promise<T> {
    let client: McpClientLike | null = null;
    try {
      client = await this.withTimeout(this.createClient(target));
      return await this.withTimeout(fn(client));
    } catch (err) {
      if (err instanceof ApiError) throw err;
      const info = classifyMcpError(err);
      throw new ApiError(
        ERROR_CODES.ADM_RUNTIME_UNREACHABLE,
        `MCP 服务 ${serviceName} 不可达：${info.message}`,
      );
    } finally {
      await client?.close().catch(() => undefined);
    }
  }

  /** 统一超时：MCP 调用 MUST 有界，否则管理界面会被一个挂死的服务拖住 */
  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`aborted: timeout after ${this.timeoutMs}ms`)),
            this.timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
