/**
 * MCP **调用配置**（`FR-044`、`FR-056`，`data-model.md` §3.2）。
 *
 * 「服务级」的含义：**同一服务只有一份配置**，修改它 MUST **自动作用于所有
 * 引用它的数字人**（下次部署生效），MUST NOT 要求逐个改动数字人。
 *
 * 连接地址按**运行形态分别声明**（`endpoints`）：这是 `FR-056` 的落点——
 * 容器编排内网用服务名（`http://ocr:8000/mcp`），宿主机本地用可达地址。
 * 目标运行形态缺地址即**阻止部署**，MUST NOT 静默回退到另一形态
 * （`FR-057`、`ADM_RUNTIME_FORM_NOT_CONFIGURED`）。
 */
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import { runtimeFormLabel, type RuntimeForm } from '../platform-settings.js';
import {
  FILE_ARG_PATH_HINT,
  isCompatibleFromPath,
  isValidFileArgPath,
  parseFileArgMode,
} from './file-arg-path.js';
import { MCP_TRANSPORT_HINT, normalizeTransport, type McpTransport } from './transport.js';
import { RULES_FIELD_PATH_HINT, parseRulesFieldPath } from './rules-field-path.js';
import type { PlatformStore } from '../../infra/platform-store.js';

const REL = 'mcp-services.json';

// 归一后的规范取值类型（`http` 即 Streamable HTTP）；对外仍从本模块导出，保持既有引用不变
export type { McpTransport };

export interface McpServiceConfig {
  name: string;
  /** 用途描述（供卡片展示，`FR-006`）；可为空串 */
  description: string;
  transport: McpTransport;
  /** 按运行形态分别声明的连接地址：`{ [运行形态标识]: 地址 }` */
  endpoints: Record<string, string>;
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
  updated_at: string;
}

/** 调用确认策略（与运行环境 `McpConfirmation` 同一口径） */
export type McpConfirmation = 'never' | 'always' | { tools: string[] };

interface Document {
  items: Record<string, McpServiceConfig>;
}

export interface McpConfigInput {
  description?: unknown;
  transport?: unknown;
  endpoints?: unknown;
  command?: unknown;
  args?: unknown;
  writable?: unknown;
  permission_scope?: unknown;
  file_args?: unknown;
  confirmation?: unknown;
  rules_fields?: unknown;
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
   * 目标运行形态下的连接地址；缺该形态即 `null`
   * （由调用方决定是"阻止部署"还是"呈现为未配置"）。
   */
  endpointFor(name: string, form: RuntimeForm | string): string | null {
    const config = this.readOrNull(name);
    const value = config?.endpoints?.[form];
    return typeof value === 'string' && value.trim() !== '' ? value : null;
  }

  /** 保存调用配置（`FR-044`）；返回保存后的配置与新 revision */
  upsert(
    name: string,
    input: McpConfigInput,
    revision: number,
  ): { config: McpServiceConfig; revision: number } {
    let validated!: McpServiceConfig;
    const { revision: nextRevision } = this.store.withRevision(revision, () => {
      validated = this.normalize(name, input);
      const doc = this.store.readJson<Document>(REL) ?? { items: {} };
      doc.items[name] = validated;
      this.store.writeJson(REL, doc);
    });

    const doc = this.store.readJson<Document>(REL);
    return { config: doc?.items?.[name] ?? validated, revision: nextRevision };
  }

  private normalize(name: string, input: McpConfigInput): McpServiceConfig {
    const description = typeof input.description === 'string' ? input.description : '';
    // 别名（`streamable-http`）在入口归一为 `http`：见 `mcp/transport.ts`
    const transport = normalizeTransport(input.transport);
    if (transport === null) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `transport 须为 ${MCP_TRANSPORT_HINT}（当前：${JSON.stringify(input.transport)}）`,
      );
    }

    const endpoints = normalizeEndpoints(input.endpoints);
    if (Object.keys(endpoints).length === 0) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        'endpoints 至少需要一个运行形态的连接地址（FR-056）',
      );
    }

    // 启动命令与参数只对 stdio 有意义：http 形态下**丢弃**它们，
    // 避免"同一个服务里残留一份用不上的命令"这种隐性配置漂移。
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
      endpoints,
      command,
      args,
      file_args: normalizeFileArgs(input.file_args),
      confirmation: normalizeConfirmation(input.confirmation),
      rules_fields: normalizeRulesFields(input.rules_fields),
      updated_at: new Date().toISOString(),
    };
  }
}

/**
 * 读取时收敛为当前 schema：历史存档里的遗留字段（`writable`/`permission_scope`，
 * 已按 2026-09-15 的产品决定移除）不再透出到任何响应里。
 */
function sanitize(raw: McpServiceConfig): McpServiceConfig {
  return {
    name: raw.name,
    description: typeof raw.description === 'string' ? raw.description : '',
    // 历史文档可能写着别名（`streamable-http`）：读取时归一，界面与物化都只用规范值；
    // 完全不认识的值保持原样透出（不阻断读取，也不静默改写成别的传输方式）
    transport: normalizeTransport(raw.transport) ?? raw.transport,
    endpoints: raw.endpoints ?? {},
    command: raw.command ?? null,
    args: Array.isArray(raw.args) ? raw.args : null,
    file_args: raw.file_args ?? {},
    // 历史存档无该字段：读取时容错收敛为 never（存量行为不变）
    confirmation: readConfirmation(raw.confirmation),
    // 历史存档无该字段（或 2026-09-19 早些时候的 string 版 `rules_field`，
    // 工具名不可得）：一律收敛为 {}（不启用规则选择器）
    rules_fields: readRulesFields(raw.rules_fields ?? (raw as { rules_field?: unknown }).rules_field),
    updated_at: raw.updated_at,
  };
}

