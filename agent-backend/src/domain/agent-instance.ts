import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { builtinToolNames } from './builtin-tool-catalog.js';
import { composeSystemPrompt } from './skill-prompt.js';
import { stripFrontmatter } from './soul.js';
import {
  FILE_ARG_PATH_HINT,
  isCompatibleFromPath,
  isValidFileArgPath,
  parseFileArgMode,
  type FileArgMode,
} from './file-arg-path.js';
import { MCP_TRANSPORT_HINT, normalizeTransport } from './mcp-transport.js';
import { RULES_FIELD_PATH_HINT, parseRulesFieldPath } from './rules-field-path.js';
import type { AgentConfigBundle, McpServerConfig, SkillMeta } from '../types.js';

const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const BUILTIN_TOOL_NAMES: readonly string[] = builtinToolNames();

/** TOOL.json 白名单判定用的已知集合（模块级一次构造，不随每次数字人配置加载重复建 Set） */
const KNOWN_BUILTIN_TOOLS: ReadonlySet<string> = new Set(BUILTIN_TOOL_NAMES);

export class AgentConfigError extends Error {
  readonly code = 'AGENT_CONFIG_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'AgentConfigError';
  }
}

export interface LoadLogger {
  warn(msg: string): void;
}

export function loadAgentConfig(
  agentDir: string,
  opts?: { logger?: LoadLogger },
): AgentConfigBundle {
  const logger = opts?.logger;
  const agentName = path.basename(agentDir);

  const soul = readRequired(agentDir, 'SOUL.md');
  if (!soul.trim()) throw new AgentConfigError(`数字人 ${agentName} 的 SOUL.md 为空`);

  // ⇒ 存量数字人的 System Prompt 与改造前逐字一致（兼容不变式）。
  const soulBody = stripFrontmatter(soul).trim();
  if (!soulBody) {
    throw new AgentConfigError(`数字人 ${agentName} 的 SOUL.md 正文为空（仅有 frontmatter）`);
  }

  const enabledTools = loadEnabledTools(agentDir, agentName, logger);
  const mcpServers = loadMcpServers(agentDir, agentName);
  const skills = loadSkills(agentDir, agentName, logger);

  // 请求级"只插入选中技能"复用同一函数，避免两条路径各写一份拼法而漂移。
  const systemPrompt = composeSystemPrompt({ soulBody, skills });

  return { agentName, soulBody, systemPrompt, enabledTools, mcpServers, skills };
}

function readRequired(dir: string, name: string): string {
  const file = path.join(dir, name);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    throw new AgentConfigError(`数字人配置缺失：${path.join(path.basename(dir), name)}`);
  }
}

function readJson(dir: string, name: string): unknown {
  const raw = readRequired(dir, name);
  try {
    return JSON.parse(raw);
  } catch {
    throw new AgentConfigError(`数字人配置损坏：${name} 不是合法 JSON`);
  }
}

function loadEnabledTools(dir: string, agentName: string, logger?: LoadLogger): string[] {
  const data = readJson(dir, 'TOOL.json') as { enabled?: unknown };
  if (!Array.isArray(data.enabled) || data.enabled.some((t) => typeof t !== 'string')) {
    throw new AgentConfigError(`数字人 ${agentName} 的 TOOL.json 须为 {"enabled": string[]}`);
  }
  const enabled: string[] = [];
  for (const tool of data.enabled as string[]) {
    if (KNOWN_BUILTIN_TOOLS.has(tool)) enabled.push(tool);
    else logger?.warn(`数字人 ${agentName} 声明了未知内置工具 ${tool}，已忽略`);
  }
  return enabled;
}

