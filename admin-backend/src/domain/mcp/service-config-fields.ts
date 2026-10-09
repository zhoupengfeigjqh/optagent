/**
 * MCP 调用配置的**字段判据与归一**（2026-10-03 自 `service-config.ts` 拆出）。
 *
 * 自 `service-config.spec.ts` 同一原则（宪章原则二，单文件 ≤500 行）：本模块只放**纯函数**——
 * 保存期的 `normalize*`（非法即报错，把 typo 挡在保存期）与读取期的 `read*`/`sanitize`
 * （残缺值收敛，不阻断读取存量文档）；服务类与对外类型留在 `service-config.ts`。
 *
 * 两侧判据 MUST 与运行环境（`agent-backend/src/domain/agent-instance.ts`）**同口径**，
 * 否则会出现"平台保存得进去、运行环境加载不了"（或反过来）。
 */
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import {
  FILE_ARG_PATH_HINT,
  isCompatibleFromPath,
  isValidFileArgPath,
  parseFileArgMode,
} from './file-arg-path.js';
import { RULES_FIELD_PATH_HINT, parseRulesFieldPath } from './rules-field-path.js';
import { normalizeTransport } from './transport.js';
import type { McpConfirmation, McpServiceConfig } from './service-config.js';

/** 服务名判据提示（新建表单与报错共用） */
export const MCP_SERVICE_NAME_HINT =
  '由字母、数字、下划线或连字符组成，1~64 字符（会成为运行环境的工具前缀）';

/**
 * 服务名判据：它同时是运行环境里的工具前缀（`{server}__{tool}`），
 * 故不允许空白、路径分隔符与中文等会污染工具名的字符。
 */
export function isValidMcpServiceName(name: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(name);
}

/** 连接地址判据提示 */
export const MCP_URL_HINT = 'http(s):// 开头的可达地址，如 http://192.168.1.2:8000/mcp';

/** 连接地址归一：非空字符串且为 http(s) 绝对地址；否则 `null` */
function normalizeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const value = raw.trim();
  if (!/^https?:\/\/.+/i.test(value)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `url 须为 ${MCP_URL_HINT}（当前：${value}）`);
  }
  return value;
}

/**
 * 读取时收敛为当前 schema：历史存档里的遗留字段（`writable`/`permission_scope`，
 * 已按 2026-09-15 的产品决定移除）不再透出到任何响应里。
 *
 * `url` 另含**存量迁移**（2026-09-27）：旧文档是 `endpoints` 多形态对象。
 */
export function sanitize(raw: McpServiceConfig): McpServiceConfig {
  return {
    name: raw.name,
    description: typeof raw.description === 'string' ? raw.description : '',
    // 历史文档可能写着别名（`streamable-http`）：读取时归一，界面与物化都只用规范值；
    // 完全不认识的值保持原样透出（不阻断读取，也不静默改写成别的传输方式）
    transport: normalizeTransport(raw.transport) ?? raw.transport,
    url: readUrl(raw),
    command: raw.command ?? null,
    args: Array.isArray(raw.args) ? raw.args : null,
    file_args: raw.file_args ?? {},
    // 历史存档无该字段：读取时容错收敛为 never（存量行为不变）
    confirmation: readConfirmation(raw.confirmation),
    // 历史存档无该字段（或 2026-09-19 早些时候的 string 版 `rules_field`，
    // 工具名不可得）：一律收敛为 {}（不启用规则选择器）
    rules_fields: readRulesFields(raw.rules_fields ?? (raw as { rules_field?: unknown }).rules_field),
    // 历史存档无该字段：读取时容错收敛为 []（存量行为 = 不启用）
    async_tools: readAsyncTools(raw.async_tools),
    // 历史存档（白名单上线前）无该字段：收敛为 []（= 不限制，存量行为零变化）
    allowed_tools: readAllowedTools(raw.allowed_tools),
    // 历史存档（请求头上线前）无该字段：收敛为 {}（= 不带请求头，存量行为零变化）；
    // 存量文档里的脏值逐项丢弃，不让一条坏数据把整个服务打成不可读
    headers: readHeaders(raw.headers),
    updated_at: raw.updated_at,
  };
}

