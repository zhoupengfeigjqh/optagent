/**
 * 数字人配置包加载（T020 / FR-011）。
 *
 * 读取 agents/{name}/ 下：
 * - SOUL.md（人格全文，必填，追加到 System Prompt）
 * - skills/{name}/SKILL.md（仅 YAML frontmatter 的 name/description，追加到 System Prompt）
 * - TOOL.json（{"enabled": [...]}，从内置工具白名单过滤）
 * - MCP.json（{"servers": [...]}，stdio/http；写能力必须声明 permission_boundary，FR-024）
 *
 * SOUL/TOOL/MCP 缺失或损坏 → AgentConfigError（上层跳过该数字人并告警）；
 * 单个 skill 损坏 → 跳过该技能并告警，不影响整体。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { builtinToolNames } from './builtin-tool-catalog.js';
import {
  FILE_ARG_PATH_HINT,
  isCompatibleFromPath,
  isValidFileArgPath,
  parseFileArgMode,
  type FileArgMode,
} from './file-arg-path.js';
import { MCP_TRANSPORT_HINT, normalizeTransport } from './mcp-transport.js';
import type { AgentConfigBundle, McpServerConfig, SkillMeta } from '../types.js';

/**
 * 内置工具白名单（FR-023）。
 *
 * **R1 改造后从 `builtin-tool-catalog.ts` 派生**——此前这里与
 * `infra/builtin-tools.ts` 各维护一份、无机制保证一致（改一处漏一处）。
 */
export const BUILTIN_TOOL_NAMES: readonly string[] = builtinToolNames();

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

export function loadAgentConfig(agentDir: string, opts?: { logger?: LoadLogger }): AgentConfigBundle {
  const logger = opts?.logger;
  const agentName = path.basename(agentDir);

  const soul = readRequired(agentDir, 'SOUL.md');
  if (!soul.trim()) throw new AgentConfigError(`数字人 ${agentName} 的 SOUL.md 为空`);

  const enabledTools = loadEnabledTools(agentDir, agentName, logger);
  const mcpServers = loadMcpServers(agentDir, agentName);
  const skills = loadSkills(agentDir, agentName, logger);

  const skillSections = skills.map((s) => `## 技能：${s.name}\n${s.description}`).join('\n\n');
  const systemPrompt = skillSections ? `${soul.trim()}\n\n${skillSections}` : soul.trim();

  return { agentName, systemPrompt, enabledTools, mcpServers, skills };
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
  const known = new Set<string>([...BUILTIN_TOOL_NAMES]);
  const enabled: string[] = [];
  for (const tool of data.enabled as string[]) {
    if (known.has(tool)) enabled.push(tool);
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
    const bad = (why: string) => new AgentConfigError(`数字人 ${agentName} MCP.json servers[${i}] ${why}`);
    if (typeof s.name !== 'string' || !s.name) throw bad('缺少 name');
    // 传输方式**在入口归一**：`streamable-http` 是 `http` 的生态叫法，二者同义，
    // 不接受会让手工按生态写法改过的 MCP.json 把整个数字人打成"配置损坏"（实测报错）
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
    return cfg;
  });
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

/**
 * 解析 rules_fields：`{ 工具名: 字段名 }`，非法结构（非对象、值非非空字符串）
 * 即配置错误——typo 挡在加载期，避免"以为开了选择器实际没开"。
 */
function parseRulesFields(raw: unknown, bad: (why: string) => Error): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw bad('rules_fields 须为对象 { 工具名: 字段名 }');
  }
  const out: Record<string, string> = {};
  for (const [tool, field] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof field !== 'string' || field.trim() === '') {
      throw bad(`rules_fields.${tool} 须为非空字符串（字段名）`);
    }
    out[tool] = field.trim();
  }
  return out;
}

/**
 * 解析 file_args：`{ 工具名: { 取值路径: "url" | "url:from=<来源路径>" } }`，
 * 非法结构即配置错误。
 *
 * 取值路径（2026-09-16）：键可以是顶层参数名（`image`，与旧写法等价），
 * 也可以是穿过数组的路径（`items[].excelFileUrl`、`files[]`）——
 * 语法在 `file-arg-path.ts` 里定义，**与平台侧同一判据**，避免
 * "平台保存得进去、运行环境加载不了"（或反过来）这类两边不一致。
 *
 * 派生模式（2026-09-18）：`"url:from=<来源路径>"` 表示目标字段的值由引擎
 * 从来源路径推导注入（覆盖模型填写、对 LLM 隐藏），用来根治模型对
 * http 地址字段的幻觉。来源路径须合法且与目标路径形状相容
 * （除最后一段外逐段一致，保证数组元素一一对应）。
 */
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

/** 解析 SKILL.md 的 YAML frontmatter（---\n...\n---），取 name/description */
function parseFrontmatter(raw: string): SkillMeta {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!match) throw new Error('SKILL.md 缺少 YAML frontmatter');
  const data = parseYaml(match[1]!) as Record<string, unknown>;
  if (typeof data?.name !== 'string' || typeof data?.description !== 'string') {
    throw new Error('SKILL.md frontmatter 须含 name 与 description');
  }
  return { name: data.name, description: data.description };
}
