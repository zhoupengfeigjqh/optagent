/**
 * MCP 服务运维操作（`FR-046`、`FR-047`、`FR-048`、`FR-049`）。
 *
 * - 启停：委托给 `infra/docker-host.ts`（白名单收口在那一处）；
 * - 测试：连通性 + 一次实际能力验证，**MUST NOT 把失败误报为成功**；
 * - 日志：**有界返回**、按时间倒序；
 * - 统计：运行环境不可达时**明确标注为未知**，`MUST NOT 以 0 冒充`（`FR-009`）。
 */
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import type { RuntimeClient } from '../../infra/runtime-client.js';
import type { ContainerStatus, DockerHost, DockerLogLine } from '../../infra/docker-host.js';
import type { McpClientService, McpTestReport } from '../../infra/mcp-client.js';
import type { McpServiceConfigService } from './service-config.js';
import type { McpServiceListService } from './service-list.js';

/** 日志条数上限（`FR-048`：日志量大时页面 MUST 仍快速返回） */
export const LOGS_LIMIT_MAX = 500;
/** 默认 50 条（2026-09-15 调整：未显式传 limit 时的有界窗口） */
export const LOGS_LIMIT_DEFAULT = 50;

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
  docker: DockerHost;
  configs: McpServiceConfigService;
  mcpClient: McpClientService;
  serviceList: McpServiceListService;
  runtime: RuntimeClient;
  targetForm(): string;
}

export class McpServiceOperations {
  constructor(private readonly deps: McpServiceOperationsDeps) {}

  /** 启动（`FR-046`）；返回**真实结果**而不是"已发出命令" */
  async start(name: string): Promise<{ name: string; status: ContainerStatus }> {
    await this.assertKnown(name);
    const status = await this.deps.docker.start(name);
    return { name, status };
  }

  /** 关闭（`FR-046`）；被引用时界面 MUST 先经 §7.1 提示并要求二次确认（`FR-051`） */
  async stop(name: string): Promise<{ name: string; status: ContainerStatus }> {
    await this.assertKnown(name);
    const status = await this.deps.docker.stop(name);
    return { name, status };
  }

  /**
   * 测试（`FR-047`）：连通性 + 一次实际能力验证。
   *
   * `probe`（可选）允许以**表单里尚未保存的值**发起测试——否则"改了地址没保存
   * 就点测试"永远测的是上一次保存的旧地址，管理员会得出"改什么都不影响测试"
   * 的错误结论（实测缺陷，2026-09-15）。未提供时按已保存的调用配置测试。
   */
  async test(
    name: string,
    probe?: { transport?: unknown; endpoints?: unknown; command?: unknown; args?: unknown },
  ): Promise<McpTestReport> {
    const saved = await this.requireConfig(name);
    const overrideTransport = probe?.transport;
    if (overrideTransport !== undefined && overrideTransport !== 'http' && overrideTransport !== 'stdio') {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `transport 须为 http 或 stdio（当前：${JSON.stringify(overrideTransport)}）`,
      );
    }
    const transport = (overrideTransport as 'http' | 'stdio' | undefined) ?? saved.transport;
    const endpoints =
      probe?.endpoints && typeof probe.endpoints === 'object' && !Array.isArray(probe.endpoints)
        ? (probe.endpoints as Record<string, string>)
        : saved.endpoints;
    const command =
      probe?.command !== undefined ? (typeof probe.command === 'string' ? probe.command : null) : saved.command;
    const args =
      probe?.args !== undefined
        ? Array.isArray(probe.args)
          ? probe.args.map(String)
          : null
        : saved.args;
    return this.deps.mcpClient.test(name, {
      transport,
      url: endpoints[this.deps.targetForm()] ?? null,
      command: transport === 'stdio' ? command : null,
      args: transport === 'stdio' ? args : null,
    });
  }

  /** 日志（`FR-048`）：有界、按时间倒序 */
  async logs(name: string, limit: number): Promise<{ items: DockerLogLine[]; truncated: boolean }> {
    await this.assertKnown(name);
    const bounded = Math.max(1, Math.min(limit, LOGS_LIMIT_MAX));
    const items = await this.deps.docker.logs(name, bounded);
    return { items, truncated: items.length >= bounded };
  }

  /**
   * 调用统计（`FR-049`／`FR-050`）。
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

  /** 服务必须在编排声明或平台配置中真实存在 */
  private async assertKnown(name: string): Promise<void> {
    const views = await this.deps.serviceList.list();
    if (!views.some((view) => view.name === name)) {
      throw new ApiError(ERROR_CODES.ADM_MCP_SERVICE_NOT_FOUND, `MCP 服务不存在：${name}`);
    }
  }

  private async requireConfig(name: string) {
    await this.assertKnown(name);
    const config = this.deps.configs.readOrNull(name);
    if (!config) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `MCP 服务 ${name} 尚未配置调用信息，请先在详情页填写后再测试`,
      );
    }
    return config;
  }
}