/**
 * 工具白名单归一（2026-10-03）。
 *
 * - 元素为**该服务的原始工具名**（不含 `{server}__` 前缀），trim 后去重；
 * - **不校验名字是否真实存在**：清单是探测结果，服务不可达时也要能保存
 *   （与 `rules_fields`/`async_tools` 的既有约定一致），名字漂移由详情页的白名单核对呈现；
 * - `required = true`（新建）：缺字段 / 空数组都拒绝——白名单创建后不可改，
 *   所以 MUST 在创建这一步就问清楚，不留"全部工具放行"的后门。
 */
export function normalizeAllowedTools(raw: unknown, required: boolean): string[] {
  if (raw === undefined || raw === null) {
    if (required) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        'allowed_tools 必填：请先连接该服务并至少勾选一个可见工具',
      );
    }
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `allowed_tools 须为字符串数组（工具名清单），当前：${JSON.stringify(raw)}`,
    );
  }
  const names: string[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `allowed_tools 的元素须为非空字符串，当前：${JSON.stringify(item)}`,
      );
    }
    const name = item.trim();
    if (!names.includes(name)) names.push(name);
  }
  if (required && names.length === 0) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      'allowed_tools 至少需要一个工具：未勾选任何工具的服务无法被数字人使用',
    );
  }
  return names;
}

/** 读取路径的白名单收敛：非数组/残缺值一律丢弃（不阻断读取存量文档），缺省 = 不限制 */
function readAllowedTools(raw: unknown): string[] {
  return Array.isArray(raw) ? normalizeAllowedTools(raw, false) : [];
}

/**
 * 请求头（2026-10-08）。
 *
 * 为什么需要：本体侧「自建发布」的动态容器**要求调用方带访问令牌头**
 * （`X-MCP-Token`，缺了直接 401）。平台是 MCP 服务配置的**唯一权威源**，
 * 因此令牌必须能存在平台、并随部署物化进运行环境——否则平台侧探测/测试
 * 与数字人实际调用都会 401，而服务本身看起来是好的。
 *
 * **与其它调用配置字段的两处不同**（安全语义，MUST 遵守）：
 * 1. **回显只给掩码**（`maskHeaders`）：详情/响应里出现的值形如 `6UuE…F3Z`，
 *    列表只给 `has_headers` 布尔量——令牌明文不进任何响应；
 * 2. **掩码不可提交**：把回显的掩码原样写回等于把令牌换成 `6UuE…F3Z`
 *    （静默 401，且从现象上几乎无法自查），故保存期直接拒绝并给出可读原因。
 *
 * 保存语义（与 `allowed_tools` 的"不携带即沿用"同一精神）：
 * **缺省 = 沿用存量**（保存调用配置 MUST NOT 顺手清空令牌）；**提供 = 全量替换**
 * （`{}` 即清空全部请求头）。仅对 `http` 传输有意义（`stdio` 由启动参数/环境变量承载）。
 */
export const MCP_HEADERS_HINT =
  '请求头为「头名 → 值」的对象，例如 {"X-MCP-Token":"…"}；值为单行字符串';

/** 掩码里的省略号（长值中间省略；保存期据此识别"把掩码当值提交"） */
export const HEADER_MASK_ELLIPSIS = '…';
/** 掩码里的占位符（短值整串掩掉） */
const HEADER_MASK_PLACEHOLDER = '•';

/** HTTP 头名判据（RFC 7230 token；与运行环境加载期同一判据） */
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** 单个头值的掩码：只露前 4 / 后 2（≤8 字符整串掩掉）——响应里 MUST NOT 出现令牌明文 */
export function maskHeaderValue(value: string): string {
  if (value.length <= 8) return HEADER_MASK_PLACEHOLDER.repeat(Math.max(value.length, 4));
  return `${value.slice(0, 4)}${HEADER_MASK_ELLIPSIS}${value.slice(-2)}`;
}

