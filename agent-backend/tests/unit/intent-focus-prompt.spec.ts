/**
 * 单元测试：聚焦提示铸造（016 / 019，2026-11-24 改为「分节 + 图路径」）。
 *
 * 守住格式与边界：
 * - 首行是边界声明（"不是工具清单"），其后每个入选技能一块：
 *   `技能 X → 本体 Y（ontology_id=…）`，块内三段固定序，段间空行，空段整段省略；
 * - 关键行为 = 判分命中的行为 + 函数关联概念的取数行为（两类条目形态一致）；
 * - 关键函数带 `@关联概念`，并用 `@概念 → 行为名` 指向"要先查的那条行为"；
 * - 图路径只由判分命中的行为出发，一行一跳，`→/←` 只表示本体边方向；
 * - 同本体多技能时能力与路径只挂到分数最高的技能下；
 * - `name` 保留原文不翻译，片段内换行压成空格；
 * - 长度上限按阶数分档（0→4000 / 1→5000 / 2→6000）；超限**先丢整行路径**
 *   （链尾无行为 → 跳数大 → 得分低，每个起点行为至少留一行），再丢取数行为、
 *   函数、判分命中的行为。
 */
import { describe, expect, it } from 'vitest';
import type { FocusPath } from '../../src/domain/intent-focus/paths.js';
import {
  MAX_PROMPT_CHARS,
  PROMPT_PREFIX,
  composeFocusPrompt,
  maxPromptChars,
  renderPath,
  type PromptSkill,
} from '../../src/domain/intent-focus/prompt.js';
import type {
  CapabilityDecision,
  CapabilitySelection,
  ConceptQueryDecision,
  FunctionDecision,
} from '../../src/domain/intent-focus/types.js';

const PREFIX = PROMPT_PREFIX;
const SKILL_LINE = '技能 raw-material-inventory-new → 本体 原材料采购和库存（ontology_id=1）';

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

function behavior(
  name: string,
  title: string,
  concept: string | null = null,
  score = 0.8,
): CapabilityDecision {
  return {
    name,
    title,
    ontologyId: '1',
    ontologyName: '原材料采购和库存',
    concept,
    score,
    index: 0,
  };
}

function fnDecision(
  name: string,
  title: string,
  relatedConcepts: string[] = ['PurchaseRecord'],
): FunctionDecision {
  return {
    name,
    title,
    ontologyId: '1',
    ontologyName: '原材料采购和库存',
    score: 0.85,
    relatedConcepts,
    index: 0,
  };
}

function queryDecision(name: string, title: string, concept = 'Supplier'): ConceptQueryDecision {
  return {
    name,
    title,
    ontologyId: '1',
    ontologyName: '原材料采购和库存',
    concept,
    index: 0,
  };
}

