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
import type { AgentConfigBundle, McpServerConfig, SkillMeta } from '../types.js';

/** 6 个内置工具白名单（FR-023） */
export const BUILTIN_TOOL_NAMES = ['read_file', 'write_file', 'list_dir', 'grep_files', 'calculator'] as const;

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
  const known = new Set<string>(BUILTIN_TOOL_NAMES);
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
    if (s.transport !== 'stdio' && s.transport !== 'http') throw bad('transport 须为 stdio|http');
    if (s.transport === 'stdio' && typeof s.command !== 'string') throw bad('stdio 缺少 command');
    if (s.transport === 'http' && typeof s.url !== 'string') throw bad('http 缺少 url');
    // FR-024：写能力必须声明权限边界
    if (s.write === true && typeof s.permission_boundary !== 'string') {
      throw bad('声明写能力（write: true）必须提供 permission_boundary');
    }
    const cfg: McpServerConfig = { name: s.name, transport: s.transport };
    if (typeof s.command === 'string') cfg.command = s.command;
    if (Array.isArray(s.args)) cfg.args = s.args.map(String);
    if (typeof s.url === 'string') cfg.url = s.url;
    if (s.write === true) cfg.write = true;
    if (typeof s.permission_boundary === 'string') cfg.permissionBoundary = s.permission_boundary;
    return cfg;
  });
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