/** 掩码整组请求头（详情/新建/保存响应用；**MUST NOT** 拿它去连接任何服务） */
export function maskHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, maskHeaderValue(value)]));
}

/** 头名判据（保存期与读取期共用；提示语在调用处补） */
function isValidHeaderName(name: string): boolean {
  return HEADER_NAME_RE.test(name);
}

/**
 * 值里是否含换行或控制字符。
 *
 * 换行会被 HTTP 客户端拆成**额外的头**（header injection），控制字符同理——
 * 都不该出现在请求头值里。用逐字符判断而非正则：控制字符类正则会触发
 * `no-control-regex`，且这里的意图（"单行且可打印"）用代码表达更直白。
 * 与运行环境 `agent-instance.ts` 的 `hasControlChars` **同一判据**。
 */
function hasControlChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** 单个头值的可读问题；合法返回 `null`（保存期报错、读取期丢弃共用同一判据） */
function headerValueProblem(name: string, raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return `headers.${name} 的值须为字符串（令牌等），当前：${JSON.stringify(raw)}`;
  }
  const value = raw.trim();
  if (value === '') {
    return `headers.${name} 的值不能为空；如需删除该头请去掉该键（整体 {} 表示清空全部）`;
  }
  if (value.includes(HEADER_MASK_ELLIPSIS) || value.includes(HEADER_MASK_PLACEHOLDER)) {
    return `headers.${name} 的值看起来是界面上显示的掩码（${value}）：请填真实值，掩码不可作为请求头发送`;
  }
  // 换行会被 HTTP 客户端拆成额外的头（header injection），控制字符同理
  if (hasControlChars(value)) {
    return `headers.${name} 的值须为单行字符串（不得含换行或控制字符）`;
  }
  return null;
}

/**
 * 保存期归一：`undefined`/`null` → **沿用 `fallback`**（缺省不改，防"保存调用配置顺手清空令牌"）；
 * 其余必须为对象且逐项合法（头名合法、大小写不敏感下不重复、值为单行非空字符串且非掩码）。
 *
 * 值只 trim 两端空白（HTTP 本身会剥 OWS；粘贴带尾空格是最常见的"配了却 401"来源）。
 */
export function normalizeHeaders(
  raw: unknown,
  fallback: Record<string, string>,
): Record<string, string> {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `headers 须为对象（${MCP_HEADERS_HINT}），可为 {}`,
    );
  }
  const out: Record<string, string> = {};
  /** 头名大小写不敏感：`X-MCP-Token` 与 `x-mcp-token` 同时出现会让"发哪个"变成实现细节 */
  const seen = new Map<string, string>();
  for (const [rawName, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    const name = rawName.trim();
    if (!isValidHeaderName(name)) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `headers 的名称非法：${JSON.stringify(rawName)}（须为合法 HTTP 头名，如 X-MCP-Token）`,
      );
    }
    const prev = seen.get(name.toLowerCase());
    if (prev !== undefined) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `headers 存在重复的头名：${prev} 与 ${name}（HTTP 头名大小写不敏感）`,
      );
    }
    seen.set(name.toLowerCase(), name);
    const problem = headerValueProblem(name, rawValue);
    if (problem !== null) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, problem);
    out[name] = (rawValue as string).trim();
  }
  return out;
}

/**
 * 读取路径的容错收敛：非对象 → `{}`；**逐项丢弃非法项**（不阻断读取存量文档）。
 *
 * 与 `readRulesFields` 同一取向：运行环境在加载期把形状非法判为配置错误，
 * 若把存量文档里的脏值原样物化进 `MCP.json`，一次部署会让整个数字人加载失败——
 * 在这里收敛掉，破坏面止于"该请求头不生效"。
 */