function loadMcpServers(dir: string, agentName: string): McpServerConfig[] {
  const data = readJson(dir, 'MCP.json') as { servers?: unknown };
  if (!Array.isArray(data.servers)) {
    throw new AgentConfigError(`数字人 ${agentName} 的 MCP.json 须为 {"servers": [...]}`);
  }
  return data.servers.map((raw, i) => {
    const s = raw as Record<string, unknown>;
    const bad = (why: string) =>
      new AgentConfigError(`数字人 ${agentName} MCP.json servers[${i}] ${why}`);
    if (typeof s.name !== 'string' || !s.name) throw bad('缺少 name');
    const transport = normalizeTransport(s.transport);
    if (transport === null) {
      throw bad(`transport 须为 ${MCP_TRANSPORT_HINT}（当前：${JSON.stringify(s.transport)}）`);
    }
    if (transport === 'stdio' && typeof s.command !== 'string') throw bad('stdio 缺少 command');
    if (transport === 'http' && typeof s.url !== 'string') throw bad('http 缺少 url');
    // FR-024：写能力必须声明权限边界
    if (s.write === true && typeof s.permission_boundary !== 'string') {
      throw bad('声明写能力（write: true）必须提供 permission_boundary');
    }
    const cfg: McpServerConfig = { name: s.name, transport };
    if (typeof s.command === 'string') cfg.command = s.command;
    if (Array.isArray(s.args)) cfg.args = s.args.map(String);
    if (typeof s.url === 'string') cfg.url = s.url;
    if (s.write === true) cfg.write = true;
    if (typeof s.permission_boundary === 'string') cfg.permissionBoundary = s.permission_boundary;
    if (s.file_args !== undefined) cfg.fileArgs = parseFileArgs(s.file_args, bad);
    if (s.confirmation !== undefined) cfg.confirmation = parseConfirmation(s.confirmation, bad);
    if (s.rules_fields !== undefined) cfg.rulesFields = parseRulesFields(s.rules_fields, bad);
    if (s.allowed_tools !== undefined) cfg.allowedTools = parseAllowedTools(s.allowed_tools, bad);
    if (s.headers !== undefined) cfg.headers = parseHeaders(s.headers, bad);
    if (s.tool_labels !== undefined) cfg.toolLabels = parseToolLabels(s.tool_labels, bad);
    return cfg;
  });
}

function parseHeaders(raw: unknown, bad: (why: string) => Error): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw bad(`headers 须为对象 { 头名: 值 }，当前：${JSON.stringify(raw)}`);
  }
  const out: Record<string, string> = {};
  const seen = new Map<string, string>();
  for (const [rawName, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    const name = rawName.trim();
    if (!HEADER_NAME_RE.test(name)) {
      throw bad(
        `headers 的名称非法：${JSON.stringify(rawName)}（须为合法 HTTP 头名，如 X-MCP-Token）`,
      );
    }
    const prev = seen.get(name.toLowerCase());
    if (prev !== undefined) {
      throw bad(`headers 存在重复的头名：${prev} 与 ${name}（HTTP 头名大小写不敏感）`);
    }
    seen.set(name.toLowerCase(), name);
    if (typeof rawValue !== 'string') {
      throw bad(`headers.${name} 的值须为字符串（令牌等），当前：${JSON.stringify(rawValue)}`);
    }
    const value = rawValue.trim();
    if (value === '') throw bad(`headers.${name} 的值不能为空`);
    if (hasControlChars(value)) {
      throw bad(`headers.${name} 的值须为单行字符串（不得含换行或控制字符）`);
    }
    out[name] = value;
  }
  return out;
}

function hasControlChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** 工具显示名长度上限：与平台保存期同一口径（`MCP_TOOL_LABEL_MAX_CHARS`） */
const TOOL_LABEL_MAX_CHARS = 40;

function parseToolLabels(raw: unknown, bad: (why: string) => Error): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw bad(`tool_labels 须为对象 { 工具名: 显示名 }，当前：${JSON.stringify(raw)}`);
  }
  const out: Record<string, string> = {};
  for (const [rawTool, rawLabel] of Object.entries(raw as Record<string, unknown>)) {
    const tool = rawTool.trim();
    if (tool === '') throw bad('tool_labels 的工具名不能为空');
    if (typeof rawLabel !== 'string') {
      throw bad(`tool_labels.${tool} 须为字符串，当前：${JSON.stringify(rawLabel)}`);
    }
    const label = rawLabel.trim();
    if (label === '') throw bad(`tool_labels.${tool} 不能为空（如需回退英文工具名请去掉该键）`);
    if ([...label].length > TOOL_LABEL_MAX_CHARS) {
      throw bad(`tool_labels.${tool} 超过 ${TOOL_LABEL_MAX_CHARS} 字`);
    }
    if (hasControlChars(label)) {
      throw bad(`tool_labels.${tool} 须为单行字符串（不得含换行或控制字符）`);
    }
    out[tool] = label;
  }
  return out;
}

