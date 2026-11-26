import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import type { RuntimeClient } from '../../infra/runtime-client.js';
import { classifyMcpError } from '../../infra/mcp-client.js';
import type {
  McpClientService,
  McpConnectionTarget,
  McpTestReport,
  McpToolDescriptor,
} from '../../infra/mcp-client.js';
import { normalizeHeaders } from './service-config-fields.js';
import { TOOLS_LIMIT } from './service-list.js';
import { MCP_TRANSPORT_HINT, normalizeTransport } from './transport.js';
import type { McpServiceConfigService } from './service-config.js';

export interface McpStatsResult {
  stats_available: boolean;
  items: Array<{
    name: string;
    calls_total: number;
    calls_ok: number;
    calls_failed: number;
    last_called_at: string | null;
  }>;
  groups: Array<{
    service: string;
    tool_name: string | null;
    user_id: string | null;
    calls_total: number;
    calls_ok: number;
    calls_failed: number;
    last_called_at: string | null;
    windows?: Record<string, { ok: number; failed: number; total: number }>;
  }>;
}

export interface McpServiceOperationsDeps {
  configs: McpServiceConfigService;
  mcpClient: McpClientService;
  runtime: RuntimeClient;
}

/** 表单当前值（允许未保存）：`test` 据此探测，测的必须是管理员正在编辑的地址 */
export interface McpProbeInput {
  transport?: unknown;
  url?: unknown;
  command?: unknown;
  args?: unknown;
  headers?: unknown;
  name?: unknown;
}

export interface McpProbeResult {
  ok: boolean;
  tools: McpToolDescriptor[];
  tools_truncated: boolean;
  error: string | null;
  error_code: string | null;
  /** 实际探测的连接目标——界面 MUST 展示，否则管理员无从知道"测的是谁" */
  target: { transport: 'http' | 'stdio'; url: string | null; command: string | null };
  checked_at: string;
}

export class McpServiceOperations {
  constructor(private readonly deps: McpServiceOperationsDeps) {}

  /**
   * 测试（`FR-047`）：连通性 + 一次实际能力验证。
   *
   * `probe`（可选）允许以**表单里尚未保存的值**发起测试——否则"改了地址没保存
   * 就点测试"永远测的是上一次保存的旧地址，管理员会得出"改什么都不影响测试"
   * 的错误结论（实测缺陷，2026-09-15）。未提供时按已保存的调用配置测试。
   */
  async test(name: string, probe?: McpProbeInput): Promise<McpTestReport> {
    const saved = this.requireConfig(name);
    const overrideTransport = probe?.transport;
    if (overrideTransport !== undefined && overrideTransport !== 'http' && overrideTransport !== 'stdio') {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `transport 须为 http 或 stdio（当前：${JSON.stringify(overrideTransport)}）`,
      );
    }
    const transport = (overrideTransport as 'http' | 'stdio' | undefined) ?? saved.transport;
    const url = probe?.url !== undefined ? normalizeProbeUrl(probe.url) : saved.url;
    const command =
      probe?.command !== undefined
        ? typeof probe.command === 'string'
          ? probe.command
          : null
        : saved.command;
    const args =
      probe?.args !== undefined ? (Array.isArray(probe.args) ? probe.args.map(String) : null) : saved.args;
    const headers = transport === 'http' ? normalizeHeaders(probe?.headers, saved.headers) : {};
    return this.deps.mcpClient.test(name, {
      transport,
      url: transport === 'http' ? url : null,
      command: transport === 'stdio' ? command : null,
      args: transport === 'stdio' ? args : null,
      headers,
    });
  }

  async probe(input: McpProbeInput): Promise<McpProbeResult> {
    const target = resolveProbeTarget(input);
    const echo = {
      transport: target.transport,
      url: target.url ?? null,
      command: target.command ?? null,
    };
    const checkedAt = new Date().toISOString();
    try {
      const tools = await this.deps.mcpClient.listTools(probeLabel(input), target);
      return {
        ok: true,
        // 与详情同一上限：清单有界，避免超大目录把弹窗与响应撑爆
        tools: tools.slice(0, TOOLS_LIMIT),
        tools_truncated: tools.length > TOOLS_LIMIT,
        error: null,
        error_code: null,
        target: echo,
        checked_at: checkedAt,
      };
    } catch (err) {
      const info = err instanceof ApiError ? { code: err.code, message: err.message } : classifyMcpError(err);
      return {
        ok: false,
        tools: [],
        tools_truncated: false,
        error: info.message,
        error_code: info.code,
        target: echo,
        checked_at: checkedAt,
      };
    }
  }

  async assertReachable(input: McpProbeInput): Promise<void> {
    await this.deps.mcpClient.listTools(probeLabel(input), resolveProbeTarget(input));
  }

  /**
   * 调用统计（`FR-049`）。
   *
   * 运行环境不可达 → `stats_available: false` 且 `items: []`，
   * **不抛错也不填 0**：0 是"确实没调用过"的确定结论，与"读不到"是两回事。
   */
  async stats(): Promise<McpStatsResult> {
    try {
      const result = await this.deps.runtime.mcpCallStats();
      return {
        stats_available: result.stats_available,
        items: result.items,
        groups: result.groups,
      };
    } catch {
      return { stats_available: false, items: [], groups: [] };
    }
  }

  private requireConfig(name: string) {
    const config = this.deps.configs.readOrNull(name);
    if (!config) {
      throw new ApiError(
        ERROR_CODES.ADM_MCP_SERVICE_NOT_FOUND,
        `MCP 服务不存在（既未在平台新建，也无调用配置）：${name}`,
      );
    }
    return config;
  }
}

function normalizeProbeUrl(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

/**
 * 探测目标名：**只用于报错文案可读**（如「MCP 服务 ocr 不可达：…」）。
 * 未登记的新建目标用管理员在表单里填的名字；没填就退化为泛称。
 */
function probeLabel(input: McpProbeInput): string {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  return name === '' ? '（新建目标）' : name;
}

/**
 * 从未保存的表单值解析连接目标（新建流程专用）。
 *
 * `transport` 写法非法即 400（`VALIDATION_FAILED`）——表单校验本该拦住，
 * 这里再兜一道，避免把非法目标送到客户端层去得到一个更难懂的错误。
 */
function resolveProbeTarget(input: McpProbeInput): McpConnectionTarget {
  const transport = normalizeTransport(input.transport);
  if (transport === null) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `transport 须为 ${MCP_TRANSPORT_HINT}（当前：${JSON.stringify(input.transport)}）`,
    );
  }
  const url = normalizeProbeUrl(input.url);
  return {
    transport,
    url,
    command: typeof input.command === 'string' && input.command.trim() !== '' ? input.command.trim() : null,
    args: Array.isArray(input.args) ? input.args.map(String) : null,
    headers: transport === 'http' ? normalizeHeaders(input.headers, {}) : {},
  };
}
