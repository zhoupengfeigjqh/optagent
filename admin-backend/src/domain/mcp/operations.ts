/**
 * MCP 服务运维操作（`FR-047`、`FR-049`）。
 *
 * **2026-09-27 改版（全人工配置）**：平台不再读容器运行态，因此
 * **启停（`FR-046`）、运行日志（`FR-048`）整体下架**——本模块只剩：
 * - 测试：连通性 + 一次实际能力验证，**MUST NOT 把失败误报为成功**；
 * - 统计：运行环境不可达时**明确标注为未知**，`MUST NOT 以 0 冒充`（`FR-009`）。
 *
 * 连接目标取**单一 `url`**（不再按运行形态取值）。
 */
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import type { RuntimeClient } from '../../infra/runtime-client.js';
import type { McpClientService, McpTestReport } from '../../infra/mcp-client.js';
import type { McpServiceConfigService } from './service-config.js';

export interface McpStatsResult {
  stats_available: boolean;
  /** 服务级汇总（平台卡片用） */
  items: Array<{
    name: string;
    calls_total: number;
    calls_ok: number;
    calls_failed: number;
    last_called_at: string | null;
  }>;
  /** 按「服务 × 工具 × 用户」分组的行（平台统计表用，2026-09-23） */
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
    if (
      overrideTransport !== undefined &&
      overrideTransport !== 'http' &&
      overrideTransport !== 'stdio'
    ) {
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
      probe?.args !== undefined
        ? Array.isArray(probe.args)
          ? probe.args.map(String)
          : null
        : saved.args;
    return this.deps.mcpClient.test(name, {
      transport,
      url: transport === 'http' ? url : null,
      command: transport === 'stdio' ? command : null,
      args: transport === 'stdio' ? args : null,
    });
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
      return { stats_available: result.stats_available, items: result.items, groups: result.groups };
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

/** 探测用的地址：允许未保存，故只要非空字符串即接受；空串视为"未填" */
function normalizeProbeUrl(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}
