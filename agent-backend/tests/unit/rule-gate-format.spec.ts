/**
 * 单元测试：文案与"规则全文"块（021）。
 *
 * 守住的口径（`SC-005` / `FR-015` / `FR-028` / `FR-042`）：
 * - 文案必须含行为名与规则名；
 * - 暂停与后置提示给**规则全文**（全部字段），不是摘要；
 * - 三种中止原因的 `details` 各自可辨认（未注册 / 求值不成立 / 配置不可用）；
 * - 后置阻断必须说明"已执行成功、数据已写入"；
 * - 同一输入渲染稳定（可作快照断言）。
 */
import { describe, expect, it } from 'vitest';

import { normalizeDesign } from '../../src/domain/rule-gate/design.js';
import {
  blockedPostDetails,
  blockedPostMessage,
  denyDetails,
  denyMessage,
  pauseDetails,
  pauseMessage,
  postBlock,
  ruleBlock,
} from '../../src/domain/rule-gate/format.js';
import type { BehaviorRef, RuleSpec } from '../../src/domain/rule-gate/types.js';

const REF: BehaviorRef = {
  ontologyKey: '原材料采购和库存/采购单',
  scenarioName: '原材料采购和库存',
  ontologyName: '采购单',
  behaviorName: 'CreatePurchaseRecord',
};

function ruleOf(overrides: Partial<RuleSpec> = {}): RuleSpec {
  const design = normalizeDesign(
    {
      combine: 'and',
      groups: [
        {
          combine: 'and',
          conditions: [
            { function: 'checkSupplierExistence', field: 'pass', operator: 'eq', values: ['true'] },
          ],
        },
      ],
    },
    [],
  );
  return {
    name: '采购-供应商名称一致',
    title: '供应商必须已存在',
    description: '创建采购单前确认供应商存在',
    behavior: 'CreatePurchaseRecord',
    position: '前置',
    relatedFunctions: ['checkSupplierExistence'],
    dataSupplements: ['近三个月同类采购'],
    design,
    passMessage: '供应商校验通过',
    failMessage: '供应商名称不存在，禁止创建采购单',
    raw: {},
    ...overrides,
  };
}

describe('ruleBlock', () => {
  it('覆盖规则的全部字段', () => {
    const block = ruleBlock(ruleOf());

    expect(block).toContain('规则：采购-供应商名称一致');
    expect(block).toContain('标题：供应商必须已存在');
    expect(block).toContain('描述：创建采购单前确认供应商存在');
    expect(block).toContain('绑定行为：CreatePurchaseRecord');
    expect(block).toContain('时机：前置');
    expect(block).toContain('关联函数：checkSupplierExistence');
    expect(block).toContain('数据补充：近三个月同类采购');
    expect(block).toContain('判定设计：');
    expect(block).toContain('"operator":"eq"');
    expect(block).toContain('通过文案：供应商校验通过');
    expect(block).toContain('失败文案：供应商名称不存在，禁止创建采购单');
  });

  it('未命名规则 / 未设计 / 空列表有稳定占位', () => {
    const block = ruleBlock(ruleOf({ name: '', design: null, relatedFunctions: [], dataSupplements: [] }));
    expect(block).toContain('（未命名规则）');
    expect(block).toContain('判定设计：（未设计）');
    expect(block).toContain('关联函数：（无）');
  });

  it('同一输入渲染稳定', () => {
    const rule = ruleOf();
    expect(ruleBlock(rule)).toBe(ruleBlock(rule));
  });
});

