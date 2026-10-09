/**
 * MCP **调用配置**（`FR-044`，`data-model.md` §3.2；2026-09-27 改版）。
 *
 * 「服务级」的含义：**同一服务只有一份配置**，修改它 MUST **自动作用于所有
 * 引用它的数字人**（下次部署生效），MUST NOT 要求逐个改动数字人。
 *
 * **2026-09-27 产品决定（全人工配置）**：MCP 服务不再取自容器编排声明、
 * 不再区分"容器编排内网 / 宿主机本地"**运行形态**，因此连接地址由
 * `endpoints: Record<形态, 地址>` 收敛为**单一 `url`**；服务本体（名称/用途/
 * 传输方式/连接信息）一律由管理员在平台新建与维护——平台是 MCP 服务配置的
 * **唯一权威源**。
 *
 * 存量迁移：旧文档里的 `endpoints` 在**读取期**收敛为 `url`（见 `readUrl`），
 * 保证升级后既有服务不丢配置；物化与下发的仍只有一份地址。
 *
 * **2026-10-03 新增工具白名单 `allowed_tools`**（产品决定）：
 * 新建服务时 MUST 先连上服务、由管理员勾选可见工具（至少一个），此后：
 * - 平台详情**只呈现白名单里的工具**（清单外的一律不显示）；
 * - 运行环境只把白名单里的工具挂给数字人（模型看不到其余工具）；
 * - 白名单**创建后不可二次调整**（`upsert` 显式拒绝该字段）——如需变更请删除重建。
 *
 * **2026-10-08 新增请求头 `headers`**（本体侧「自建发布」要求 `X-MCP-Token`，否则 401）：
 * - 存**明文**（服务按原样发送），但**响应只回掩码**、列表只回 `has_headers`；
 * - 保存语义：**缺省 = 沿用存量**，**提供 = 全量替换**（`{}` 即清空）；
 * - 仅对 `transport=http` 有意义（`stdio` 保存期丢弃）；
 * - 物化时**非空才写**进 `MCP.json`，运行环境装配 MCP 客户端时带 `requestInit.headers`。
 */
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import { MCP_TRANSPORT_HINT, normalizeTransport, type McpTransport } from './transport.js';
import {
  MCP_SERVICE_NAME_HINT,
  MCP_URL_HINT,
  isValidMcpServiceName,
  normalizeAllowedTools,
  normalizeAsyncTools,
  normalizeConfirmation,
  normalizeFileArgs,
  normalizeHeaders,
  normalizeRulesFields,
  normalizeUrl,
  sanitize,
} from './service-config-fields.js';
import type { PlatformStore } from '../../infra/platform-store.js';

const REL = 'mcp-services.json';

// 归一后的规范取值类型（`http` 即 Streamable HTTP）；对外仍从本模块导出，保持既有引用不变
export type { McpTransport };

// 字段判据与提示语已拆到 `service-config-fields.ts`（2026-10-03，原则二：本文件曾超 500 行）；
// 这里继续对外提供同名导出，既有引用（表单提示语、错误文案）不变
export { MCP_SERVICE_NAME_HINT, MCP_URL_HINT, isValidMcpServiceName };

