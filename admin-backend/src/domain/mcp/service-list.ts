import type { McpClientService, McpToolDescriptor } from '../../infra/mcp-client.js';
import { maskHeaders } from './service-config-fields.js';
import type { McpConfirmation, McpServiceConfig, McpServiceConfigService } from './service-config.js';

/**
 * 工具清单项（2026-10-27）：服务端探测结果 + 平台配置的**显示名**。
 *
 * `label` 来自 `tool_labels`（缺省空串 = 未配置，界面回退英文工具名）。
 * 显示名不参与工具调用（调用名恒为 `name`），只用于平台清单展示与运行环境的
 * 意图聚焦命题——因此可以安全地"有则显示、无则回退"。
 */
export type McpToolView = McpToolDescriptor & { label: string };

export interface McpServiceView {
  name: string;
  description: string;
  transport: 'http' | 'stdio';
  url: string | null;
  /**
   * 是否配置了请求头（2026-10-08；卡片徽标用）。
   *
   * **只回布尔量**：请求头里通常是访问令牌，列表 MUST NOT 出现任何值（连掩码也不给）。
   */
  has_headers: boolean;
  /**
   * 工具白名单（2026-10-09）：数字人"问题实例"的工具关联需要在**列表**就拿到
   * 每个服务的可见工具——否则打开选择器要逐服务拉详情，而详情会**实际连接服务**探测
   * 工具清单（服务不可达时取不到）。
   *
   * 只回工具名清单：不含连接细节，也不含任何凭据（与 `has_headers` 的克制口径一致）。
   */
  allowed_tools: string[];
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
  confirmation: McpConfirmation;
  allowed_tools: string[];
  headers: Record<string, string>;
  /**
   * 白名单里**当前服务清单中已不存在**的工具名（下架/改名）。
   *
   * 只在探测成功时才有意义（探测失败 = 核对不了 → 恒为空数组，由 `tools_error` 表达）；
   * 界面据此在白名单条目上标异常，MUST NOT 把"核对不了"呈现成"工具不存在"。
   */
  missing_tools: string[];
  tool_labels: Record<string, string>;
  tools: McpToolView[];
  tools_truncated: boolean;
  available_tools: McpToolView[];
  available_tools_truncated: boolean;
  tools_error: string | null;
  references: Array<{ user_id: string; agent_name: string }>;
  revision: number;
}

export interface McpServiceListDeps {
  configs: McpServiceConfigService;
  mcpClient: McpClientService;
  /** 引用该服务的「用户 × 数字人」对（由路由层用引用推导提供，避免本模块耦合设计态） */
  referencesOf(serviceName: string): Array<{ user_id: string; agent_name: string }>;
  currentRevision(): number;
}

/** 工具清单的有界返回上限（`FR-006`：MUST NOT 无界返回） */
export const TOOLS_LIMIT = 100;

export class McpServiceListService {
  constructor(private readonly deps: McpServiceListDeps) {}

  async list(): Promise<McpServiceView[]> {
    return this.deps.configs.listAll().map((config) => toView(config));
  }

  async detail(name: string): Promise<McpServiceDetailView | null> {
    const config = this.deps.configs.readOrNull(name);
    if (!config) return null;

    const { tools, error } = await this.safeTools(config);
    const allowed = config.allowed_tools;
    const scoped = allowed.length > 0;
    const visible = scoped
      ? allowed
          .map((toolName) => tools.find((tool) => tool.name === toolName))
          .filter((tool): tool is McpToolDescriptor => tool !== undefined)
      : tools;
    // 此时 MUST NOT 把白名单里的工具全判成"不存在"——那是误报
    const missing = scoped && error === null ? allowed.filter((n) => !tools.some((t) => t.name === n)) : [];
    // 未配置时给**空串而非 undefined**：前端据此回退英文名，避免"字段有时在、有时不在"。
    const withLabels = (list: McpToolDescriptor[]): McpToolView[] =>
      list.map((tool) => ({ ...tool, label: config.tool_labels[tool.name]?.trim() ?? '' }));
    return {
      ...toView(config),
      command: config.command,
      args: config.args,
      file_args: config.file_args,
      // 详情**必须**回显：界面保存后会重载详情覆盖表单，漏一个就等于"保存即清空"
      rules_fields: config.rules_fields,
      confirmation: config.confirmation,
      allowed_tools: allowed,
      tool_labels: config.tool_labels,
      headers: maskHeaders(config.headers),
      missing_tools: missing,
      tools: withLabels(visible).slice(0, TOOLS_LIMIT),
      tools_truncated: visible.length > TOOLS_LIMIT,
      available_tools: withLabels(tools).slice(0, TOOLS_LIMIT),
      available_tools_truncated: tools.length > TOOLS_LIMIT,
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
    has_headers: Object.keys(config.headers).length > 0,
    allowed_tools: config.allowed_tools,
  };
}
