import type { ReferenceIndex } from './reference-index.js';

/** 推导所需的最小数字人快照（避免依赖完整设计态文档） */
export interface AgentRefSource {
  name: string;
  enabled_tools: string[];
  mcp_services: string[];
  skills: string[];
  ontologies: string[];
}

export type AnomalyCategory = 'builtin_tool' | 'mcp_service' | 'skill' | 'ontology';

export interface Anomaly {
  category: AnomalyCategory;
  target_name: string;
  detail: string;
}

export interface ReferencePair {
  user_id: string;
  agent_name: string;
}

export interface UserAgentLink {
  user_id: string;
  agents: string[];
}

const CATEGORY_LABEL: Record<AnomalyCategory, string> = {
  builtin_tool: '内置工具',
  mcp_service: 'MCP 服务',
  skill: 'SKILL',
  ontology: '本体',
};

export function detectAnomalies(design: AgentRefSource, index: ReferenceIndex): Anomaly[] {
  const out: Anomaly[] = [];
  for (const tool of design.enabled_tools) {
    if (!index.builtinTools.has(tool)) {
      out.push({
        category: 'builtin_tool',
        target_name: tool,
        detail: `引用的内置工具 ${tool} 不在工具目录中（可能已下线）`,
      });
    }
  }
  for (const service of design.mcp_services) {
    if (!index.mcpServices.has(service)) {
      out.push({
        category: 'mcp_service',
        target_name: service,
        detail: `引用的 MCP 服务 ${service} 不在平台的 MCP 服务列表中（可能已删除或改名）`,
      });
    }
  }
  for (const skill of design.skills) {
    if (!index.skills.has(skill)) {
      out.push({
        category: 'skill',
        target_name: skill,
        detail: `引用的 SKILL ${skill} 不在共享技能库中（可能已被删除）`,
      });
    }
  }
  for (const ontology of design.ontologies) {
    if (!index.ontologies.has(ontology)) {
      out.push({
        category: 'ontology',
        target_name: ontology,
        detail: `引用的本体 ${ontology} 不在本体库中（可能已被删除或改名）`,
      });
    }
  }
  return out;
}

export function anomalyReason(anomalies: Anomaly[]): string | null {
  if (anomalies.length === 0) return null;
  return anomalies.map((a) => `${CATEGORY_LABEL[a.category]}「${a.target_name}」已失效`).join('；');
}

export function agentsReferencingTool(agents: AgentRefSource[], toolName: string): string[] {
  return agents.filter((a) => a.enabled_tools.includes(toolName)).map((a) => a.name);
}

export function agentsReferencingService(agents: AgentRefSource[], serviceName: string): string[] {
  return agents.filter((a) => a.mcp_services.includes(serviceName)).map((a) => a.name);
}

export function agentsReferencingSkill(agents: AgentRefSource[], skillName: string): string[] {
  return agents.filter((a) => a.skills.includes(skillName)).map((a) => a.name);
}

export function expandToPairs(agentNames: string[], users: UserAgentLink[]): ReferencePair[] {
  const wanted = new Set(agentNames);
  const pairs: ReferencePair[] = [];
  for (const user of users) {
    for (const agent of user.agents) {
      if (wanted.has(agent)) pairs.push({ user_id: user.user_id, agent_name: agent });
    }
  }
  return pairs;
}
