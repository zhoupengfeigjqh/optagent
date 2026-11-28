import { describe, expect, it } from 'vitest';

import {
  assistantText,
  collectAvailable,
  isBuiltinTool,
  normalizeBatch,
  renderContinueInput,
} from '../../src/domain/plan/batch.js';
import { buildToolNameIndex } from '../../src/domain/plan/normalize.js';
import { SUMMARY_LINE_MAX, type RawStep } from '../../src/domain/plan/types.js';

const NAME_INDEX = buildToolNameIndex([
  { name: 'rawmcp__QueryInventory' },
  { name: 'mcp__svc__sumRawNotArrivalQty' },
]);

const RAW: RawStep[] = [
  { seqId: 1, taskName: '查询库存', content: '查询库存', coreAction: 'QueryInventory', type: 'query' },
];

describe('normalizeBatch', () => {
  it('从 base 起连续发号，并返回提交用的下一序号', () => {
    const result = normalizeBatch({
      raw: RAW,
      base: 7,
      nameIndex: NAME_INDEX,
      behaviorOf: () => null,
      facts: { relatedConceptsOf: () => [], ontologyKeysOfFunction: () => [], queryBehaviorsOf: () => [] },
    });

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.seqId).toBe(8);
    expect(result.nextSeqId).toBe(8);
  });
});

describe('renderContinueInput', () => {
  it('滚动：只给目标 + 已完成，并说明 [] 的语义', () => {
    const text = renderContinueInput({ goal: '补采购', doneSummary: ['缺 3 种料'], kind: 'roll' });

    expect(text).toContain('目标（本轮用户请求）：补采购');
    expect(text).toContain('已完成结论：\n· 缺 3 种料');
    expect(text).toContain('输出 []');
    expect(text).toContain('不要为了凑步骤而新增无意义的动作');
  });

  it('失败重规划：带失败原因，且不出现历史字样', () => {
    const text = renderContinueInput({
      goal: '补采购',
      doneSummary: [],
      kind: 'failure',
      failure: '第 2 步「创建采购」未能完成',
    });

    expect(text).toContain('上一步失败原因：第 2 步「创建采购」未能完成');
    expect(text).not.toContain('已完成结论');
    expect(text).not.toContain('历史消息');
  });
});

describe('collectAvailable', () => {
  it('同时收全名与裸名（rawmcp / mcp__svc 两类前缀）', () => {
    const keys = collectAvailable(['rawmcp__QueryInventory', 'mcp__svc__sumRawNotArrivalQty']);

    expect(keys.has('rawmcp__queryinventory')).toBe(true);
    expect(keys.has('queryinventory')).toBe(true);
    expect(keys.has('mcp__svc__sumrawnotarrivalqty')).toBe(true);
    expect(keys.has('svc__sumrawnotarrivalqty')).toBe(true);
  });
});

describe('isBuiltinTool', () => {
  it('裸名与带服务前缀都算内置', () => {
    expect(isBuiltinTool('read_file')).toBe(true);
    expect(isBuiltinTool('rawmcp__read_file')).toBe(true);
    expect(isBuiltinTool('rawmcp__QueryInventory')).toBe(false);
  });
});

describe('assistantText', () => {
  it('聚合文本块（截断归 appendSummary，此处不切）', () => {
    expect(
      assistantText({
        content: [
          { type: 'text', text: '第一段' },
          { type: 'toolCall', id: 'c1' },
          { type: 'text', text: '第二段' },
        ],
      }),
    ).toBe('第一段\n第二段');

    const long = assistantText({ content: [{ type: 'text', text: 'x'.repeat(SUMMARY_LINE_MAX + 50) }] });
    expect(Array.from(long)).toHaveLength(SUMMARY_LINE_MAX + 50);
  });

  it('字符串正文与非文本消息的退化行为', () => {
    expect(assistantText({ content: '  纯文本  ' })).toBe('纯文本');
    expect(assistantText({ content: null })).toBe('');
    expect(assistantText({})).toBe('');
  });
});