export interface McpServiceConfig {
  name: string;
  /** 用途描述（供卡片展示，`FR-006`）；可为空串 */
  description: string;
  transport: McpTransport;
  /** 连接地址（`transport=http` 时必填；`stdio` 时无意义、恒为 `null`） */
  url: string | null;
  command: string | null;
  args: string[] | null;
  /**
   * 文件参数映射：`{ 工具名: { 取值路径: "url" | "url:from=<来源路径>" } }`。
   * 取值路径可以是顶层参数名（`{"ocr_image": {"image": "url"}}`），
   * 也可以穿过数组（`{"parse_excel_files": {"items[].excelFileUrl": "url"}}`）——
   * 语法见 `file-arg-path.ts`（2026-09-16：对象数组的入参曾"配了也不生效"）。
   * `"url:from="` 派生模式（2026-09-18）：目标字段的值由运行环境从来源路径推导
   * 注入、覆盖模型填写，且对 LLM 隐藏——根治模型对 http 地址字段的幻觉。
   */
  file_args: Record<string, Record<string, string>>;
  /**
   * 调用确认策略（HITL，人机交互门）：`never` 直跑（默认/存量行为）、
   * `always` 该服务全部工具调用前弹参数确认窗、`{ tools: [...] }` 仅列出的
   * 原始工具名需确认。经部署物化进运行环境 `MCP.json` 后由 agent-backend 装配生效。
   */
  confirmation: McpConfirmation;
  /**
   * 算法规则参数设置（可选，空对象 = 不启用）：`{ 工具名: 字段名或对象路径 }`——该工具
   * 入参里承载 `array[object]` 规则清单的字段。声明后，用户侧 HITL 参数确认窗中
   * 该字段出现「从算法规则选择」入口（读取「数据准备/算法规则」最新规则文件）；
   * 运行环境据此把路径带进 interaction 快照。**不改变是否走 HITL**
   * （仍只由 `confirmation` 决定）：`confirmation: never` 时本映射不生效。
   * 工具不在确认范围内时的映射同样不生效（工具未被包装即无挂起点）。
   *
   * 取值支持**对象嵌套**（如 `input.targetPriorities`，2026-09-22）：规则数组常在入参
   * 对象内部，只认顶层字段名会让这类声明静默失效。语法见 `rules-field-path.ts`。
   */
  rules_fields: Record<string, string>;
  /**
   * 异步工具声明（R11，2026-09-25）：该服务**自己的原始工具名**（不含 `{server}__` 前缀）
   * 清单。声明后，运行环境在调用这些工具时注入 `resultUrl`（签名写直链），服务算完把
   * 结果回写到用户空间，并在下一轮对话注入「后台计算结果」清单
   * （完整语义见 `contracts/runtime-api-delta.md` §10）。
   *
   * **不改变工具是否同步、也不改变是否走 HITL**——只是给被声明的工具多注入一个回写地址。
   * 空数组 = 不启用（存量行为零变化）；物化时**非空才写**进 `MCP.json`。
   */
  async_tools: string[];
  /**
   * **工具白名单**（2026-10-03）：该服务**可见**的原始工具名清单（不含 `{server}__` 前缀）。
   *
   * - 平台详情只呈现这里面的工具；运行环境只把这些工具挂给数字人（其余对模型不可见）；
   * - **创建时必填非空**（新建流程 = 连上服务 → 勾选 → 创建），**之后不可修改**；
   * - 空数组 = **不限制**（历史语义；物化时不写该字段，运行环境放行全部工具）——
   *   只为兼容"白名单上线前的存量服务"，新创建不可能产出空数组。
   */
  allowed_tools: string[];
  /**
   * **请求头**（2026-10-08）：`{ 头名: 值 }`，仅对 `transport=http` 有意义
   * （`stdio` 保存期即丢弃——请求头是 HTTP 的概念，`stdio` 由启动参数/环境变量承载）。
   *
   * 用于**需要访问令牌**的服务（本体侧「自建发布」的动态容器要求 `X-MCP-Token`，
   * 缺了直接 401；见 `optonto/config/mcp-config.json` 的既有约定）。两条纪律：
   * - **不进任何响应明文**：详情/新建/保存响应一律经 `maskHeaders` 回显掩码
   *   （形如 `6UuE…F3Z`），列表只给 `has_headers` 布尔量；
   * - **不进日志**：本文件与物化都不打印值（信任边界与 `.env.local` 同级——本机私产）。
   *
   * 缺省 `{}` = 不带请求头（存量服务行为零变化）；物化时**非空才写**进 `MCP.json`
   * （与 `file_args`/`async_tools`/`allowed_tools` 同一口径）。
   */
  headers: Record<string, string>;
  updated_at: string;
}

/** 调用确认策略（与运行环境 `McpConfirmation` 同一口径） */
export type McpConfirmation = 'never' | 'always' | { tools: string[] };

interface Document {
  items: Record<string, McpServiceConfig>;
}