function selection(overrides: Partial<CapabilitySelection> = {}): CapabilitySelection {
  return {
    behaviors: [
      behavior('CreatePurchaseRecord', '创建原材料采购单'),
      behavior('QueryPurchaseRecords', '查询原材料采购单信息'),
    ],
    functions: [],
    conceptQueries: [],
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

  it('首行声明"不是工具清单"，避免模型把函数当可调用项', () => {
    expect(PREFIX).toContain('不是工具清单');
    expect(composeFocusPrompt([skill()], selection()).prompt.startsWith(`${PREFIX}\n`)).toBe(true);
  });

  it('非本体技能：只有技能名与「非本体技能」', () => {
    const result = composeFocusPrompt([skill({ isOntology: false, ontology: null, name: 'plain' })], selection());
    expect(result.prompt).toBe(`${PREFIX}\n技能 plain（非本体技能）`);
  });

  it('本体技能：技能 → 本体 同行，关键行为单独成段', () => {
    const result = composeFocusPrompt([skill()], selection());
    expect(result.prompt).toBe(
      `${PREFIX}\n${SKILL_LINE}\n\n` +
        '关键行为\n' +
        '· 创建原材料采购单 CreatePurchaseRecord\n' +
        '· 查询原材料采购单信息 QueryPurchaseRecords',
    );
    expect(result.truncated).toBe(false);
  });

  it('行为带 @所属概念，没有概念时省略', () => {
    const result = composeFocusPrompt(
      [skill()],
      selection({ behaviors: [behavior('QueryInventory', '查询原材料库存信息', 'RawMaterialInventory')] }),
    );
    expect(result.prompt).toContain('· 查询原材料库存信息 QueryInventory @RawMaterialInventory');
  });

  it('title 与 name 相同时只写一次，不留重复字', () => {
    const result = composeFocusPrompt([skill()], selection({ behaviors: [behavior('B1', 'B1')] }));
    expect(result.prompt).toContain('· B1');
    expect(result.prompt).not.toContain('B1 B1');
  });

  it('图路径一行一跳：关系顺写用「—〔〕→」，逆写用「←〔〕—」', () => {
    expect(renderPath(path())).toBe(
      '创建原材料采购单 CreatePurchaseRecord @PurchaseRecord —〔记录原材料〕→ RawMaterial ' +
        '→ 查询原材料基本信息 QueryRawMaterials',
    );
  });

  it('逆着本体边写时不改变阅读顺序，链尾无行为写「（无可用行为）」', () => {
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
      '创建原材料采购单 CreatePurchaseRecord @PurchaseRecord ←〔包含采购记录〕— CustomerOrder ' +
        '→（无可用行为）',
    );
  });

  it('图路径段带跳数与方向图例，一行一条且不带行号', () => {
    const result = composeFocusPrompt([skill()], selection({ behaviors: [] }), {
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
    expect(lines[0]).toBe(PREFIX);
    expect(lines[1]).toBe(SKILL_LINE);
    expect(lines[2]).toBe('');
    expect(lines[3]).toBe('图路径（上游 1 跳；→/← 为本体边方向，按从左到右即本轮路径）');
    expect(lines[4]).toBe(
      '创建原材料采购单 CreatePurchaseRecord @PurchaseRecord —〔记录原材料〕→ RawMaterial ' +
        '→ 查询原材料基本信息 QueryRawMaterials',
    );
    expect(lines[5]).toBe(
      '创建原材料采购单 CreatePurchaseRecord @PurchaseRecord —〔从...采购〕→ Supplier ' +
        '→ 查询供应商信息 QuerySuppliers',
    );
  });

  it('没有路径时不输出图路径段', () => {
    const result = composeFocusPrompt([skill()], selection({ behaviors: [] }), { paths: [] });
    expect(result.prompt).not.toContain('图路径');
    expect(result.prompt).toBe(`${PREFIX}\n${SKILL_LINE}`);
  });

  it('无入选行为时省略关键行为段', () => {
    const result = composeFocusPrompt([skill()], selection({ behaviors: [] }));
    expect(result.prompt).toBe(`${PREFIX}\n${SKILL_LINE}`);
    expect(result.prompt).not.toContain('关键行为');
  });

  it('本体缺名时只写 id', () => {
    const result = composeFocusPrompt(
      [skill({ ontology: { id: '2', name: null } })],
      selection({ behaviors: [] }),
    );
    expect(result.prompt).toBe(
      `${PREFIX}\n技能 raw-material-inventory-new → 本体（ontology_id=2）`,
    );
  });

  it('同本体多技能：能力与路径只挂到分数最高的技能，其余只有技能行', () => {
    const skills = [
      skill({ name: 'high', score: 0.95, order: 0 }),
      skill({ name: 'low', score: 0.7, order: 1 }),
    ];
    const result = composeFocusPrompt(skills, selection(), { paths: [path()] });
    expect(result.prompt).toBe(
      `${PREFIX}\n` +
        '技能 high → 本体 原材料采购和库存（ontology_id=1）\n\n' +
        '关键行为\n' +
        '· 创建原材料采购单 CreatePurchaseRecord\n' +
        '· 查询原材料采购单信息 QueryPurchaseRecords\n\n' +
        '图路径（上游 1 跳；→/← 为本体边方向，按从左到右即本轮路径）\n' +
        '创建原材料采购单 CreatePurchaseRecord @PurchaseRecord —〔记录原材料〕→ RawMaterial ' +
        '→ 查询原材料基本信息 QueryRawMaterials\n\n' +
        '技能 low → 本体 原材料采购和库存（ontology_id=1）',
    );
  });

  it('跨本体的路径不归属到任何技能（找不到归属则忽略）', () => {
    const result = composeFocusPrompt([skill()], selection(), {
      paths: [path({ ontologyId: '99', toConcept: { name: 'Elsewhere', title: '别处概念' } })],
    });
    expect(result.prompt).not.toContain('Elsewhere');
  });

  it('技能按分数降序输出，同分按原序', () => {
    const skills = [
      skill({ name: 'a', score: 0.7, order: 0, isOntology: false, ontology: null }),
      skill({ name: 'b', score: 0.9, order: 1, isOntology: false, ontology: null }),
      skill({ name: 'c', score: 0.7, order: 2, isOntology: false, ontology: null }),
    ];
    const result = composeFocusPrompt(skills, selection());
    expect(result.prompt).toBe(
      `${PREFIX}\n技能 b（非本体技能）\n\n技能 a（非本体技能）\n\n技能 c（非本体技能）`,
    );
  });

  it('name 原文不翻译；片段内换行压成空格，不产生额外行', () => {
    const result = composeFocusPrompt(
      [skill({ name: 'skill_with_underscore', ontology: { id: '1', name: '第一行\n第二行' } })],
      selection({ behaviors: [] }),
    );
    expect(result.prompt).toContain('skill_with_underscore');
    expect(result.prompt).toContain('第一行 第二行');
    // 只有前缀与技能行之间的那个换行
    expect(result.prompt.split('\n')).toHaveLength(2);
  });

  it('阶数分档：0 → 4000，1 → 5000，2 → 6000', () => {
    expect(maxPromptChars(0)).toBe(MAX_PROMPT_CHARS);
    expect(maxPromptChars(1)).toBe(5000);
    expect(maxPromptChars(2)).toBe(6000);
    // 越界/负数按最保守的一档处理
    expect(maxPromptChars(-1)).toBe(MAX_PROMPT_CHARS);
    expect(maxPromptChars(9)).toBe(6000);
  });
});

describe('composeFocusPrompt · 关键函数与取数行为（2026-11-24）', () => {
  const mixed = (): CapabilitySelection =>
    selection({
      behaviors: [behavior('CreatePurchaseRecord', '创建原材料采购单')],
      functions: [fnDecision('sumRawNotArrivalQty', '原材料未到位数')],
      conceptQueries: [queryDecision('QueryPurchaseRecords', '查询原材料采购单信息', 'PurchaseRecord')],
    });

  it('取数行为并入关键行为，函数条目用「@概念 → 行为名」指向它', () => {
    const result = composeFocusPrompt([skill()], mixed());
    expect(result.prompt).toBe(
      `${PREFIX}\n${SKILL_LINE}\n\n` +
        '关键行为\n' +
        '· 创建原材料采购单 CreatePurchaseRecord\n' +
        '· 查询原材料采购单信息 QueryPurchaseRecords @PurchaseRecord\n\n' +
        '关键函数\n' +
        '· 原材料未到位数 sumRawNotArrivalQty @PurchaseRecord → QueryPurchaseRecords',
    );
  });

  it('取数行为只出现一次（与直接命中去重），函数引用不重复', () => {
    const result = composeFocusPrompt(
      [skill()],
      selection({
        behaviors: [behavior('QueryPurchaseRecords', '查询原材料采购单信息', 'PurchaseRecord')],
        functions: [fnDecision('sumRawNotArrivalQty', '原材料未到位数')],
        conceptQueries: [queryDecision('QueryPurchaseRecords', '查询原材料采购单信息', 'PurchaseRecord')],
      }),
    );
    expect(result.prompt.match(/· 查询原材料采购单信息 QueryPurchaseRecords/g)).toHaveLength(1);
  });

  it('函数有多个关联概念时逐个带 @，各自挂自己的取数行为', () => {
    const result = composeFocusPrompt(
      [skill()],
      selection({
        behaviors: [],
        functions: [fnDecision('checkRawMaterialUnit', '校验采购原材料单位一致性', ['PurchaseRecord', 'RawMaterial'])],
        conceptQueries: [
          queryDecision('QueryPurchaseRecords', '查询原材料采购单信息', 'PurchaseRecord'),
          queryDecision('QueryRawMaterials', '查询原材料基本信息', 'RawMaterial'),
        ],
      }),
    );
    expect(result.prompt).toContain(
      '· 校验采购原材料单位一致性 checkRawMaterialUnit ' +
        '@PurchaseRecord → QueryPurchaseRecords、@RawMaterial → QueryRawMaterials',
    );
  });

  it('概念下没有取数行为时只写 @概念，不留「→ 」空槽', () => {
    const result = composeFocusPrompt(
      [skill()],
      selection({ behaviors: [], functions: [fnDecision('F1', '某函数', ['RawMaterial'])] }),
    );
    expect(result.prompt).toContain('· 某函数 F1 @RawMaterial');
    expect(result.prompt).not.toContain('@RawMaterial →');
  });

  it('函数没有 related_concepts 时不留空位', () => {
    const result = composeFocusPrompt(
      [skill()],
      selection({ behaviors: [], functions: [fnDecision('F1', '孤立函数', [])] }),
    );
    expect(result.prompt).toContain('· 孤立函数 F1');
    // 只剩技能行里的 `→ 本体`，函数行不带任何 @概念
    expect(result.prompt).not.toContain('@');
  });

  it('剪枝顺序：取数行为先丢 → 函数次之 → 判分命中的行为最后', () => {
    const full = composeFocusPrompt([skill()], mixed()).prompt.length;

    const dropQuery = composeFocusPrompt([skill()], mixed(), { maxChars: full - 1 });
    expect(dropQuery.prompt).not.toContain('QueryPurchaseRecords');
    expect(dropQuery.prompt).toContain('sumRawNotArrivalQty');
    expect(dropQuery.prompt).toContain('CreatePurchaseRecord');
    // 摘掉取数行后，函数条目不能留下悬空的「→ 行为名」
    expect(dropQuery.prompt).not.toContain('@PurchaseRecord →');

    const withoutQuery = composeFocusPrompt(
      [skill()],
      selection({
        behaviors: [behavior('CreatePurchaseRecord', '创建原材料采购单')],
        functions: [fnDecision('sumRawNotArrivalQty', '原材料未到位数')],
      }),
    ).prompt.length;
    const dropFunction = composeFocusPrompt([skill()], mixed(), { maxChars: withoutQuery - 1 });
    expect(dropFunction.prompt).not.toContain('sumRawNotArrivalQty');
    expect(dropFunction.prompt).toContain('CreatePurchaseRecord');
    expect(dropFunction.prompt).not.toContain('关键函数');
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
    expect(result.prompt).not.toContain('CustomerOrder');
    expect(result.prompt).toContain('@RawMaterial ');
    const pathLines = result.prompt
      .split('\n')
      .filter((line) => line.startsWith('创建原材料采购单') || line.startsWith('查询原材料基本信息'));
    expect(pathLines).toHaveLength(2);
  });

  it('链尾无行为的丢完后，再丢跳数大的', () => {
    const paths = threePaths().filter((item) => item.toBehavior !== null);
    expect(paths).toHaveLength(2);
    const full = fullLength(paths);
    const result = composeFocusPrompt([skill()], selection(), { paths, maxChars: full - 1 });

    expect(result.truncated).toBe(true);
    // hop=2 那条被丢，hop=1 保留
    expect(result.prompt).not.toContain('RawMaterialInventory');
    expect(result.prompt).toContain('→ RawMaterial ');
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
    const kept = ['→ RawMaterial ', '→ Supplier '].filter((ref) => result.prompt.includes(ref));
    expect(kept).toHaveLength(1);
    // 但没有出现"图路径..."段头却一行都没有的空段
    expect(result.prompt).not.toMatch(/图路径[^\n]*\n\s*$/);
  });

  it('路径丢完后才丢行为，且仍不出现半截条目', () => {
    // 200 行 ≈ 5000 字，稳超 0 阶上限（4000），确保真的触发行为级剪枝
    const direct = Array.from({ length: 200 }, (_, i) => behavior(`QueryBehavior${i}`, `查询行为${i}`));
    const result = composeFocusPrompt([skill()], selection({ behaviors: direct }), {
      paths: [path()],
      maxChars: MAX_PROMPT_CHARS,
    });
    expect(result.truncated).toBe(true);
    expect(result.prompt.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    // 每条条目行都是完整的「· 名称 name」，不出现半截
    for (const line of result.prompt.split('\n')) {
      if (line.startsWith('· ')) expect(line.trim().length).toBeGreaterThan(3);
    }
  });
});
