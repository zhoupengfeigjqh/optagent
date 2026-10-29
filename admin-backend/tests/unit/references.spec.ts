/**
 * 引用推导（`references.ts`）的**反向查询与可读文案**。
 *
 * 为什么单独成文件：破坏性操作确认清单、全局异常汇总要回答的都是
 * "这个工具 / 服务 / SKILL / 本体被**谁**用了"，以及"异常怎么用一句话说清"。
 * 此前这些函数只被 `deploy-precheck.spec.ts` 顺带带入，函数覆盖率停在 77.77%，
 * 低于本项目"新增/触及模块 ≥80%"的门禁（宪章原则三）。
 */
import { describe, expect, it } from 'vitest';

import {
  agentsReferencingOntology,
  agentsReferencingService,
  agentsReferencingSkill,
  agentsReferencingTool,
  anomalyReason,
  categoryLabel,
  expandToPairs,
  type AgentRefSource,
  type Anomaly,
} from '../../src/domain/config-center/references.js';

function agent(name: string, extra: Partial<AgentRefSource> = {}): AgentRefSource {
  return {
    name,
    enabled_tools: [],
    mcp_services: [],
    skills: [],
    ontologies: [],
    ...extra,
  };
}

const AGENTS: AgentRefSource[] = [
  agent('排程助手', {
    enabled_tools: ['read_file', 'erp__query_order'],
    mcp_services: ['erp'],
    skills: ['risk-analysis'],
    ontologies: ['生产/排程本体'],
  }),
  agent('文档助手', { enabled_tools: ['read_file'], skills: ['doc-parse'] }),
  agent('空助手'),
];

describe('反向查询：谁引用了某个对象', () => {
  it('内置工具：命中全部引用者，未引用者不出现', () => {
    expect(agentsReferencingTool(AGENTS, 'read_file')).toEqual(['排程助手', '文档助手']);
    expect(agentsReferencingTool(AGENTS, 'erp__query_order')).toEqual(['排程助手']);
    expect(agentsReferencingTool(AGENTS, 'nothing')).toEqual([]);
  });

  it('MCP 服务：按服务名匹配', () => {
    expect(agentsReferencingService(AGENTS, 'erp')).toEqual(['排程助手']);
    expect(agentsReferencingService(AGENTS, 'crm')).toEqual([]);
  });

  it('SKILL：按技能名匹配', () => {
    expect(agentsReferencingSkill(AGENTS, 'risk-analysis')).toEqual(['排程助手']);
    expect(agentsReferencingSkill(AGENTS, 'doc-parse')).toEqual(['文档助手']);
  });

  it('本体：按「场景/本体」全名匹配（同名本体不串场景）', () => {
    expect(agentsReferencingOntology(AGENTS, '生产/排程本体')).toEqual(['排程助手']);
    expect(agentsReferencingOntology(AGENTS, '研发/排程本体')).toEqual([]);
  });
});

describe('异常文案：一次说清是哪几类对象失效', () => {
  const anomalies: Anomaly[] = [
    { category: 'builtin_tool', target_name: 'old_tool', detail: '内置工具 old_tool 不存在' },
    { category: 'mcp_service', target_name: 'erp', detail: 'MCP 服务 erp 未声明' },
    { category: 'skill', target_name: 'gone-skill', detail: 'SKILL gone-skill 已删除' },
    { category: 'ontology', target_name: '生产/旧本体', detail: '本体不存在' },
  ];

  it('无异常 → null（界面据此不显示错误条）', () => {
    expect(anomalyReason([])).toBeNull();
  });

  it('多类异常 → 中文分类名 + 对象名，顿号分隔', () => {
    expect(anomalyReason(anomalies)).toBe(
      '内置工具「old_tool」已失效；MCP 服务「erp」已失效；SKILL「gone-skill」已失效；本体「生产/旧本体」已失效',
    );
  });

  it('categoryLabel 与异常文案共用同一份中文名（不出现两套叫法）', () => {
    expect(categoryLabel('builtin_tool')).toBe('内置工具');
    expect(categoryLabel('mcp_service')).toBe('MCP 服务');
    expect(categoryLabel('skill')).toBe('SKILL');
    expect(categoryLabel('ontology')).toBe('本体');
  });
});

describe('影响面展开：数字人 → 「用户 × 数字人」对', () => {
  const users = [
    { user_id: 'u1', agents: ['排程助手', '空助手'] },
    { user_id: 'u2', agents: ['排程助手'] },
    { user_id: 'u3', agents: ['文档助手'] },
  ];

  it('同一数字人被多个用户关联时逐个展开（破坏性确认要列全）', () => {
    expect(expandToPairs(['排程助手'], users)).toEqual([
      { user_id: 'u1', agent_name: '排程助手' },
      { user_id: 'u2', agent_name: '排程助手' },
    ]);
  });

  it('未被任何用户关联的数字人不产生对（另有全局汇总负责列出）', () => {
    expect(expandToPairs(['孤兒助手'], users)).toEqual([]);
  });

  it('多个数字人按「用户顺序 × 该用户的数字人顺序」输出', () => {
    expect(expandToPairs(['空助手', '文档助手'], users)).toEqual([
      { user_id: 'u1', agent_name: '空助手' },
      { user_id: 'u3', agent_name: '文档助手' },
    ]);
  });
});