describe('pause', () => {
  const missing = [['checkSupplierExistence']];

  it('message 含行为名、规则名、缺失函数与"请先执行"，并附规则全文', () => {
    const message = pauseMessage(REF, [ruleOf()], missing);

    expect(message).toContain('原材料采购和库存/采购单/CreatePurchaseRecord');
    expect(message).toContain('采购-供应商名称一致');
    expect(message).toContain('缺失函数：checkSupplierExistence');
    expect(message).toContain('请先执行');
    expect(message).toContain('—— 规则全文 ——');
    expect(message).toContain('判定设计：');
  });

  it('details 为逐条原因（含缺失函数清单）', () => {
    const details = pauseDetails(REF, [ruleOf()], missing);
    expect(details).toHaveLength(4);
    expect(details[0]).toContain('行为：');
    expect(details[1]).toContain('采购-供应商名称一致');
    expect(details[2]).toContain('缺失函数：checkSupplierExistence');
  });

  it('多条规则缺失函数去重后列出', () => {
    const message = pauseMessage(
      REF,
      [ruleOf({ name: 'R1' }), ruleOf({ name: 'R2' })],
      [['fnA'], ['fnA', 'fnB']],
    );
    expect(message).toContain('缺失函数：fnA、fnB');
  });
});

describe('deny', () => {
  it('三种 reason 的结论句各自可辨认', () => {
    expect(denyMessage(REF, 'unregistered')).toContain('未注册函数');
    expect(denyMessage(REF, 'condition_false')).toContain('未通过前置规则校验');
    expect(denyMessage(REF, 'config_unavailable')).toContain('规则配置不可用');
    expect(denyMessage(REF, 'condition_false')).toContain('原材料采购和库存/采购单/CreatePurchaseRecord');
  });

  it('condition_false：含 fail_message 与未成立条件，条数 ≤ 6', () => {
    const details = denyDetails({
      ref: REF,
      reason: 'condition_false',
      rules: [ruleOf()],
      failed: Array.from({ length: 5 }, (_, i) => ({
        rule: '采购-供应商名称一致',
        function: 'checkSupplierExistence',
        field: `f${i}`,
        operator: 'eq',
      })),
    });

    expect(details[0]).toContain('行为：');
    expect(details[1]).toContain('规则：采购-供应商名称一致');
    expect(details).toContain('结论：供应商名称不存在，禁止创建采购单');
    expect(details.some((line) => line.startsWith('未成立条件：checkSupplierExistence.f0 eq'))).toBe(true);
    expect(details.length).toBeLessThanOrEqual(6);
  });

  it('unregistered：点名函数并给白名单建议', () => {
    const details = denyDetails({
      ref: REF,
      reason: 'unregistered',
      rules: [ruleOf()],
      unregistered: ['checkSupplierExistence'],
    });
    expect(details.join('\n')).toContain('未注册函数：checkSupplierExistence');
    expect(details.join('\n')).toContain('白名单');
  });

  it('config_unavailable：说明规则配置不可用', () => {
    const details = denyDetails({ ref: REF, reason: 'config_unavailable', rules: [ruleOf()] });
    expect(details.join('\n')).toContain('规则配置不可用');
    expect(details.join('\n')).toContain('rule_design');
  });

  it('规则无 fail_message 时给稳定兜底', () => {
    const details = denyDetails({
      ref: REF,
      reason: 'condition_false',
      rules: [ruleOf({ failMessage: '' })],
      failed: [],
    });
    expect(details).toContain('结论：规则未通过');
  });
});

describe('后置提示与后置阻断', () => {
  it('postBlock 有明确分界并附规则全文', () => {
    const text = postBlock([ruleOf({ position: '后置', name: '采购目的推理' })]);
    expect(text).toContain('后置规则提示');
    expect(text).toContain('采购目的推理');
    expect(text).toContain('判定设计：');
  });

  it('后置阻断：message 明确"已执行成功、数据已写入"', () => {
    const message = blockedPostMessage(REF);
    expect(message).toContain('已执行成功');
    expect(message).toContain('业务数据已写入');
    expect(message).toContain('CreatePurchaseRecord');
  });

  it('后置阻断 details 点名未注册函数并声明结果保留', () => {
    const details = blockedPostDetails(REF, [ruleOf({ position: '后置' })], ['inferPurchasePurpose']);
    expect(details.join('\n')).toContain('未注册函数：inferPurchasePurpose');
    expect(details.join('\n')).toContain('后置提示未追加');
  });
});
