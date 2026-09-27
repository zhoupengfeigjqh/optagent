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
import type { McpConfirmation, McpServiceConfig, McpServiceConfigService } from './service-config.js';

export interface McpServiceView {
  name: string;
  description: string;
  transport: 'http' | 'stdio';
  /** 连接地址（`http` 服务必有；`stdio` 为 `null`） */
  url: string | null;
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
    return {
      ...toView(config),
      command: config.command,
      args: config.args,
      file_args: config.file_args,
      // 详情**必须**回显这两者：界面保存后会重载详情覆盖表单，漏一个就等于"保存即清空"
      rules_fields: config.rules_fields,
      async_tools: config.async_tools,
      confirmation: config.confirmation,
      tools: tools.slice(0, TOOLS_LIMIT),
      tools_truncated: tools.length > TOOLS_LIMIT,
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
  };
}
