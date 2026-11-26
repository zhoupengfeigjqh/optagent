import { describe, expect, it } from 'vitest';

import { createFunctionRecord, extractBusinessData } from '../../src/domain/rule-gate/record.js';

describe('extractBusinessData', () => {
  it('统一信封：同时含 data 与 success/error/status 之一 → 取 data', () => {
    expect(extractBusinessData({ success: true, data: { pass: true } })).toEqual({ pass: true });
    expect(extractBusinessData({ status: 'ok', data: { a: 1 } })).toEqual({ a: 1 });
    expect(extractBusinessData({ error: null, data: { a: 1 } })).toEqual({ a: 1 });
  });

  it('只有 data 没有状态字段 → 视为扁平服务，取整个对象', () => {
    expect(extractBusinessData({ data: { a: 1 }, other: 2 })).toEqual({ data: { a: 1 }, other: 2 });
  });

  it('扁平对象：取对象本身', () => {
    expect(extractBusinessData({ status: 'ok', message: 'done' })).toEqual({
      status: 'ok',
      message: 'done',
    });
  });

  it('数组：{ count, items }', () => {
    expect(extractBusinessData([1, 2, 3])).toEqual({ count: 3, items: [1, 2, 3] });
    expect(extractBusinessData([])).toEqual({ count: 0, items: [] });
  });

  it('字符串：合法 JSON 解析，非法记 {}', () => {
    expect(extractBusinessData('{"pass":true}')).toEqual({ pass: true });
    expect(extractBusinessData('not json')).toEqual({});
    expect(extractBusinessData('[1,2]')).toEqual({ count: 2, items: [1, 2] });
  });

  it('工具结果信封 { content, details }：取 content 文本再解析（真实 MCP 形态）', () => {
    expect(
      extractBusinessData({
        content: [{ type: 'text', text: '{"pass":true,"detail":{"qty":120}}' }],
        details: {},
      }),
    ).toEqual({ pass: true, detail: { qty: 120 } });

    expect(
      extractBusinessData({
        content: [{ type: 'text', text: '{"success":true,"data":{"pass":false}}' }],
        details: {},
      }),
    ).toEqual({ pass: false });

    expect(
      extractBusinessData({ content: [{ type: 'text', text: '纯文本结果' }], details: {} }),
    ).toEqual({});
  });

  it('content 块数组：拼接文本后按字符串处理', () => {
    expect(extractBusinessData([{ type: 'text', text: '{"pass":' }, { type: 'text', text: 'true}' }])).toEqual({
      pass: true,
    });
  });

  it('信封里的 data 是数组 → { count, items }；是标量 → {}', () => {
    expect(extractBusinessData({ success: true, data: [1, 2] })).toEqual({ count: 2, items: [1, 2] });
    expect(extractBusinessData({ success: true, data: 42 })).toEqual({});
  });

  it('无法得到对象（数字 / 布尔 / null）→ {}', () => {
    expect(extractBusinessData(42)).toEqual({});
    expect(extractBusinessData(true)).toEqual({});
    expect(extractBusinessData(null)).toEqual({});
  });
});

describe('createFunctionRecord：边界（FR-036 / D12 / D14）', () => {
  it('条目上限 64：第 65 条丢弃并告警，已存条目不受影响', () => {
    const drops: unknown[] = [];
    const record = createFunctionRecord({ warn: (info) => drops.push(info) });

    for (let i = 0; i < 64; i += 1) record.add(`fn${i}`, { i });
    expect(record.size).toBe(64);

    record.add('fn64', { i: 64 });
    expect(record.size).toBe(64);
    expect(record.has('fn64')).toBe(false);
    expect(record.has('fn0')).toBe(true);
    expect(drops).toEqual([{ toolName: 'fn64', reason: 'overflow', count: 64 }]);
  });

  it('同名重复写入不占新额度（最后一次覆盖）', () => {
    const record = createFunctionRecord();
    for (let i = 0; i < 80; i += 1) record.add('same', { i });
    expect(record.size).toBe(1);
    expect(record.get('same')).toEqual({ i: 79 });
  });

  it('单条超 256KB：丢弃该条并告警，键不存在（= 未执行）', () => {
    const drops: unknown[] = [];
    const record = createFunctionRecord({ warn: (info) => drops.push(info) });

    record.add('big', { payload: 'x'.repeat(300 * 1024) });

    expect(record.size).toBe(0);
    expect(record.has('big')).toBe(false);
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ toolName: 'big', reason: 'oversize' });
    expect((drops[0] as { bytes: number }).bytes).toBeGreaterThan(256 * 1024);
  });

  it('超限会清掉该键的旧值（保证"键存在 = 本轮可用"）', () => {
    const record = createFunctionRecord();
    record.add('f', { ok: true });
    record.add('f', { payload: 'x'.repeat(300 * 1024) });

    expect(record.has('f')).toBe(false);
  });

  it('恰好在阈值内不被丢弃', () => {
    const record = createFunctionRecord();
    record.add('ok', { payload: 'x'.repeat(200 * 1024) });
    expect(record.has('ok')).toBe(true);
  });
});

