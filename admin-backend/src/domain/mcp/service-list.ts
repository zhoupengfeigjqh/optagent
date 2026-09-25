/**
 * MCP 服务清单投影（`FR-043`、`FR-045`、`FR-052`，`contracts/admin-api.md` §3.1/§3.2）。
 *
 * **清单以容器编排声明为唯一来源**（`FR-043`）：新增服务后无需任何平台侧配置
 * 即自动出现（`SC-010`）。平台还持有**调用配置**（`FR-044`），
 * 二者的比对结果就是 `in_compose` 与异常原因：
 *
 * | 情况 | `in_compose` | 异常 |
 * |---|---|---|
 * | 在编排中、也已配置 | `true` | 否 |
 * | 在编排中、尚未配置 | `true` | 否（`configured: false`，提示待配置） |
 * | **不在编排中、但平台仍有配置** | `false` | **是**（`FR-052`：已移除或改名） |
 */
import type { ComposeReader } from '../../infra/compose-reader.js';
import { ComposeReader as ComposeReaderClass } from '../../infra/compose-reader.js';
import type { ContainerStatus, DockerHost } from '../../infra/docker-host.js';
import type { McpClientService, McpToolDescriptor } from '../../infra/mcp-client.js';
import type { McpServiceConfigService } from './service-config.js';

export interface McpServiceView {
  name: string;
  description: string;
  transport: 'http' | 'stdio';
  status: ContainerStatus;
  in_compose: boolean;
  configured: boolean;
  abnormal_reason: string | null;
}

export interface McpServiceDetailView extends McpServiceView {
  endpoints: Record<string, string>;
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
  confirmation: 'never' | 'always' | { tools: string[] };
  tools: McpToolDescriptor[];
  tools_truncated: boolean;
  tools_error: string | null;
  compose_declaration: Record<string, unknown> | null;
  references: Array<{ user_id: string; agent_name: string }>;
  revision: number;
}

export interface McpServiceListDeps {
  compose: ComposeReader;
  docker: DockerHost;
  configs: McpServiceConfigService;
  mcpClient: McpClientService;
  /** 引用该服务的「用户 × 数字人」对（由路由层用引用推导提供，避免本模块耦合设计态） */
  referencesOf(serviceName: string): Array<{ user_id: string; agent_name: string }>;
  /** 目标运行形态（决定工具清单用哪个地址去连） */
  targetForm(): string;
  /** 平台设计态当前版本（详情响应里的乐观锁版本） */
  currentRevision(): number;
}

/** 工具清单的有界返回上限（`FR-006`：MUST NOT 无界返回） */
export const TOOLS_LIMIT = 100;

export class McpServiceListService {
  constructor(private readonly deps: McpServiceListDeps) {}

  /**
   * 卡片列表（`FR-043`）。
   *
   * 容器状态不可得时 `status` 记为 `unknown` 而**不是报错**——
   * 否则 Docker 一抖动整个 MCP 功能区就打不开，而管理员此时更需要看到清单。
   */
  async list(): Promise<McpServiceView[]> {
    const declared = this.deps.compose.listMcpServices();
    const statuses = await this.safeStatusMap();
    const configured = new Map(this.deps.configs.listAll().map((c) => [c.name, c]));

    const views: McpServiceView[] = declared.map((decl) => {
      const config = configured.get(decl.name);
      const status = statuses.get(decl.name) ?? 'unknown';
      return {
        name: decl.name,
        description: config?.description ?? '',
        transport: config?.transport ?? ComposeReaderClass.inferTransport(decl),
        status,
        in_compose: true,
        configured: config !== undefined,
        abnormal_reason: status === 'abnormal' ? '容器状态异常（反复重启或已停止响应）' : null,
      };
    });

    // 平台有配置、但编排里已经不存在的服务：异常态，给出具体差异（FR-052）
    for (const config of this.deps.configs.listAll()) {
      if (declared.some((decl) => decl.name === config.name)) continue;
      views.push({
        name: config.name,
        description: config.description,
        transport: config.transport,
        status: statuses.get(config.name) ?? 'unknown',
        in_compose: false,
        configured: true,
        abnormal_reason: `服务 ${config.name} 已不在容器编排声明中（可能已移除或改名）`,
      });
    }

    return views.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }

  /** 服务详情：调用配置 + 工具清单 + 编排原始声明 + 引用（`FR-044`、`FR-045`） */
  async detail(name: string): Promise<McpServiceDetailView | null> {
    const views = await this.list();
    const view = views.find((item) => item.name === name);
    const config = this.deps.configs.readOrNull(name);
    if (!view && !config) return null;
    // `view` 必然存在（config 存在时 list 会补出异常态条目），此处仅为类型收窄
    const base: McpServiceView = view ?? {
      name,
      description: '',
      transport: 'http',
      status: 'unknown',
      in_compose: false,
      configured: false,
      abnormal_reason: null,
    };

    const declaration = safeFind(this.deps.compose, name);
    const { tools, error } = await this.safeTools(name, config);

    return {
      ...base,
      endpoints: config?.endpoints ?? {},
      command: config?.command ?? null,
      args: config?.args ?? null,
      file_args: config?.file_args ?? {},
      // 详情**必须**回显这两者：界面保存后会重载详情覆盖表单，漏一个就等于"保存即清空"
      rules_fields: config?.rules_fields ?? {},
      async_tools: config?.async_tools ?? [],
      confirmation: config?.confirmation ?? 'never',
      tools: tools.slice(0, TOOLS_LIMIT),
      tools_truncated: tools.length > TOOLS_LIMIT,
      tools_error: error,
      compose_declaration: declaration ? (declaration.raw as Record<string, unknown>) : null,
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
    name: string,
    config: { transport: 'http' | 'stdio'; endpoints: Record<string, string>; command: string | null; args: string[] | null } | null,
  ): Promise<{ tools: McpToolDescriptor[]; error: string | null }> {
    if (!config) return { tools: [], error: '尚未配置服务级调用信息' };
    if (config.transport === 'http' && !config.endpoints[this.deps.targetForm()]) {
      return {
        tools: [],
        error: `缺少目标运行形态（${this.deps.targetForm()}）的连接地址，无法获取工具清单`,
      };
    }
    try {
      const tools = await this.deps.mcpClient.listTools(name, {
        transport: config.transport,
        url: config.endpoints[this.deps.targetForm()] ?? null,
        command: config.command,
        args: config.args,
      });
      return { tools, error: null };
    } catch (err) {
      return { tools: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async safeStatusMap(): Promise<Map<string, ContainerStatus>> {
    try {
      return await this.deps.docker.statusMap();
    } catch {
      // Docker 不可达：清单照常返回，状态一律 unknown（FR-043）
      return new Map();
    }
  }
}

function safeFind(compose: ComposeReader, name: string) {
  try {
    return compose.find(name);
  } catch {
    return null;
  }
}
