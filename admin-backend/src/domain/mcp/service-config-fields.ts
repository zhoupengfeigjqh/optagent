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

export const MCP_SERVICE_NAME_HINT =
  '由字母、数字、单个下划线或连字符组成（不得出现连续两个下划线），1~64 字符（会成为运行环境的工具前缀）';

export function isValidMcpServiceName(name: string): boolean {
  return /^(?!.*__)[A-Za-z0-9_-]{1,64}$/.test(name);
}

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

export function sanitize(raw: McpServiceConfig): McpServiceConfig {
  return {
    name: raw.name,
    description: typeof raw.description === 'string' ? raw.description : '',
    transport: normalizeTransport(raw.transport) ?? raw.transport,
    url: readUrl(raw),
    command: raw.command ?? null,
    args: Array.isArray(raw.args) ? raw.args : null,
    file_args: raw.file_args ?? {},
    confirmation: readConfirmation(raw.confirmation),
    // 工具名不可得）：一律收敛为 {}（不启用规则选择器）
    rules_fields: readRulesFields(raw.rules_fields ?? (raw as { rules_field?: unknown }).rules_field),
    allowed_tools: readAllowedTools(raw.allowed_tools),
    // 存量文档里的脏值逐项丢弃，不让一条坏数据把整个服务打成不可读
    headers: readHeaders(raw.headers),
    tool_labels: readToolLabels(raw.tool_labels),
    updated_at: raw.updated_at,
  };
}

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

function readAllowedTools(raw: unknown): string[] {
  return Array.isArray(raw) ? normalizeAllowedTools(raw, false) : [];
}

export const MCP_HEADERS_HINT = '请求头为「头名 → 值」的对象，例如 {"X-MCP-Token":"…"}；值为单行字符串';

export const HEADER_MASK_ELLIPSIS = '…';
const HEADER_MASK_PLACEHOLDER = '•';

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

function isValidHeaderName(name: string): boolean {
  return HEADER_NAME_RE.test(name);
}

function hasControlChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

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
export function normalizeHeaders(raw: unknown, fallback: Record<string, string>): Record<string, string> {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `headers 须为对象（${MCP_HEADERS_HINT}），可为 {}`);
  }
  const out: Record<string, string> = {};
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

export const MCP_TOOL_LABEL_HINT =
  '工具显示名为「工具名 → 人读名称」的对象，如 {"bom_validate":"BOM 校验"}；值 1~40 字';

/** 显示名长度上限：与运行环境意图聚焦的命题截断宽度（`MAX_DISPLAY_CHARS`）同口径 */
export const MCP_TOOL_LABEL_MAX_CHARS = 40;

function toolLabelProblem(tool: string, raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return `tool_labels.${tool} 须为字符串（人读名称），当前：${JSON.stringify(raw)}`;
  }
  const value = raw.trim();
  if (value === '') {
    return `tool_labels.${tool} 不能为空；如需回退英文工具名请去掉该键`;
  }
  if ([...value].length > MCP_TOOL_LABEL_MAX_CHARS) {
    return `tool_labels.${tool} 超过 ${MCP_TOOL_LABEL_MAX_CHARS} 字（该名称会进意图聚焦命题，过长会挤占判定上下文）`;
  }
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return `tool_labels.${tool} 须为单行字符串（不得含换行或控制字符）`;
    }
  }
  return null;
}

/**
 * 保存期归一：`undefined`/`null` → **沿用 `fallback`**（保存调用配置 MUST NOT
 * 顺手清空已配好的显示名）；其余必须为对象且逐项合法（键非空、值为 1~40 字单行）。
 */
export function normalizeToolLabels(raw: unknown, fallback: Record<string, string>): Record<string, string> {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `tool_labels 须为对象（${MCP_TOOL_LABEL_HINT}），可为 {}`,
    );
  }
  const out: Record<string, string> = {};
  for (const [rawTool, rawLabel] of Object.entries(raw as Record<string, unknown>)) {
    const tool = rawTool.trim();
    if (tool === '') {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'tool_labels 的工具名不能为空');
    }
    const problem = toolLabelProblem(tool, rawLabel);
    if (problem !== null) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, problem);
    out[tool] = (rawLabel as string).trim();
  }
  return out;
}

/**
 * 读取路径的容错收敛：非对象 → `{}`；**逐项丢弃非法项**（不阻断读取存量文档）。
 * 与 `readHeaders`/`readRulesFields` 同一取向：坏值只在读取期收敛，不让一条脏数据
 * 把整个服务打成不可读。
 */
function readToolLabels(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [rawTool, rawLabel] of Object.entries(raw as Record<string, unknown>)) {
    const tool = rawTool.trim();
    if (tool === '' || toolLabelProblem(tool, rawLabel) !== null) continue;
    out[tool] = (rawLabel as string).trim();
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

function readRulesFields(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [tool, field] of Object.entries(raw as Record<string, unknown>)) {
    if (parseRulesFieldPath(field) !== null) out[tool] = (field as string).trim();
  }
  return out;
}

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

export { normalizeUrl };
