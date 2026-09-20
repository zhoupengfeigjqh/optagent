/**
 * 单元测试：算法规则文件解析（rule-file，HITL「从算法规则选择」数据源）。
 *
 * 守住的语义：
 * - 首行表头 → columns；数据行原样转对象（键 = 表头，值 = 该行值），空行跳过
 * - 优先级列按表头名识别（priority / 优先级，大小写不敏感）
 * - 格式问题（不支持扩展名/损坏/空表头/重复列名/超行数上限）抛中文可读错误
 */
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import { MAX_RULE_ROWS, parseRuleFile } from '../../src/domain/rule-file.js';

function csvBuffer(text: string): Buffer {
  return Buffer.from(text, 'utf8');
}

function xlsxBuffer(rows: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  return XLSX.write({ SheetNames: ['规则'], Sheets: { 规则: sheet } }, { type: 'buffer', bookType: 'xlsx' });
}

describe('parseRuleFile —— CSV', () => {
  it('表头 + 数据行 → columns/rows；行对象键 = 表头列名', () => {
    const buf = csvBuffer('规则编码,规则名称,优先级\nR001,峰谷平移,3\nR002,需量控制,1\n');
    const parsed = parseRuleFile('rules.csv', buf);

    expect(parsed.columns).toEqual(['规则编码', '规则名称', '优先级']);
    expect(parsed.rows).toEqual([
      { 规则编码: 'R001', 规则名称: '峰谷平移', 优先级: 3 },
      { 规则编码: 'R002', 规则名称: '需量控制', 优先级: 1 },
    ]);
    expect(parsed.priority_column).toBe('优先级');
  });

  it('优先级列识别：priority（大小写不敏感）与「优先级」均可；无则 null', () => {
    expect(parseRuleFile('a.csv', csvBuffer('code,Priority\nR001,2')).priority_column).toBe('Priority');
    expect(parseRuleFile('b.csv', csvBuffer('code,名称\nR001,x')).priority_column).toBeNull();
  });

  it('整行为空的行被跳过（表格尾部空行不产出规则）', () => {
    const buf = csvBuffer('code,priority\nR001,1\n,,\n\nR002,2\n');
    const parsed = parseRuleFile('rules.csv', buf);
    expect(parsed.rows).toEqual([
      { code: 'R001', priority: 1 },
      { code: 'R002', priority: 2 },
    ]);
  });

  it('仅表头（无数据行）→ rows 为空数组（合法：选择器显示空态）', () => {
    expect(parseRuleFile('rules.csv', csvBuffer('code,priority\n')).rows).toEqual([]);
  });
});

describe('parseRuleFile —— XLSX', () => {
  it('首个工作表按同样口径解析（数字单元格保持数字类型）', () => {
    const buf = xlsxBuffer([
      ['规则编码', '规则名称', '优先级'],
      ['R001', '峰谷平移', 3],
      ['R002', '需量控制', 1],
    ]);
    const parsed = parseRuleFile('rules.xlsx', buf);

    expect(parsed.columns).toEqual(['规则编码', '规则名称', '优先级']);
    expect(parsed.rows).toEqual([
      { 规则编码: 'R001', 规则名称: '峰谷平移', 优先级: 3 },
      { 规则编码: 'R002', 规则名称: '需量控制', 优先级: 1 },
    ]);
    expect(parsed.priority_column).toBe('优先级');
  });
});

describe('parseRuleFile —— 异常', () => {
  it('不支持的扩展名 → 可读错误', () => {
    expect(() => parseRuleFile('rules.json', csvBuffer('{}'))).toThrow('仅支持 .xlsx / .csv');
    expect(() => parseRuleFile('rules', csvBuffer('a'))).toThrow('仅支持 .xlsx / .csv');
  });

  it('内容损坏 → 可读错误（不抛底层异常）', () => {
    expect(() => parseRuleFile('rules.xlsx', Buffer.from('not a spreadsheet'))).toThrow('解析失败');
  });

  it('空表头单元格 / 重复列名 → 可读错误', () => {
    expect(() => parseRuleFile('r.csv', csvBuffer('code,,priority\n'))).toThrow('空列名');
    expect(() => parseRuleFile('r.csv', csvBuffer('code,code\n'))).toThrow('重复列名');
  });

  it('行数超过上限 → 可读错误（有界返回）', () => {
    const lines = ['code,priority'];
    for (let i = 0; i < MAX_RULE_ROWS + 1; i += 1) lines.push(`R${i},1`);
    expect(() => parseRuleFile('r.csv', csvBuffer(lines.join('\n')))).toThrow('超过上限');
  });
});
