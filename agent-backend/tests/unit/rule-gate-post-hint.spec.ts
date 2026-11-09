/**
 * 单元测试：后置规则判定（021）——`postHint` 三态。
 *
 * 守住的口径（`FR-026` / `FR-027` / `FR-030` / `FR-042`）：
 * - 无后置规则 → `null`（不追加任何文本）；
 * - 有后置规则且函数全部已注册 → `append`，文本含规则**全文**与 `pass_message` / `fail_message`；
 * - 后置引用未注册函数 → `blocked`，`message` 必须声明"已执行成功、业务数据已写入"；
 * - 多条后置规则合并为**一个**追加块；
 * - 非本体行为 → `null`。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { matchKeys } from '../../src/domain/ontology-doc.js';
import { createRuleGate } from '../../src/domain/rule-gate/gate.js';
import { createFunctionRecord } from '../../src/domain/rule-gate/record.js';

const tmpDirs: string[] = [];

function tmpAgentDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-rule-gate-post-'));
  tmpDirs.push(dir);
  return dir;
}

function writeOntology(agentDir: string, extraRules: string[] = []): void {
  const dir = path.join(agentDir, 'ontology', '原材料采购和库存', '采购单');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'ontology.yaml'),
    [
      'metadata:',
      '  scenario_name: 原材料采购和库存',
      '  ontology_name: 采购单',
      'behaviors:',
      '  - name: CreatePurchaseRecord',
      '    title: 创建采购单',
      '  - name: QueryStock',
      '    title: 查询库存',
      'functions:',
      '  - name: inferPurchasePurpose',
      '    type: query',
      '    response:',
      '      purpose: string',
      'rules:',
      '  - name: 采购目的推理',
      '    title: 推导采购目的',
      '    description: 依据近三个月同类采购推导用途',
      '    behavior: CreatePurchaseRecord',
      '    position: 后置',
      '    related_functions:',
      '      - inferPurchasePurpose',
      '    data_supplements:',
      '      - 近三个月同类采购',
      '    pass_message: 目的推导完成',
      '    fail_message: 目的缺失',
      ...extraRules,
    ].join('\n'),
    'utf8',
  );
}

function availableOf(...names: string[]): ReadonlySet<string> {
  const set = new Set<string>();
  for (const name of names) {
    for (const key of matchKeys(name)) set.add(key);
  }
  return set;
}

const CREATE = 'erp__CreatePurchaseRecord';

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('postHint', () => {
  it('无后置规则 → null', () => {
    const agent = tmpAgentDir();
    writeOntology(agent);
    const gate = createRuleGate({ agentDir: agent });

    expect(
      gate.postHint({
        toolName: 'erp__QueryStock',
        record: createFunctionRecord(),
        available: availableOf(CREATE),
      }),
    ).toBeNull();
  });

  it('非本体行为 → null', () => {
    const agent = tmpAgentDir();
    writeOntology(agent);
    const gate = createRuleGate({ agentDir: agent });

    expect(
      gate.postHint({
        toolName: 'erp__OtherTool',
        record: createFunctionRecord(),
        available: availableOf(CREATE),
      }),
    ).toBeNull();
  });

  it('有后置规则且函数已注册 → append，含规则全文与两份文案', () => {
    const agent = tmpAgentDir();
    writeOntology(agent);
    const gate = createRuleGate({ agentDir: agent });

    const result = gate.postHint({
      toolName: CREATE,
      record: createFunctionRecord(),
      available: availableOf(CREATE, 'erp__inferPurchasePurpose'),
    });

    expect(result?.kind).toBe('append');
    if (result?.kind !== 'append') return;
    expect(result.rules).toEqual(['采购目的推理']);
    expect(result.text).toContain('后置规则提示');
    expect(result.text).toContain('采购目的推理');
    expect(result.text).toContain('判定设计：');
    expect(result.text).toContain('通过文案：目的推导完成');
    expect(result.text).toContain('失败文案：目的缺失');
    expect(result.text).toContain('数据补充：近三个月同类采购');
  });

  it('后置引用未注册函数 → blocked，声明已执行成功与数据已写入', () => {
    const agent = tmpAgentDir();
    writeOntology(agent);
    const gate = createRuleGate({ agentDir: agent });

    const result = gate.postHint({
      toolName: CREATE,
      record: createFunctionRecord(),
      available: availableOf(CREATE),
    });

    expect(result?.kind).toBe('blocked');
    if (result?.kind !== 'blocked') return;
    expect(result.message).toContain('已执行成功');
    expect(result.message).toContain('业务数据已写入');
    expect(result.details.join('\n')).toContain('未注册函数：inferPurchasePurpose');
    expect(result.rules).toEqual(['采购目的推理']);
  });

  it('多条后置规则合并为一个追加块（规则名全部列出）', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, [
      '  - name: 采购-供应商复盘',
      '    behavior: CreatePurchaseRecord',
      '    position: 后置',
      '    related_functions: []',
    ]);
    const gate = createRuleGate({ agentDir: agent });

    const result = gate.postHint({
      toolName: CREATE,
      record: createFunctionRecord(),
      available: availableOf(CREATE, 'erp__inferPurchasePurpose'),
    });

    expect(result?.kind).toBe('append');
    if (result?.kind !== 'append') return;
    expect(result.rules).toEqual(['采购目的推理', '采购-供应商复盘']);
    expect(result.text.match(/后置规则提示/g)).toHaveLength(1);
  });

  it('只看注册、不看"本轮是否执行过"（后置函数由模型在本跳内调用）', () => {
    const agent = tmpAgentDir();
    writeOntology(agent);
    const gate = createRuleGate({ agentDir: agent });

    // 记录为空也能 append：后置规则的作用就是引导模型去调用
    const result = gate.postHint({
      toolName: CREATE,
      record: createFunctionRecord(),
      available: availableOf(CREATE, 'erp__inferPurchasePurpose'),
    });
    expect(result?.kind).toBe('append');
  });

  it('永不抛：非法 agentDir → blocked（不追加）', () => {
    const gate = createRuleGate({ agentDir: undefined as never });
    expect(() =>
      gate.postHint({
        toolName: CREATE,
        record: createFunctionRecord(),
        available: availableOf(CREATE),
      }),
    ).not.toThrow();
    expect(
      gate.postHint({
        toolName: CREATE,
        record: createFunctionRecord(),
        available: availableOf(CREATE),
      })?.kind,
    ).toBe('blocked');
  });
});
