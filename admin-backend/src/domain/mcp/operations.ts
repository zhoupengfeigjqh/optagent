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
  /**
   * 请求头（2026-10-08）。
   *
   * `test` 的缺省语义与其它字段**一致但也有必要特别说明**：不携带 = **用已保存的请求头**。
   * 理由：详情页回显的是**掩码**，界面"未改动"时手上没有真值可提交——
   * 若把"没带 headers"读成"没有请求头"，管理员改完地址点「发起测试」会被
   * 一个与配置无关的 401 挡住（而保存是沿用存量的，两边行为不一致）。
   * 想显式测"不带请求头"就传 `{}`（与保存期的"提供 = 全量替换"同义）。
   */
  headers?: unknown;
  /** 目标名（仅用于报错文案可读，不参与连接；未登记的新建目标可省略） */
  name?: unknown;
}

/**
 * **新建前的工具清单探测**结果（2026-10-03）。
 *
 * 与 `test` 的分工：`test` 只回答"已登记的服务通不通"；本结果要回答
 * "这个**尚未登记**的目标有哪些工具"——新建流程据此让管理员勾选可见工具白名单。
 */
export interface McpProbeResult {
  ok: boolean;
  /** 探测到的工具（有界，`tools_truncated` 标注是否截断） */
  tools: McpToolDescriptor[];
  tools_truncated: boolean;
  /** `ok=false` 时的可读原因；`ok=true` 时为 `null` */
  error: string | null;
  /** `ok=false` 时的错误码（`ADM_RUNTIME_UNREACHABLE` / `VALIDATION_FAILED` 等） */
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
    // 请求头（2026-10-08）：不携带 = 沿用已保存的（界面回显是掩码，拿不到真值），
    // 携带（含 `{}`）= 按表单当前值。仅 http 有意义，stdio 一律不带
    const headers =
      transport === 'http'
        ? normalizeHeaders(probe?.headers, saved.headers)
        : {};
    return this.deps.mcpClient.test(name, {
      transport,
      url: transport === 'http' ? url : null,
      command: transport === 'stdio' ? command : null,
      args: transport === 'stdio' ? args : null,
      headers,
    });
  }

  /**
   * **新建前的工具清单探测**（2026-10-03）：对**尚未登记**的连接目标连一次，取回工具清单，
   * 供"新建 → 勾选可见工具"这一步使用。
   *
   * 与 `test` 的分工：`test` 只回答"已登记服务通不通"；本方法要回答"这个新目标有哪些工具"。
   * 连接层面的失败**不抛错**（返回 `ok: false` + 可读原因）：界面要把失败留在弹窗里
   * （不关窗、不丢输入），由管理员决定重试还是放弃；**链接目标本身非法**（transport/url
   * 写法错误）仍按 400 抛出——那属于表单校验该拦住的问题。
   */
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
      const info =
        err instanceof ApiError ? { code: err.code, message: err.message } : classifyMcpError(err);
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

  /**
   * 新建服务的**硬门槛**（2026-10-03 产品决定）：目标连不上即创建失败。
   *
   * 调用方（路由层）在落盘**之前**调用它——失败即抛错，库里不会留下记录；
   * 成功后不返回清单：白名单由请求体给出，这一步只确认"这个目标确实能连上"。
   */
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
    // 请求头（2026-10-08）：新建目标没有"存量"可沿用，缺省即空。
    // 写法非法仍按 400 抛出（与 transport/url 同一取向：表单校验该拦住的问题）
    headers: transport === 'http' ? normalizeHeaders(input.headers, {}) : {},
  };
}
