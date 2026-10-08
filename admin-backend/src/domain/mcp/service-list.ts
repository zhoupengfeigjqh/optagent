/**
 * MCP 服务清单投影（`FR-043`、`FR-045`，`contracts/admin-api.md` §3.1/§3.2）。
 *
 * **2026-09-27 改版（全人工配置）**：清单来源由「容器编排声明」改为
 * 「平台侧调用配置」——平台是 MCP 服务配置的**唯一权威源**，管理员新建什么
 * 就有什么，不再读 `docker-compose.yml`、也不再读 Docker 容器状态。
 * 因此本模块：
 * - 不再有 `in_compose` / `status` / `compose_declaration` / `abnormal_reason`
 *   （这些概念的前提"编排声明 + 容器运行态"已整体下架）；
 * - 连接地址取**单一 `url`**（不再按运行形态分形态取值）。
 *
 * 唯一保留的"外部事实"是**工具清单**：它必须由平台实际连一次服务才能得到，
 * 不可得时以 `tools_error` 呈现（`FR-045`），而非报错。
 */
import type { McpClientService, McpToolDescriptor } from '../../infra/mcp-client.js';
import { maskHeaders } from './service-config-fields.js';
import type { McpConfirmation, McpServiceConfig, McpServiceConfigService } from './service-config.js';

export interface McpServiceView {
  name: string;
  description: string;
  transport: 'http' | 'stdio';
  /** 连接地址（`http` 服务必有；`stdio` 为 `null`） */
  url: string | null;
  /**
   * 是否配置了请求头（2026-10-08；卡片徽标用）。
   *
   * **只回布尔量**：请求头里通常是访问令牌，列表 MUST NOT 出现任何值（连掩码也不给）。
   */
  has_headers: boolean;
}

export interface McpServiceDetailView extends McpServiceView {
  command: string | null;
  args: string[] | null;
  file_args: Record<string, Record<string, string>>;
  /**
   * 算法规则参数设置（`{ 工具名: 字段名或对象路径 }`；空对象 = 不启用规则选择器）。
   *
   * **必须在详情里回显**：界面「保存 → 重载详情」覆盖表单，字段漏登会让配置
   * 保存成功却在界面上"消失"（2026-09-26 实测缺陷：`rules_fields` 与本字段同批漏登）。
   */
  rules_fields: Record<string, string>;
  /** 异步工具声明（R11；空数组 = 不启用）。同 `rules_fields`：必须在详情里回显 */
  async_tools: string[];
  /** 调用确认策略（HITL；`never` 为默认/存量行为） */
  confirmation: McpConfirmation;
  /** 工具白名单（2026-10-03）；空数组 = 不限制（白名单上线前的存量服务） */
  allowed_tools: string[];
  /**
   * **请求头（值已掩码）**（2026-10-08）：形如 `{"X-MCP-Token":"6UuE…F3Z"}`。
   *
   * 回显的必要性与 `rules_fields` 同（界面要能看出"配了令牌、值是什么形状"），
   * 但**值 MUST 掩码**（`maskHeaders`）——令牌明文不出现在任何响应里。
   * 界面据此展示；**MUST NOT** 把掩码提交回来做连接或保存（保存期会直接拒绝）。
   */
  headers: Record<string, string>;
  /**
   * 白名单里**当前服务清单中已不存在**的工具名（下架/改名）。
   *
   * 只在探测成功时才有意义（探测失败 = 核对不了 → 恒为空数组，由 `tools_error` 表达）；
   * 界面据此在白名单条目上标异常，MUST NOT 把"核对不了"呈现成"工具不存在"。
   */
  missing_tools: string[];
  /** 只含白名单里的工具（不限制时即服务全量），顺序与白名单一致 */
  tools: McpToolDescriptor[];
  tools_truncated: boolean;
  tools_error: string | null;
  references: Array<{ user_id: string; agent_name: string }>;
  revision: number;
}

