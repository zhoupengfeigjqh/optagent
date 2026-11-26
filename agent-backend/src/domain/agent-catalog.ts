import fs from 'node:fs';
import path from 'node:path';
import type { SkillMeta } from '../types.js';
import { AgentConfigError, loadAgentConfig } from './agent-instance.js';
import { userAgentsDir } from './dirs.js';
import { buildStarterGuidance, parseSoulMeta, toolExposedName, type SoulStarter } from './soul.js';

export interface CatalogLogger {
  warn(msg: string): void;
}

export interface AgentListItem {
  agent_name: string;
  description: string;
}

export interface AgentStarterTool {
  kind: 'builtin' | 'mcp';
  name: string;
  service?: string;
  exposed_name: string;
}

export interface AgentStarterView {
  prompt: string;
  tools: AgentStarterTool[];
  guidance: string;
}

export interface AgentDetail {
  agent_name: string;
  intro: string;
  welcome: string;
  starters: AgentStarterView[];
  /** SOUL.md 全文（兼容保留；展示语义已由 `intro` 承担） */
  soul: string;
  skills: SkillMeta[];
  enabled_tools: string[];
  mcp_servers: Array<{ name: string; transport: 'stdio' | 'http' }>;
}

export function listAgents(
  optAgentRoot: string,
  userId: string,
  logger?: CatalogLogger,
): AgentListItem[] {
  const dir = userAgentsDir(optAgentRoot, userId);
  if (!fs.existsSync(dir)) return [];
  const items: AgentListItem[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const agentDir = path.join(dir, entry.name);
    try {
      loadAgentConfig(agentDir);
      items.push({ agent_name: entry.name, description: agentDescription(agentDir) });
    } catch (err) {
      if (err instanceof AgentConfigError) {
        logger?.warn(`数字人 ${entry.name} 配置损坏，已从列表排除：${err.message}`);
        continue;
      }
      throw err;
    }
  }
  return items.sort((a, b) => a.agent_name.localeCompare(b.agent_name));
}

export function getAgentDetail(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  logger?: CatalogLogger,
): AgentDetail | undefined {
  const agentDir = path.join(userAgentsDir(optAgentRoot, userId), agentName);
  if (!fs.existsSync(agentDir)) return undefined;
  try {
    const bundle = loadAgentConfig(agentDir);
    const soulRaw = fs.readFileSync(path.join(agentDir, 'SOUL.md'), 'utf8');
    const meta = parseSoulMeta(soulRaw);
    return {
      agent_name: agentName,
      intro: meta.intro,
      welcome: meta.welcome,
      starters: meta.starters.map(toStarterView),
      soul: soulRaw.trim(),
      skills: bundle.skills,
      enabled_tools: bundle.enabledTools,
      mcp_servers: bundle.mcpServers.map((s) => ({ name: s.name, transport: s.transport })),
    };
  } catch (err) {
    if (err instanceof AgentConfigError) {
      logger?.warn(`数字人 ${agentName} 配置损坏：${err.message}`);
      return undefined;
    }
    throw err;
  }
}

function toStarterView(starter: SoulStarter): AgentStarterView {
  return {
    prompt: starter.prompt,
    tools: starter.tools.map((tool) => ({
      kind: tool.kind,
      name: tool.name,
      ...(tool.kind === 'mcp' ? { service: tool.service } : {}),
      exposed_name: toolExposedName(tool),
    })),
    guidance: buildStarterGuidance(starter.tools),
  };
}

function agentDescription(agentDir: string): string {
  const raw = fs.readFileSync(path.join(agentDir, 'SOUL.md'), 'utf8');
  const intro = parseSoulMeta(raw).intro;
  if (intro !== '') return intro;
  return (
    raw
      .split(/\r?\n/)
      .find((l) => l.trim())
      ?.trim() ?? ''
  );
}
