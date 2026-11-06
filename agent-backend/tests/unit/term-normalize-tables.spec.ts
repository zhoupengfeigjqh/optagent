/**
 * 单元测试：术语表读取与合并（018，`domain/term-normalize/tables.ts`）。
 *
 * 守三条口径：
 * ① 跨本体同名 key 的 value 用 `或` 合并且**去重**（`A或B` + `B或C` = `A或B或C`）；
 * ② 目录名排序后再读，同一份产物每次得到同一张表；
 * ③ 缺文件不算降级，坏 JSON 才记 warning，且不影响其余本体。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  TERM_MAPPING_FILE,
  loadTermTable,
  mergeTermTables,
  mergeTermValues,
} from '../../src/domain/term-normalize/tables.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-terms-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeTable(scenario: string, ontology: string, content: string): void {
  const dir = path.join(root, 'ontology', scenario, ontology);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, TERM_MAPPING_FILE), content, 'utf8');
}

describe('mergeTermValues / mergeTermTables', () => {
  it('合并时去重并保持首次出现顺序', () => {
    expect(mergeTermValues('供应商或供应商编号', '供应方或供应商')).toBe(
      '供应商或供应商编号或供应方',
    );
  });

  it('多表合并：同名 key 汇总，异名 key 各自保留', () => {
    expect(
      mergeTermTables([
        { 供应商信息: '供应方' },
        { 供应商信息: '供应商或供应商编号', 物料: '原材料' },
      ]),
    ).toEqual({ 供应商信息: '供应方或供应商或供应商编号', 物料: '原材料' });
  });

  it('空 term / 空 value 的不进入合并结果', () => {
    expect(mergeTermTables([{ '': '原材料', 物料: '' }])).toEqual({});
  });
});

describe('loadTermTable', () => {
  it('读全部本体并合并；目录名排序保证确定性', () => {
    writeTable('生产调度', '原材料采购和库存', JSON.stringify({ 供应商信息: '供应商' }));
    writeTable('生产调度', '供应商档案', JSON.stringify({ 供应商信息: '供应方', 物料: '原材料' }));

    const result = loadTermTable(root);

    expect(result.files).toBe(2);
    expect(result.warnings).toEqual([]);
    // 供 < 原（码点序）：稳定的合并顺序，重跑不会漂移
    expect(result.table).toEqual({
      供应商信息: '供应方或供应商',
      物料: '原材料',
    });
  });

  it('缺 term_mapping.json 的本体跳过，不算降级', () => {
    writeTable('生产调度', '原材料采购和库存', JSON.stringify({ 物料: '原材料' }));
    fs.mkdirSync(path.join(root, 'ontology', '生产调度', '无字典本体'), { recursive: true });

    const result = loadTermTable(root);

    expect(result.files).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  it('坏 JSON 跳过并记 warning，其余本体照常可用', () => {
    writeTable('生产调度', 'a_broken', '{ not json');
    writeTable('生产调度', 'b_ok', JSON.stringify({ 物料: '原材料' }));

    const result = loadTermTable(root);

    expect(result.files).toBe(1);
    expect(result.table).toEqual({ 物料: '原材料' });
    expect(result.warnings[0]).toContain('不是合法 JSON');
  });

  it('内容不是对象（数组 / 标量）→ 跳过并告警', () => {
    writeTable('生产调度', 'a_array', '["物料"]');

    const result = loadTermTable(root);

    expect(result.files).toBe(0);
    expect(result.table).toEqual({});
    expect(result.warnings[0]).toContain('不是对象');
  });

  it('没有 ontology 目录 → 空表（不影响发送）', () => {
    expect(loadTermTable(root)).toEqual({ table: {}, warnings: [], files: 0 });
  });
});
