/**
 * 单元测试：聚焦提示铸造（016 / 019）。
 *
 * 守住格式与边界：
 * - 固定前缀 + 编号块；块首行是技能，缩进行按来源分段
 *   （关联概念 / 上游概念 / 直接命中 / 上游参考）；
 * - 本体技能带 `ontology_name='…'` / `ontology_id='…'`，非本体技能只有技能名；
 * - 空段整行省略；同本体多技能时概念与行为只挂到分数最高的技能下；
 * - `name` 保留原文不翻译，片段内换行压成空格；
 * - **概念不设上限、不截断**；长度上限按阶数分档（0→1200 / 1→1600 / 2→2000），
 *   超限先丢「上游参考」再丢「直接命中」，概念段永不丢。
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_PROMPT_CHARS,
  composeFocusPrompt,
  maxPromptChars,
  type PromptBehavior,
  type PromptConcept,
  type PromptSkill,
} from '../../src/domain/intent-focus/prompt.js';
import type { CapabilityDecision, CapabilitySelection } from '../../src/domain/intent-focus/types.js';

const PREFIX = '本轮的任务与以下技能、本体概念与本体行为密切相关，请重点关注（仅供参考，不必局限）';

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
    concept: null,
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
    ...overrides,
  };
}

function concept(
  name: string,
  title: string,
  hop = 0,
  ontologyId = '1',
): PromptConcept {
  return { ontologyId, name, title, hop };
}

function upstream(name: string, title: string, ontologyId = '1'): PromptBehavior {
  return { ontologyId, name, title };
}

describe('composeFocusPrompt', () => {
  it('无技能返回空串（调用方据此不追加）', () => {
    expect(composeFocusPrompt([], selection()).prompt).toBe('');
  });

  it('非本体技能：只有技能名与「非本体技能」', () => {
    const result = composeFocusPrompt([skill({ isOntology: false, ontology: null, name: 'plain' })], selection());
    expect(result.prompt).toBe(`${PREFIX}\n1）plain（非本体技能）`);
  });

  it('本体技能：本体名与 id 用显式字段，行为单独成段', () => {
    const result = composeFocusPrompt([skill()], selection());
    expect(result.prompt).toBe(
      `${PREFIX}\n1）raw-material-inventory-new（本体技能；ontology_name='原材料采购和库存'，ontology_id='1'）\n` +
        '   直接命中：创建原材料采购单（CreatePurchaseRecord）、查询原材料采购单信息（QueryPurchaseRecords）',
    );
    expect(result.truncated).toBe(false);
  });

  it('概念分「关联概念（直接命中）」与「上游概念（发散）」两段', () => {
    const result = composeFocusPrompt([skill()], selection(), {
      concepts: [
        concept('RawMaterialInventory', '原材料库存'),
        concept('RawMaterial', '原材料'),
        concept('Supplier', '供应商', 1),
      ],
    });
    expect(result.prompt).toContain('   关联概念：原材料库存（RawMaterialInventory）、原材料（RawMaterial）');
    expect(result.prompt).toContain('   上游概念：供应商（Supplier）');
  });

  it('上游发散行为单独成段，排在直接命中之后', () => {
    const result = composeFocusPrompt([skill()], selection(), {
      upstreamBehaviors: [upstream('QuerySuppliers', '查询供应商信息')],
    });
    const lines = result.prompt.split('\n');
    expect(lines[2]).toBe('   直接命中：创建原材料采购单（CreatePurchaseRecord）、查询原材料采购单信息（QueryPurchaseRecords）');
    expect(lines[3]).toBe('   上游参考：查询供应商信息（QuerySuppliers）');
  });

  it('无入选行为时省略「直接命中：」段', () => {
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

  it('同本体多技能：概念与行为只挂到分数最高的技能，其余只有本体信息', () => {
    const skills = [
      skill({ name: 'high', score: 0.95, order: 0 }),
      skill({ name: 'low', score: 0.7, order: 1 }),
    ];
    const result = composeFocusPrompt(skills, selection(), {
      concepts: [concept('RawMaterial', '原材料')],
    });
    expect(result.prompt).toBe(
      `${PREFIX}\n1）high（本体技能；ontology_name='原材料采购和库存'，ontology_id='1'）\n` +
        '   关联概念：原材料（RawMaterial）\n' +
        '   直接命中：创建原材料采购单（CreatePurchaseRecord）、查询原材料采购单信息（QueryPurchaseRecords）\n' +
        "2）low（本体技能；ontology_name='原材料采购和库存'，ontology_id='1'）",
    );
  });

  it('跨本体条目只归属到对应技能（找不到归属则忽略）', () => {
    const result = composeFocusPrompt([skill()], selection(), {
      concepts: [concept('Elsewhere', '别处概念', 0, '99')],
    });
    expect(result.prompt).not.toContain('别处概念');
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

  it('概念不设上限、不截断：概念段可以撑破长度上限', () => {
    const many = Array.from({ length: 200 }, (_, i) => concept(`Concept${i}`, `概念${i}`));
    const result = composeFocusPrompt([skill()], selection({ behaviors: [] }), { concepts: many });
    expect(result.prompt.length).toBeGreaterThan(MAX_PROMPT_CHARS);
    expect(result.truncated).toBe(false);
    expect(result.prompt).toContain('概念0（Concept0）');
    expect(result.prompt).toContain('概念199（Concept199）');
  });

  it('阶数分档：0 → 1200，1 → 1600，2 → 2000', () => {
    expect(maxPromptChars(0)).toBe(MAX_PROMPT_CHARS);
    expect(maxPromptChars(1)).toBe(1600);
    expect(maxPromptChars(2)).toBe(2000);
    // 越界/负数按最保守的一档处理
    expect(maxPromptChars(-1)).toBe(MAX_PROMPT_CHARS);
    expect(maxPromptChars(9)).toBe(2000);
  });

  it('超限时先丢上游发散行为，直接命中全部保留', () => {
    const direct = Array.from({ length: 3 }, (_, i) => behavior(`Direct${i}`, `直接行为${i}`));
    const expanded = Array.from({ length: 5 }, (_, i) => upstream(`Up${i}`, `上游行为${i}`));
    const full = composeFocusPrompt([skill()], selection({ behaviors: direct }), {
      upstreamBehaviors: expanded,
    });
    const result = composeFocusPrompt([skill()], selection({ behaviors: direct }), {
      upstreamBehaviors: expanded,
      maxChars: full.prompt.length - 1,
    });

    expect(result.truncated).toBe(true);
    for (const item of direct) expect(result.prompt).toContain(item.name);
    const kept = expanded.filter((item) => result.prompt.includes(item.name)).length;
    expect(kept).toBe(expanded.length - 1);
  });

  it('上游丢完后才丢直接命中，仍不出现半截条目', () => {
    const direct = Array.from({ length: 80 }, (_, i) => behavior(`QueryBehavior${i}`, `查询行为${i}`));
    const result = composeFocusPrompt([skill()], selection({ behaviors: direct }), {
      maxChars: MAX_PROMPT_CHARS,
    });
    expect(result.truncated).toBe(true);
    expect(result.prompt.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    for (const line of result.prompt.split('\n').slice(1)) expect(line.endsWith('）')).toBe(true);
  });
});