/**
 * 算法规则参数设置（保存期）：`{ 工具名: 字段名或对象路径 }`。
 * 缺省 → `{}`（不启用）；非对象/值不是合法字段路径 → 报错——typo 挡在保存期，
 * 避免"以为开了选择器实际没开"。
 *
 * 与 `file_args` 同口径：**只校验语法，不校验工具 schema**（工具清单是探测结果，
 * 服务不可达时拿不到；拿不到就拒保存会把"服务抖动"变成"配置改不了"）。
 */
function normalizeRulesFields(raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'rules_fields 须为对象 { 工具名: 字段名 }，可为 {}');
  }
  const out: Record<string, string> = {};
  for (const [tool, field] of Object.entries(raw as Record<string, unknown>)) {
    if (parseRulesFieldPath(field) === null) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `rules_fields.${tool} 须为${RULES_FIELD_PATH_HINT}，当前：${JSON.stringify(field)}`,
      );
    }
    out[tool] = (field as string).trim();
  }
  return out;
}

/**
 * 读取路径的容错收敛：历史存档里的 string 版 `rules_field`（无工具名可归属）
 * 与任何残缺值一律收敛为 `{}`（不阻断读取存量文档，存量行为 = 不启用）。
 *
 * **非法路径同样在此丢弃**（2026-09-22）：运行环境在加载期把非法路径判为配置错误，
 * 若把存量文档里的非法值原样物化进 `MCP.json`，一次部署就会让整个数字人加载失败——
 * 读取期收敛掉，破坏面止于"该声明不生效"（与 `confirmation` 的收敛口径一致）。
 */
function readRulesFields(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [tool, field] of Object.entries(raw as Record<string, unknown>)) {
    if (parseRulesFieldPath(field) !== null) out[tool] = (field as string).trim();
  }
  return out;
}

/** 读取路径的容错收敛：不认识/残缺的值一律回落 never（不阻断读取存量文档） */
function readConfirmation(raw: unknown): McpConfirmation {
  if (raw === 'always') return 'always';
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const tools = (raw as Record<string, unknown>).tools;
    if (Array.isArray(tools) && tools.length > 0 && tools.every((t) => typeof t === 'string')) {
      return { tools: tools as string[] };
    }
  }
  return 'never';
}

function normalizeEndpoints(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'endpoints 须为对象（键为运行形态标识）');
  }
  const out: Record<string, string> = {};
  for (const [form, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `endpoints.${form} 须为非空字符串（${runtimeFormLabel(form)}）`,
      );
    }
    out[form] = value.trim();
  }
  return out;
}

/**
 * 调用确认策略（HITL）：缺省/非法即 `never` 还是报错？
 * ——报错。这是安全相关开关，把 typo 挡在保存期（"以为开了确认实际没开"比报错更糟）。
 */
function normalizeConfirmation(raw: unknown): McpConfirmation {
  if (raw === undefined || raw === null || raw === 'never') return 'never';
  if (raw === 'always') return 'always';
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const tools = (raw as Record<string, unknown>).tools;
    if (Array.isArray(tools) && tools.length > 0 && tools.every((t) => typeof t === 'string')) {
      return { tools: tools as string[] };
    }
  }
  throw new ApiError(
    ERROR_CODES.VALIDATION_FAILED,
    'confirmation 须为 "never" | "always" | { "tools": string[] }（tools 非空）',
  );
}

function normalizeFileArgs(raw: unknown): Record<string, Record<string, string>> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'file_args 须为对象，可为 {}');
  }
  const out: Record<string, Record<string, string>> = {};
  for (const [tool, params] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof params !== 'object' || params === null || Array.isArray(params)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `file_args.${tool} 须为对象`);
    }
    const inner: Record<string, string> = {};
    for (const [param, modeRaw] of Object.entries(params as Record<string, unknown>)) {
      const mode = parseFileArgMode(modeRaw);
      if (!mode) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_FAILED,
          `file_args.${tool}.${param} 仅支持 "url" 或 "url:from=<取值路径>"（与运行环境口径一致）`,
        );
      }
      // 取值路径的语法与运行环境同一判据（`file-arg-path.ts` 两侧同构）：
      // 在这里拦住，总好过"保存成功、物化成功、运行期静默不生效"
      if (!isValidFileArgPath(param)) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_FAILED,
          `file_args.${tool} 的「${param}」不是合法取值路径（${FILE_ARG_PATH_HINT}）`,
        );
      }
      if (mode.from !== undefined) {
        if (!isValidFileArgPath(mode.from)) {
          throw new ApiError(
            ERROR_CODES.VALIDATION_FAILED,
            `file_args.${tool}.${param} 的来源「${mode.from}」不是合法取值路径（${FILE_ARG_PATH_HINT}）`,
          );
        }
        if (!isCompatibleFromPath(param, mode.from)) {
          throw new ApiError(
            ERROR_CODES.VALIDATION_FAILED,
            `file_args.${tool}.${param} 的派生来源「${mode.from}」与目标形状不相容：` +
              '两段数须相同，且除最后一段外逐段一致（如 items[].excelFileUrl ← items[].realRelativePath）',
          );
        }
      }
      inner[param] = modeRaw as string;
    }
    out[tool] = inner;
  }
  return out;
}
