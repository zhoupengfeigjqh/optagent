/**
 * 数字人目录（US4 / T043）：只读查询 agents/ 下各数字人配置。
 *
 * - list：扫描 users/{uid}/agents/，逐个复用 loadAgentConfig 校验；
 *   配置损坏者跳过并告警（不出现在列表）
 * - detail：返回 soul 全文、skills frontmatter、enabled_tools、
 *   mcp_servers（仅 name/transport，不含 url/command 等连接细节）
 * 每次请求现扫现解析（配置量小），配置修复后无需重启即可重现。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { SkillMeta } from '../types.js';
import { AgentConfigError, loadAgentConfig } from './agent-instance.js';
import { userAgentsDir } from './dirs.js';

export interface CatalogLogger {
  warn(msg: string): void;
}

export interface AgentListItem {
  agent_name: string;
  description: string;
}

export interface AgentDetail {
  agent_name: string;
  soul: string;
  skills: SkillMeta[];
  enabled_tools: string[];
  mcp_servers: Array<{ name: string; transport: 'stdio' | 'http' }>;
}

/** 扫描并列出配置完好的数字人（损坏者跳过 + 告警） */
export function listAgents(optAgentRoot: string, userId: string, logger?: CatalogLogger): AgentListItem[] {
  const dir = userAgentsDir(optAgentRoot, userId);
  if (!fs.existsSync(dir)) return [];
  const items: AgentListItem[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const agentDir = path.join(dir, entry.name);
    try {
      loadAgentConfig(agentDir);
      items.push({ agent_name: entry.name, description: firstLine(agentDir) });
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

/** 查询单个数字人详情；不存在或配置损坏返回 undefined（并告警） */
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
    const soul = fs.readFileSync(path.join(agentDir, 'SOUL.md'), 'utf8').trim();
    return {
      agent_name: agentName,
      soul,
      skills: bundle.skills,
      enabled_tools: bundle.enabledTools,
      // 契约：仅 name/transport，不外泄 url/command 等连接细节
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

/** description 取 SOUL.md 首个非空行 */
function firstLine(agentDir: string): string {
  const raw = fs.readFileSync(path.join(agentDir, 'SOUL.md'), 'utf8');
  return raw.split(/\r?\n/).find((l) => l.trim())?.trim() ?? '';
}
