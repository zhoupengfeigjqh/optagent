/**
 * 引用推导与异常判定（`FR-013`、`FR-019`、`FR-042`、`FR-051`、`FR-052`）。
 *
 * 规格关键实体「引用关系」明确：引用关系**不落库**、**不做常驻浏览视图**，
 * 一律**按需从数字人设计态推导**。本模块即该推导的**唯一实现**——
 * 破坏性操作的确认清单与数字人卡片「异常」标记复用同一份逻辑。
 *
 * **2026-11-23**：部署前校验与全局异常项汇总两处消费点随功能下架删除，
 * `collectAnomalies()` 一并移除；`detectAnomalies()` / `anomalyReason()` 保留——
 * 设计态读取（列表/详情/复制对话框）仍靠它标出失效引用。
 */
import type { ReferenceIndex } from './reference-index.js';

/** 推导所需的最小数字人快照（避免依赖完整设计态文档） */
export interface AgentRefSource {
  name: string;
  enabled_tools: string[];
  mcp_services: string[];
  skills: string[];
  /** 本体引用：`"{场景名}/{本体名}"`（2026-10-17） */
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

/** 用户与其关联数字人（用于把"数字人级异常"归到用户） */
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

/**
 * 检出该数字人的**全部失效引用**（`FR-013`、`FR-052`）。
 *
 * 一次返回全部（不是发现一个就停），便于界面与部署前校验一次性列清。
 */
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

/** 异常态的可读原因（无异常返回 `null`；异常态 MUST 可见且可定位到具体对象） */
export function anomalyReason(anomalies: Anomaly[]): string | null {
  if (anomalies.length === 0) return null;
  return anomalies.map((a) => `${CATEGORY_LABEL[a.category]}「${a.target_name}」已失效`).join('；');
}

/** 引用了某内置工具的数字人名 */
export function agentsReferencingTool(agents: AgentRefSource[], toolName: string): string[] {
  return agents.filter((a) => a.enabled_tools.includes(toolName)).map((a) => a.name);
}

/** 引用了某 MCP 服务的数字人名 */
export function agentsReferencingService(agents: AgentRefSource[], serviceName: string): string[] {
  return agents.filter((a) => a.mcp_services.includes(serviceName)).map((a) => a.name);
}

/** 引用了某 SKILL 的数字人名 */
export function agentsReferencingSkill(agents: AgentRefSource[], skillName: string): string[] {
  return agents.filter((a) => a.skills.includes(skillName)).map((a) => a.name);
}

/**
 * 把数字人名清单展开为「用户 × 数字人」对（`FR-042`、`FR-051`）。
 *
 * 破坏性操作的确认环节需要的是"**哪些用户的哪个数字人**会受影响"，
 * 只给数字人名不足以让管理员判断影响面。
 */
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