export interface McpServiceListDeps {
  configs: McpServiceConfigService;
  mcpClient: McpClientService;
  /** 引用该服务的「用户 × 数字人」对（由路由层用引用推导提供，避免本模块耦合设计态） */
  referencesOf(serviceName: string): Array<{ user_id: string; agent_name: string }>;
  /** 平台设计态当前版本（详情响应里的乐观锁版本） */
  currentRevision(): number;
}

/** 工具清单的有界返回上限（`FR-006`：MUST NOT 无界返回） */
export const TOOLS_LIMIT = 100;

export class McpServiceListService {
  constructor(private readonly deps: McpServiceListDeps) {}

  /** 卡片列表：**平台配置即清单**（`FR-043`） */
  async list(): Promise<McpServiceView[]> {
    return this.deps.configs.listAll().map((config) => toView(config));
  }

  /** 服务详情：调用配置 + 工具清单 + 引用（`FR-044`、`FR-045`） */
  async detail(name: string): Promise<McpServiceDetailView | null> {
    const config = this.deps.configs.readOrNull(name);
    if (!config) return null;

    const { tools, error } = await this.safeTools(config);
    // 工具白名单（2026-10-03）：详情**只呈现白名单里的工具**（顺序与白名单一致），
    // 清单外的工具一律不下发——管理员看到的就是"数字人能看到的"。
    const allowed = config.allowed_tools;
    const scoped = allowed.length > 0;
    const visible = scoped
      ? allowed
          .map((toolName) => tools.find((tool) => tool.name === toolName))
          .filter((tool): tool is McpToolDescriptor => tool !== undefined)
      : tools;
    // 缺失核对只在探测成功时做：探测失败 = 核对不了（由 `tools_error` 表达），
    // 此时 MUST NOT 把白名单里的工具全判成"不存在"——那是误报
    const missing =
      scoped && error === null ? allowed.filter((n) => !tools.some((t) => t.name === n)) : [];
    return {
      ...toView(config),
      command: config.command,
      args: config.args,
      file_args: config.file_args,
      // 详情**必须**回显这两者：界面保存后会重载详情覆盖表单，漏一个就等于"保存即清空"
      rules_fields: config.rules_fields,
      async_tools: config.async_tools,
      confirmation: config.confirmation,
      allowed_tools: allowed,
      // 请求头**只回掩码**：界面要能看出"配了哪些头、值是什么形状"，但令牌明文不出响应
      headers: maskHeaders(config.headers),
      missing_tools: missing,
      // 先按白名单过滤、后截断：反过来的话，白名单里排在截断线之后的工具会被误判成"不存在"
      tools: visible.slice(0, TOOLS_LIMIT),
      tools_truncated: visible.length > TOOLS_LIMIT,
      tools_error: error,
      references: this.deps.referencesOf(name),
      revision: this.deps.currentRevision(),
    };
  }

  /**
   * 工具清单获取（`FR-045`）。
   * 不可得时**不报错**：返回空清单 + 可读原因（`tools_error`），
   * 让"服务没配好"与"服务连不上"在界面上可区分（契约 §3.2）。
   */
  private async safeTools(
    config: McpServiceConfig,
  ): Promise<{ tools: McpToolDescriptor[]; error: string | null }> {
    if (config.transport === 'http' && !config.url) {
      return { tools: [], error: '尚未配置连接地址，无法获取工具清单' };
    }
    try {
      const tools = await this.deps.mcpClient.listTools(config.name, {
        transport: config.transport,
        url: config.url,
        command: config.command,
        args: config.args,
        // 请求头（2026-10-08）：需要令牌的服务缺了它只会回 401，工具清单永远取不到
        headers: config.headers,
      });
      return { tools, error: null };
    } catch (err) {
      return { tools: [], error: err instanceof Error ? err.message : String(err) };
    }
  }
}

function toView(config: McpServiceConfig): McpServiceView {
  return {
    name: config.name,
    description: config.description,
    transport: config.transport,
    url: config.url,
    // 只回布尔量：请求头里通常是令牌，列表连掩码都不给
    has_headers: Object.keys(config.headers).length > 0,
  };
}
