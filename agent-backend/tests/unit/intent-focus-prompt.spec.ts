/**
 * 单元测试：聚焦提示铸造（016 / 019，2026-11-13 改为五元组）。
 *
 * 守住格式与边界：
 * - 固定前缀 + 编号块；块首行是技能，其后只有两段：`直接命中：` 与 `上游路径：`
 *   （概念不再单独成段——概念在五元组里已经出现，重复一遍纯属白占预算）；
 * - 本体技能带 `ontology_name='…'` / `ontology_id='…'`，非本体技能只有技能名；
 * - 五元组一行一条，方向写 `[上游]`、读向写 `→`/`←`，链尾无行为写 `（无可用行为）`；
 * - 空段整行省略；同本体多技能时行为与路径只挂到分数最高的技能下；
 * - `name` 保留原文不翻译，片段内换行压成空格；
 * - 长度上限按阶数分档（0→2000 / 1→3000 / 2→4000）；超限**先丢整行路径**
 *   （链尾无行为 → 跳数大 → 得分低，每个起点行为至少留一行），路径丢完才丢直接命中。
 */
import { describe, expect, it } from 'vitest';
import type { FocusPath } from '../../src/domain/intent-focus/paths.js';
import {
  MAX_PROMPT_CHARS,
  composeFocusPrompt,
  maxPromptChars,
  renderPath,
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

function path(overrides: Partial<FocusPath> = {}): FocusPath {
  return {
    ontologyId: '1',
    behavior: { name: 'CreatePurchaseRecord', title: '创建原材料采购单' },
    fromConcept: { name: 'PurchaseRecord', title: '原材料采购记录' },
    relation: { name: 'RecordsRawMaterial', title: '记录原材料' },
    direction: 'upstream',
    readability: 'forward',
    toConcept: { name: 'RawMaterial', title: '原材料' },
    toBehavior: { name: 'QueryRawMaterials', title: '查询原材料基本信息' },
    hop: 1,
    score: 0.9,
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

  it('本体技能：本体名与 id 用显式字段，行为单独成段', () => {
    const result = composeFocusPrompt([skill()], selection());
    expect(result.prompt).toBe(
      `${PREFIX}\n1）raw-material-inventory-new（本体技能；ontology_name='原材料采购和库存'，ontology_id='1'）\n` +
        '   直接命中：创建原材料采购单（CreatePurchaseRecord）、查询原材料采购单信息（QueryPurchaseRecords）',
    );
    expect(result.truncated).toBe(false);
  });

  it('五元组整行渲染：行为—概念—关系—概念—行为', () => {
    expect(renderPath(path())).toBe(
      '创建原材料采购单（CreatePurchaseRecord）—〔原材料采购记录(PurchaseRecord)〕—[上游]记录原材料→' +
        '〔原材料(RawMaterial)〕—→查询原材料基本信息（QueryRawMaterials）',
    );
  });

  it('关系名反读时用「←」，方向仍是「[上游]」——两者不可混为一谈', () => {
    expect(
      renderPath(
        path({
          relation: { name: 'ContainsPurchaseRecord', title: '包含采购记录' },
          readability: 'reverse',
          toConcept: { name: 'CustomerOrder', title: '客户订单' },
          toBehavior: null,
        }),
      ),
    ).toBe(
      '创建原材料采购单（CreatePurchaseRecord）—〔原材料采购记录(PurchaseRecord)〕—[上游]包含采购记录←' +
        '〔客户订单(CustomerOrder)〕—→（无可用行为）',
    );
  });

  it('上游路径单独成段，排在直接命中之后，一行一条', () => {
    const result = composeFocusPrompt([skill()], selection({ behaviors: [behavior('CreatePurchaseRecord', '创建原材料采购单')] }), {
      paths: [
        path(),
        path({
          relation: { name: 'OrderedFromSupplier', title: '从...采购' },
          toConcept: { name: 'Supplier', title: '供应商' },
          toBehavior: { name: 'QuerySuppliers', title: '查询供应商信息' },
        }),
      ],
    });
    const lines = result.prompt.split('\n');
    expect(lines[2]).toBe('   直接命中：创建原材料采购单（CreatePurchaseRecord）');
    expect(lines[3]).toBe('   上游路径：');
    expect(lines[4]).toContain('〔原材料(RawMaterial)〕');
    expect(lines[5]).toContain('〔供应商(Supplier)〕');
    // 两行都以起点行为开头（严格五元组，不省略）
    expect(lines[4]!.trimStart().startsWith('创建原材料采购单（CreatePurchaseRecord）')).toBe(true);
    expect(lines[5]!.trimStart().startsWith('创建原材料采购单（CreatePurchaseRecord）')).toBe(true);
  });

  it('没有路径时不输出「上游路径：」段', () => {
    const result = composeFocusPrompt([skill()], selection({ behaviors: [] }), { paths: [] });
    expect(result.prompt).not.toContain('上游路径');
    expect(result.prompt).toBe(
      `${PREFIX}\n1）raw-material-inventory-new（本体技能；ontology_name='原材料采购和库存'，ontology_id='1'）`,
    );
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

  it('同本体多技能：行为与路径只挂到分数最高的技能，其余只有本体信息', () => {
    const skills = [
      skill({ name: 'high', score: 0.95, order: 0 }),
      skill({ name: 'low', score: 0.7, order: 1 }),
    ];
    const result = composeFocusPrompt(skills, selection(), { paths: [path()] });
    expect(result.prompt).toBe(
      `${PREFIX}\n1）high（本体技能；ontology_name='原材料采购和库存'，ontology_id='1'）\n` +
        '   直接命中：创建原材料采购单（CreatePurchaseRecord）、查询原材料采购单信息（QueryPurchaseRecords）\n' +
        '   上游路径：\n' +
        '     创建原材料采购单（CreatePurchaseRecord）—〔原材料采购记录(PurchaseRecord)〕—[上游]记录原材料→' +
        '〔原材料(RawMaterial)〕—→查询原材料基本信息（QueryRawMaterials）\n' +
        "2）low（本体技能；ontology_name='原材料采购和库存'，ontology_id='1'）",
    );
  });

  it('跨本体的路径不归属到任何技能（找不到归属则忽略）', () => {
    const result = composeFocusPrompt([skill()], selection(), {
      paths: [path({ ontologyId: '99', toConcept: { name: 'Elsewhere', title: '别处概念' } })],
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

  it('阶数分档：0 → 2000，1 → 3000，2 → 4000', () => {
    expect(maxPromptChars(0)).toBe(MAX_PROMPT_CHARS);
    expect(maxPromptChars(1)).toBe(3000);
    expect(maxPromptChars(2)).toBe(4000);
    // 越界/负数按最保守的一档处理
    expect(maxPromptChars(-1)).toBe(MAX_PROMPT_CHARS);
    expect(maxPromptChars(9)).toBe(4000);
  });
});

describe('composeFocusPrompt 截断（行级）', () => {
  /** 同一起点行为的三条路径：一条链尾无行为、一条跳数大、一条普通 */
  function threePaths(): FocusPath[] {
    return [
      path(),
      path({
        relation: { name: 'ContainsPurchaseRecord', title: '包含采购记录' },
        readability: 'reverse',
        toConcept: { name: 'CustomerOrder', title: '客户订单' },
        toBehavior: null,
      }),
      path({
        behavior: { name: 'QueryRawMaterials', title: '查询原材料基本信息' },
        hop: 2,
        score: null,
        relation: { name: 'HasRawInventory', title: '拥有库存' },
        fromConcept: { name: 'RawMaterial', title: '原材料' },
        toConcept: { name: 'RawMaterialInventory', title: '原材料库存' },
        toBehavior: { name: 'QueryInventory', title: '查询库存信息' },
      }),
    ];
  }

  function fullLength(paths: FocusPath[]): number {
    return composeFocusPrompt([skill()], selection(), { paths }).prompt.length;
  }

  it('超限先丢「链尾无行为」的行，且丢的是整行', () => {
    const paths = threePaths();
    const full = fullLength(paths);
    const result = composeFocusPrompt([skill()], selection(), { paths, maxChars: full - 1 });

    expect(result.truncated).toBe(true);
    // 客户订单那条（deadEnd）先没了
    expect(result.prompt).not.toContain('客户订单');
    expect(result.prompt).toContain('〔原材料(RawMaterial)〕');
    // 每一行仍是完整五元组：都以起点行为开头
    const pathLines = result.prompt.split('\n').filter((line) => line.trimStart().startsWith('查询原材料基本信息')
      || line.trimStart().startsWith('创建原材料采购单'));
    expect(pathLines.length).toBe(2);
  });

  it('链尾无行为的丢完后，再丢跳数大的', () => {
    const paths = threePaths().filter((item) => item.toBehavior !== null);
    expect(paths).toHaveLength(2);
    const full = fullLength(paths);
    const result = composeFocusPrompt([skill()], selection(), { paths, maxChars: full - 1 });

    expect(result.truncated).toBe(true);
    // hop=2 那条被丢，hop=1 保留
    expect(result.prompt).not.toContain('原材料库存');
    expect(result.prompt).toContain('〔原材料(RawMaterial)〕');
  });

  it('每个起点行为至少留一行（不把某个行为的上下文全清空）', () => {
    const paths = [
      path(),
      path({
        relation: { name: 'OrderedFromSupplier', title: '从...采购' },
        toConcept: { name: 'Supplier', title: '供应商' },
        toBehavior: { name: 'QuerySuppliers', title: '查询供应商信息' },
      }),
    ];
    // 压到只够一行：仍然保留一条该起点行为的路径
    const oneLine = composeFocusPrompt([skill()], selection({ behaviors: [] }), { paths: paths.slice(0, 1) })
      .prompt.length;
    const result = composeFocusPrompt([skill()], selection({ behaviors: [] }), {
      paths,
      maxChars: oneLine,
    });
    expect(result.truncated).toBe(true);
    const kept = ['原材料(RawMaterial)', '供应商(Supplier)'].filter((name) => result.prompt.includes(name));
    expect(kept).toHaveLength(1);
    // 但没有出现"上游路径："段头却一行都没有的空段
    expect(result.prompt).not.toMatch(/上游路径：\n\s*$/);
  });

  it('路径丢完后才丢直接命中，且仍不出现半截条目', () => {
    const direct = Array.from({ length: 80 }, (_, i) => behavior(`QueryBehavior${i}`, `查询行为${i}`));
    const result = composeFocusPrompt([skill()], selection({ behaviors: direct }), {
      paths: [path()],
      maxChars: MAX_PROMPT_CHARS,
    });
    expect(result.truncated).toBe(true);
    expect(result.prompt.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    // 每个缩进行都是完整条目（行为行以「）」收尾，段头以「：」收尾），不出现半截名字
    for (const line of result.prompt.split('\n').slice(1)) {
      expect(line.endsWith('）') || line.endsWith('：')).toBe(true);
    }
  });
});