function readHeaders(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    const name = rawName.trim();
    if (!isValidHeaderName(name)) continue;
    if (headerValueProblem(name, rawValue) !== null) continue;
    out[name] = (rawValue as string).trim();
  }
  return out;
}

/**
 * `url` 读取 + 存量迁移（2026-09-27）。
 *
 * 旧文档（2026-09-27 之前）把地址存在 `endpoints: { [运行形态]: 地址 }` 里。
 * 平台已不再区分运行形态，故取其**唯一可用**的一份：优先「宿主机本地」
 * （本地实际在用的形态），否则取第一个非空值。存量配置因此不丢。
 */
function readUrl(raw: McpServiceConfig): string | null {
  const direct = (raw as { url?: unknown }).url;
  if (typeof direct === 'string' && direct.trim() !== '') return direct.trim();

  const legacy = (raw as { endpoints?: unknown }).endpoints;
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
    const map = legacy as Record<string, unknown>;
    for (const key of ['host_local', 'container_network']) {
      const value = map[key];
      if (typeof value === 'string' && value.trim() !== '') return value.trim();
    }
    for (const value of Object.values(map)) {
      if (typeof value === 'string' && value.trim() !== '') return value.trim();
    }
  }
  return null;
}

/**
 * 异步工具声明（保存期，R11）：`string[]`，元素为**该服务自己的原始工具名**。
 *
 * 判据与运行环境**加载期同口径**（数组 / 元素非空字符串 / 同服务内去重），
 * 否则会出现"平台保存得进去、运行环境加载不了"这类两边不一致。
 *
 * 与 `rules_fields` / `file_args` 同取向：**只校验语法，不校验工具清单**——
 * 工具清单是**探测结果**，服务不可达时拿不到；拿不到就拒保存，会把"服务抖动"
 * 变成"配置改不了"。
 */
export function normalizeAsyncTools(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'async_tools 须为工具名数组，可为 []');
  }
  const out: string[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `async_tools 的元素须为非空字符串（该服务的原始工具名），当前：${JSON.stringify(item)}`,
      );
    }
    const name = item.trim();
    if (out.includes(name)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `async_tools 存在重复的工具名：${name}`);
    }
    out.push(name);
  }
  return out;
}

/**
 * 读取路径的容错收敛：残缺值一律**丢弃并去重**（不阻断读取存量文档）。
 *
 * 与 `readRulesFields` 同一取向：运行环境在**加载期**把形状非法判为配置错误，
 * 若把存量文档里的脏值原样物化进 `MCP.json`，一次部署就会让整个数字人加载失败——
 * 在这里收敛掉，破坏面止于"该声明不生效"。
 */
function readAsyncTools(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item !== 'string' || item.trim() === '') continue;
    const name = item.trim();
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * 算法规则参数设置（保存期）：`{ 工具名: 字段名或对象路径 }`。
 * 缺省 → `{}`（不启用）；非对象/值不是合法字段路径 → 报错——typo 挡在保存期，
 * 避免"以为开了选择器实际没开"。
 *
 * 与 `file_args` 同口径：**只校验语法，不校验工具 schema**（工具清单是探测结果，
 * 服务不可达时拿不到；拿不到就拒保存会把"服务抖动"变成"配置改不了"）。
 */
export function normalizeRulesFields(raw: unknown): Record<string, string> {
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

/**
 * 调用确认策略（HITL）：缺省/非法即 `never` 还是报错？
 * ——报错。这是安全相关开关，把 typo 挡在保存期（"以为开了确认实际没开"比报错更糟）。
 */
export function normalizeConfirmation(raw: unknown): McpConfirmation {
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

export function normalizeFileArgs(raw: unknown): Record<string, Record<string, string>> {
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

/** 保存期校验里 `url` 的入口（`normalize()` 用；导出以便与读取期共用同一判据） */
export { normalizeUrl };
