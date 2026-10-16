/**
 * 数字人目录（US4 / T043）：只读查询 agents/ 下各数字人配置。
 *
 * - list：扫描 users/{uid}/agents/，逐个复用 loadAgentConfig 校验；
 *   配置损坏者跳过并告警（不出现在列表）
 * - detail：返回 SOUL 结构化数据（角色简介 / 首屏欢迎语 / 问题实例）、SOUL 全文（兼容保留）、
 *   skills frontmatter、enabled_tools、mcp_servers（仅 name/transport，不含 url/command）
 * 每次请求现扫现解析（配置量小），配置修复后无需重启即可重现。
 *
 * **SOUL 结构化（004）**：
 * - `intro` / `welcome` / `starters` 取自 SOUL.md 的 YAML frontmatter（只给前台展示与引导，
 *   与进模型的正文严格分离，见 `soul.ts`）；
 * - `starters[].guidance` 由**运行环境算好**（内含 `{server}__{tool}` 暴露名规则），
 *   前端直接回传即可，不需要（也不应该）知道前缀规则；
 * - 旧版 SOUL.md（无 frontmatter）三项为空值/空数组，前端自然降级为既有空状态。
 */
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

/** 问题实例关联的工具（下发给前台的形态） */
export interface AgentStarterTool {
  kind: 'builtin' | 'mcp';
  name: string;
  /** 仅 `kind: 'mcp'` 存在：所属 MCP 服务名 */
  service?: string;
  /** 模型实际看到的工具名（MCP 带 `{server}__` 前缀） */
  exposed_name: string;
}

/** 问题实例（下发给前台的形态） */
export interface AgentStarterView {
  prompt: string;
  tools: AgentStarterTool[];
  /** 隐藏工具引导文本（无关联工具时为空串），经请求级指引注入本轮系统提示词 */
  guidance: string;
}

export interface AgentDetail {
  agent_name: string;
  /** 角色简介（数字人切换面板展示用） */
  intro: string;
  /** 新建对话页首屏欢迎语 */
  welcome: string;
  starters: AgentStarterView[];
  /** SOUL.md 全文（兼容保留；展示语义已由 `intro` 承担） */
  soul: string;
  skills: SkillMeta[];
  enabled_tools: string[];
  mcp_servers: Array<{ name: string; transport: 'stdio' | 'http' }>;
}

/** 扫描并列出配置完好的数字人（损坏者跳过 + 告警） */
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

/** 把设计态的 starter 展开为下发形态（补 `exposed_name` 与隐藏引导） */
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

/**
 * 卡片描述：优先取 SOUL frontmatter 的 `intro`（结构化后的角色简介）；
 * 旧版 SOUL.md 无 frontmatter 时回退**首个非空行**（改造前口径）。
 */
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