function parseAllowedTools(raw: unknown, bad: (why: string) => Error): string[] {
  if (!Array.isArray(raw)) {
    throw bad(`allowed_tools 须为字符串数组（工具白名单），当前：${JSON.stringify(raw)}`);
  }
  const names: string[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw bad(`allowed_tools 的元素须为非空字符串，当前：${JSON.stringify(item)}`);
    }
    const name = item.trim();
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * 解析 confirmation（HITL 调用确认策略）：`never`/`always` 或 `{ tools: string[] }`。
 * 非法即配置错误——把 typo 挡在加载期，避免"以为开了确认实际没开"。
 */
function parseConfirmation(
  raw: unknown,
  bad: (why: string) => Error,
): 'never' | 'always' | { tools: string[] } {
  if (raw === 'never' || raw === 'always') return raw;
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const tools = (raw as Record<string, unknown>).tools;
    if (Array.isArray(tools) && tools.length > 0 && tools.every((t) => typeof t === 'string')) {
      return { tools: tools as string[] };
    }
  }
  throw bad('confirmation 须为 "never" | "always" | {"tools": string[]}');
}

function parseRulesFields(raw: unknown, bad: (why: string) => Error): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw bad('rules_fields 须为对象 { 工具名: 字段名 }');
  }
  const out: Record<string, string> = {};
  for (const [tool, field] of Object.entries(raw as Record<string, unknown>)) {
    if (parseRulesFieldPath(field) === null) {
      throw bad(
        `rules_fields.${tool} 须为${RULES_FIELD_PATH_HINT}，当前：${JSON.stringify(field)}`,
      );
    }
    out[tool] = (field as string).trim();
  }
  return out;
}

function parseFileArgs(
  raw: unknown,
  bad: (why: string) => Error,
): Record<string, Record<string, FileArgMode>> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw bad(`file_args 须为 {工具名: {${FILE_ARG_PATH_HINT}: "url"}}`);
  }
  const result: Record<string, Record<string, FileArgMode>> = {};
  for (const [tool, params] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof params !== 'object' || params === null || Array.isArray(params)) {
      throw bad(`file_args.${tool} 须为 {${FILE_ARG_PATH_HINT}: "url"}`);
    }
    const ps: Record<string, FileArgMode> = {};
    for (const [param, modeRaw] of Object.entries(params as Record<string, unknown>)) {
      const mode = parseFileArgMode(modeRaw);
      if (!mode) {
        throw bad(`file_args.${tool}.${param} 仅支持 "url" 或 "url:from=<取值路径>"`);
      }
      if (!isValidFileArgPath(param)) {
        throw bad(`file_args.${tool} 的「${param}」不是合法取值路径（${FILE_ARG_PATH_HINT}）`);
      }
      if (mode.from !== undefined) {
        if (!isValidFileArgPath(mode.from)) {
          throw bad(
            `file_args.${tool}.${param} 的来源「${mode.from}」不是合法取值路径（${FILE_ARG_PATH_HINT}）`,
          );
        }
        if (!isCompatibleFromPath(param, mode.from)) {
          throw bad(
            `file_args.${tool}.${param} 的派生来源「${mode.from}」与目标形状不相容：` +
              '两段数须相同，且除最后一段外逐段一致（如 items[].excelFileUrl ← items[].realRelativePath）',
          );
        }
      }
      ps[param] = modeRaw as FileArgMode;
    }
    result[tool] = ps;
  }
  return result;
}

function loadSkills(dir: string, agentName: string, logger?: LoadLogger): SkillMeta[] {
  const skillsDir = path.join(dir, 'skills');
  if (!fs.existsSync(skillsDir)) return [];
  const skills: SkillMeta[] = [];
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
    try {
      const raw = fs.readFileSync(skillFile, 'utf8');
      skills.push(parseFrontmatter(raw));
    } catch (err) {
      logger?.warn(
        `数字人 ${agentName} 技能 ${entry.name} 加载失败已跳过：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return skills;
}

function parseFrontmatter(raw: string): SkillMeta {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!match) throw new Error('SKILL.md 缺少 YAML frontmatter');
  const data = parseYaml(match[1]!) as Record<string, unknown>;
  if (typeof data?.name !== 'string' || typeof data?.description !== 'string') {
    throw new Error('SKILL.md frontmatter 须含 name 与 description');
  }
  return { name: data.name, description: data.description };
}