export interface McpConfigInput {
  name?: unknown;
  description?: unknown;
  transport?: unknown;
  url?: unknown;
  command?: unknown;
  args?: unknown;
  writable?: unknown;
  permission_scope?: unknown;
  file_args?: unknown;
  confirmation?: unknown;
  rules_fields?: unknown;
  async_tools?: unknown;
  /** 工具白名单（2026-10-03）：**仅新建时接受**；`upsert` 携带即拒绝（不可二次调整） */
  allowed_tools?: unknown;
  /** 请求头（2026-10-08）：缺省 = 沿用存量，提供 = 全量替换（`{}` 即清空） */
  headers?: unknown;
}

export class McpServiceConfigService {
  constructor(private readonly store: PlatformStore) {}

  listAll(): McpServiceConfig[] {
    const doc = this.store.readJson<Document>(REL);
    const items = doc?.items;
    if (!items || typeof items !== 'object') return [];
    return Object.values(items)
      .map(sanitize)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }

  readOrNull(name: string): McpServiceConfig | null {
    const doc = this.store.readJson<Document>(REL);
    const raw = doc?.items?.[name] ?? null;
    return raw ? sanitize(raw) : null;
  }

  read(name: string): McpServiceConfig {
    const config = this.readOrNull(name);
    if (!config) {
      throw new ApiError(ERROR_CODES.ADM_MCP_SERVICE_NOT_FOUND, `MCP 服务 ${name} 尚未配置`);
    }
    return config;
  }

  exists(name: string): boolean {
    return this.readOrNull(name) !== null;
  }