describe('createFunctionRecord', () => {
  it('成败都记：失败写 null，且 has 为 true', () => {
    const record = createFunctionRecord();
    record.add('erp__checkSupplierExistence', { success: true, data: { pass: true } });
    record.add('erp__inferPurchasePurpose', null);

    expect(record.size).toBe(2);
    expect(record.has('checkSupplierExistence')).toBe(true);
    expect(record.get('checkSupplierExistence')).toEqual({ pass: true });
    expect(record.has('inferPurchasePurpose')).toBe(true);
    expect(record.get('inferPurchasePurpose')).toBeNull();
  });

  it('同名多次：最后一次覆盖（失败覆盖成功）', () => {
    const record = createFunctionRecord();
    record.add('f', { a: 1 });
    record.add('f', { a: 2 });
    expect(record.get('f')).toEqual({ a: 2 });

    record.add('f', null);
    expect(record.get('f')).toBeNull();
    expect(record.size).toBe(1);
  });

  it('键归一：去服务前缀 + 去空白 + 小写；读写同口径', () => {
    const record = createFunctionRecord();
    record.add('  ERP__CheckSupplier  ', { pass: true });

    expect(record.has('checksupplier')).toBe(true);
    expect(record.has('erp__CheckSupplier')).toBe(true);
    expect(record.get('  CheckSupplier  ')).toEqual({ pass: true });
    expect(record.size).toBe(1);
  });

  it('未执行过的函数：has=false、get=undefined', () => {
    const record = createFunctionRecord();
    expect(record.has('neverCalled')).toBe(false);
    expect(record.get('neverCalled')).toBeUndefined();
  });

  it('空工具名不写入', () => {
    const record = createFunctionRecord();
    record.add('   ', { a: 1 });
    expect(record.size).toBe(0);
  });

  it('每次 createFunctionRecord 互相独立（轮内记录不跨轮）', () => {
    const first = createFunctionRecord();
    first.add('f', { a: 1 });
    const second = createFunctionRecord();
    expect(second.has('f')).toBe(false);
    expect(second.size).toBe(0);
  });
});

describe('createFunctionRecord：世代（command 写后失效，2026-11-24）', () => {
  it('invalidate 后旧条目不可读但仍在（hasEver 可见），activeSize 归零', () => {
    const record = createFunctionRecord();
    record.add('checkA', { pass: true });
    expect(record.epoch).toBe(0);
    expect(record.activeSize).toBe(1);

    record.invalidate();

    expect(record.epoch).toBe(1);
    expect(record.has('checkA')).toBe(false);
    expect(record.get('checkA')).toBeUndefined();
    expect(record.hasEver('checkA')).toBe(true);
    expect(record.size).toBe(1);
    expect(record.activeSize).toBe(0);
  });

  it('重算后覆盖同键，读取取最新值；世代继续单调递增', () => {
    const record = createFunctionRecord();
    record.add('checkA', { pass: true });
    record.invalidate();
    record.add('checkA', { pass: false });

    expect(record.get('checkA')).toEqual({ pass: false });
    expect(record.has('checkA')).toBe(true);

    record.invalidate();
    expect(record.epoch).toBe(2);
    expect(record.has('checkA')).toBe(false);
  });

  it('显式传入派发世代：落在旧世代的条目对新世代不可见（并行批次保守降级）', () => {
    const record = createFunctionRecord();
    const dispatched = record.epoch;
    record.invalidate();
    record.add('lateFn', { ok: true }, dispatched);

    expect(record.has('lateFn')).toBe(false);
    expect(record.hasEver('lateFn')).toBe(true);
  });

  it('世代不影响"最后一次覆盖"与归一：同一世代内多次调用只留最后一条', () => {
    const record = createFunctionRecord();
    record.add('erp__CheckA', { pass: true });
    record.add('  checkA  ', { pass: false });

    expect(record.size).toBe(1);
    expect(record.get('checkA')).toEqual({ pass: false });
  });

  it('超限丢弃会删掉整键（含旧世代），hasEver 同样变为 false', () => {
    const record = createFunctionRecord();
    record.add('big', { ok: true });
    record.invalidate();
    record.add('big', { payload: 'x'.repeat(300 * 1024) });

    expect(record.hasEver('big')).toBe(false);
    expect(record.size).toBe(0);
  });
});
