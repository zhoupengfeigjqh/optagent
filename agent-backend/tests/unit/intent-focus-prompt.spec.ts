/**
 * 单元测试：聚焦提示铸造（016）。
 *
 * 守住格式与边界：
 * - 固定前缀 + 编号清单（`1）2）3）`），每个技能一行；
 * - 本体技能带 `ontology_name='…'` / `ontology_id='…'` 与「关联行为（title（name））」；
 * - 非本体技能只有技能名 + 「非本体技能」；无入选行为时整段省略；
 * - 同本体多技能时行为只挂到分数最高的技能下；
 * - `name` 保留原文不翻译，片段内换行压成空格；
 * - 超过 1200 字符按完整条目截断，不出现半截条目。
 *
 * 2026-11-06：提示不再有「关联函数」段。
 */
import { describe, expect, it } from 'vitest';
import { MAX_PROMPT_CHARS, composeFocusPrompt, type PromptSkill } from '../../src/domain/intent-focus/prompt.js';
import type { CapabilityDecision, CapabilitySelection } from '../../src/domain/intent-focus/types.js';

const PREFIX = '本轮的任务与以下技能或本体行为密切相关，请重点关注（仅供参考，不必局限）';

function skill(overrides: Partial<PromptSkill> = {}): PromptSkill {
  return {
    name: 'raw-material-inventory-new',
    isOntology: true,
    ontology: { id: '1', name: '原材料采购和库存' },
    score: 0.9,
    order: 0,
    ...overrides,
  };
}

function behavior(name: string, title: string, ontologyId = '1', score = 0.8): CapabilityDecision {
  return {
    name,
    title,
    ontologyId,
    ontologyName: '原材料采购和库存',
    score,
    index: 0,
  };
}

function selection(overrides: Partial<CapabilitySelection> = {}): CapabilitySelection {
  return {
    behaviors: [
      behavior('CreatePurchaseRecord', '创建原材料采购单'),
      behavior('QueryPurchaseRecords', '查询原材料采购单信息'),
    ],
    truncated: false,
    ...overrides,
  };
}

describe('composeFocusPrompt', () => {
  it('无技能返回空串（调用方据此不追加）', () => {
    expect(composeFocusPrompt([], selection()).prompt).toBe('');
  });

  it('非本体技能：只有技能名与「非本体技能」', () => {
    const result = composeFocusPrompt([skill({ isOntology: false, ontology: null, name: 'plain' })], selection());
    expect(result.prompt).toBe(`${PREFIX}\n1）plain（非本体技能）`);
  });

  it('本体技能：本体名与 id 用显式字段，行为用 title（name）列出', () => {
    const result = composeFocusPrompt([skill()], selection());
    expect(result.prompt).toBe(
      `${PREFIX}\n1）raw-material-inventory-new（本体技能；ontology_name='原材料采购和库存'，ontology_id='1'；关联行为：创建原材料采购单（CreatePurchaseRecord）、查询原材料采购单信息（QueryPurchaseRecords））`,
    );
    expect(result.truncated).toBe(false);
  });

  it('无入选行为时省略「关联行为：」段', () => {
    const result = composeFocusPrompt([skill()], selection({ behaviors: [] }));
    expect(result.prompt).toBe(
      `${PREFIX}\n1）raw-material-inventory-new（本体技能；ontology_name='原材料采购和库存'，ontology_id='1'）`,
    );
  });

  it('本体缺名时只写 id', () => {
    const result = composeFocusPrompt(
      [skill({ ontology: { id: '2', name: null } })],
      selection({ behaviors: [] }),
    );
    expect(result.prompt).toBe(`${PREFIX}\n1）raw-material-inventory-new（本体技能；ontology_id='2'）`);
  });

  it('同本体多技能：行为只挂到分数最高的技能，其余只有本体信息', () => {
    const skills = [
      skill({ name: 'high', score: 0.95, order: 0 }),
      skill({ name: 'low', score: 0.7, order: 1 }),
    ];
    const result = composeFocusPrompt(skills, selection());
    expect(result.prompt).toBe(
      `${PREFIX}\n1）high（本体技能；ontology_name='原材料采购和库存'，ontology_id='1'；关联行为：创建原材料采购单（CreatePurchaseRecord）、查询原材料采购单信息（QueryPurchaseRecords））\n2）low（本体技能；ontology_name='原材料采购和库存'，ontology_id='1'）`,
    );
  });

  it('技能按分数降序输出并重新编号，同分按原序', () => {
    const skills = [
      skill({ name: 'a', score: 0.7, order: 0, isOntology: false, ontology: null }),
      skill({ name: 'b', score: 0.9, order: 1, isOntology: false, ontology: null }),
      skill({ name: 'c', score: 0.7, order: 2, isOntology: false, ontology: null }),
    ];
    const result = composeFocusPrompt(skills, selection());
    expect(result.prompt).toBe(`${PREFIX}\n1）b（非本体技能）\n2）a（非本体技能）\n3）c（非本体技能）`);
  });

  it('name 原文不翻译；片段内换行压成空格，不产生额外行', () => {
    const result = composeFocusPrompt(
      [skill({ name: 'skill_with_underscore', ontology: { id: '1', name: '第一行\n第二行' } })],
      selection({ behaviors: [] }),
    );
    expect(result.prompt).toContain('skill_with_underscore');
    expect(result.prompt).toContain('第一行 第二行');
    // 只有前缀与条目之间的那个换行
    expect(result.prompt.split('\n')).toHaveLength(2);
  });

  it('超过 1200 字符时按完整条目截断，不出现半截条目', () => {
    const many = Array.from({ length: 80 }, (_, i) => behavior(`QueryBehavior${i}`, `查询行为${i}`));
    const result = composeFocusPrompt([skill()], selection({ behaviors: many }));
    expect(result.truncated).toBe(true);
    expect(result.prompt.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    for (const line of result.prompt.split('\n').slice(1)) expect(line.endsWith('）')).toBe(true);
  });
});