  /**
   * **新建**服务（2026-09-27；2026-10-03 起要求工具白名单）：
   * 名称由管理员指定，重名即拒（`ADM_MCP_SERVICE_EXISTS`）；
   * **`allowed_tools` 必填非空**——白名单是"创建时定、之后不可改"的，
   * 因此创建期漏传即拒绝，避免留下"全部工具放行"的服务。
   * `revision` 可选——带了即做乐观锁校验，缺省按"当前版本"写入并递增。
   */
  create(input: McpConfigInput, revision?: number): { config: McpServiceConfig; revision: number } {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!isValidMcpServiceName(name)) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `MCP 服务名非法：${JSON.stringify(input.name)}（${MCP_SERVICE_NAME_HINT}）`,
      );
    }
    if (this.exists(name)) {
      throw new ApiError(ERROR_CODES.ADM_MCP_SERVICE_EXISTS, `MCP 服务名称已存在：${name}`);
    }
    const allowedTools = normalizeAllowedTools(input.allowed_tools, true);
    // 新建没有"存量"可沿用：`headers` 缺省即 {}
    const nextRevision = this.write(name, input, allowedTools, {}, revision);
    return { config: this.read(name), revision: nextRevision };
  }

  /**
   * 新建前的**只校验不落盘**（给路由层用）：让"重名/字段非法"先于连接探测失败，
   * 避免为一个注定失败的新建去连一次 MCP 服务。
   */
  validateForCreate(input: McpConfigInput): void {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!isValidMcpServiceName(name)) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `MCP 服务名非法：${JSON.stringify(input.name)}（${MCP_SERVICE_NAME_HINT}）`,
      );
    }
    if (this.exists(name)) {
      throw new ApiError(ERROR_CODES.ADM_MCP_SERVICE_EXISTS, `MCP 服务名称已存在：${name}`);
    }
    normalizeAllowedTools(input.allowed_tools, true);
    this.normalize(name, input, [], {});
  }

  /** **删除**服务（2026-09-27）；不存在即 404。影响面由路由层用引用推导呈现。 */
  remove(name: string, revision?: number): { name: string; revision: number } {
    if (!this.exists(name)) {
      throw new ApiError(ERROR_CODES.ADM_MCP_SERVICE_NOT_FOUND, `MCP 服务不存在：${name}`);
    }
    const removeItem = (): void => {
      const doc = this.store.readJson<Document>(REL) ?? { items: {} };
      delete doc.items[name];
      this.store.writeJson(REL, doc);
    };
    const nextRevision =
      revision === undefined
        ? (removeItem(), this.store.bumpRevision())
        : this.store.withRevision(revision, removeItem).revision;
    return { name, revision: nextRevision };
  }

  /**
   * 保存调用配置（`FR-044`）；服务必须已存在（新建走 `create`）。
   *
   * **工具白名单不可二次调整**（2026-10-03）：携带 `allowed_tools` 直接拒绝
   * （`ADM_MCP_TOOL_SCOPE_LOCKED`）——静默忽略会让客户端以为改成功了；
   * 不携带时沿用已存值（保存调用配置 MUST NOT 顺手清空白名单）。
   *
   * **请求头（2026-10-08）与白名单相反：可以改**（令牌会轮换，锁死会逼人删服务重建）。
   * 语义为"**缺省 = 沿用存量，提供 = 全量替换**"：不带 `headers` 的保存 MUST NOT
   * 顺手清空令牌（那会让运行环境在下一次部署后突然 401，且从界面上看不出来）。
   */
  upsert(
    name: string,
    input: McpConfigInput,
    revision: number,
  ): { config: McpServiceConfig; revision: number } {
    const existing = this.readOrNull(name);
    if (!existing) {
      throw new ApiError(ERROR_CODES.ADM_MCP_SERVICE_NOT_FOUND, `MCP 服务不存在：${name}`);
    }
    if (input.allowed_tools !== undefined) {
      throw new ApiError(
        ERROR_CODES.ADM_MCP_TOOL_SCOPE_LOCKED,
        `MCP 服务 ${name} 的工具白名单只在创建时设定，不支持修改；如需变更请删除该服务后重新创建`,
      );
    }
    // 请求头（2026-10-08）：缺省沿用存量——保存调用配置 MUST NOT 顺手清空令牌
    const nextRevision = this.write(name, input, existing.allowed_tools, existing.headers, revision);
    return { config: this.read(name), revision: nextRevision };
  }

  /** 校验 + 落盘的公共段（create / upsert 共用） */
  private write(
    name: string,
    input: McpConfigInput,
    allowedTools: string[],
    fallbackHeaders: Record<string, string>,
    revision?: number,
  ): number {
    let validated!: McpServiceConfig;
    const commit = (): void => {
      validated = this.normalize(name, input, allowedTools, fallbackHeaders);
      const doc = this.store.readJson<Document>(REL) ?? { items: {} };
      doc.items[name] = validated;
      this.store.writeJson(REL, doc);
    };
    if (revision === undefined) {
      commit();
      return this.store.bumpRevision();
    }
    return this.store.withRevision(revision, commit).revision;
  }

  private normalize(
    name: string,
    input: McpConfigInput,
    allowedTools: string[],
    fallbackHeaders: Record<string, string>,
  ): McpServiceConfig {
    const description = typeof input.description === 'string' ? input.description : '';
    // 别名（`streamable-http`）在入口归一为 `http`：见 `mcp/transport.ts`
    const transport = normalizeTransport(input.transport);
    if (transport === null) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `transport 须为 ${MCP_TRANSPORT_HINT}（当前：${JSON.stringify(input.transport)}）`,
      );
    }

    // 连接地址：http 必填；stdio 丢弃（与"http 丢弃 command/args"对称，避免隐性配置漂移）
    const url = normalizeUrl(input.url);
    if (transport === 'http' && url === null) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `transport=http 时 url 必填（${MCP_URL_HINT}）`,
      );
    }

    // 启动命令与参数只对 stdio 有意义
    const command =
      transport === 'stdio' && typeof input.command === 'string' && input.command.trim() !== ''
        ? input.command
        : null;
    const args = transport === 'stdio' && Array.isArray(input.args) ? input.args.map(String) : null;
    if (transport === 'stdio' && !command) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'transport=stdio 时 command 必填');
    }

    return {
      name,
      description,
      transport,
      url: transport === 'http' ? url : null,
      command,
      args,
      file_args: normalizeFileArgs(input.file_args),
      confirmation: normalizeConfirmation(input.confirmation),
      rules_fields: normalizeRulesFields(input.rules_fields),
      async_tools: normalizeAsyncTools(input.async_tools),
      allowed_tools: allowedTools,
      // 请求头只对 http 有意义：stdio 丢弃（与"http 丢弃 command/args"对称，
      // 避免留下一条永远不生效、却在界面上显示"已配置令牌"的隐性配置）
      headers: transport === 'http' ? normalizeHeaders(input.headers, fallbackHeaders) : {},
      updated_at: new Date().toISOString(),
    };
  }
}

// 字段判据与读取收敛已迁至 `service-config-fields.ts`（2026-10-03 拆件，原则二）
