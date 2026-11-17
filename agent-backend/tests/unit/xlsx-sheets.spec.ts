/**
 * 单测：`.xlsx` → 结构化预览数据（`domain/preview/xlsx-sheets.ts`，2026-11-17）。
 *
 * 守的是**前端能直接画表**这件事的四条底线：
 * 1. 多 sheet 的名称与顺序不丢（Tab 列表的来源）；
 * 2. 单元格给的是**显示文本**（千分位 / 日期格式按原簿），不是序列号；
 * 3. `numericCols` 判得准（数字列右对齐），日期列不能被误判；
 * 4. 超过上限时截断且 `truncated` 置真（不把整张十万行表塞给浏览器）。
 */
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
  SHEET_MAX_COLS,
  SHEET_MAX_ROWS,
  xlsxToSheets,
} from '../../src/domain/preview/xlsx-sheets';

/** 按 `{ sheet 名: 二维数组 }` 造一份真 xlsx 字节（解析路径与线上一致）。 */
function build(
  matrixBySheet: Record<string, unknown[][]>,
  decorate?: (wb: XLSX.WorkBook) => void,
): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, matrix] of Object.entries(matrixBySheet)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrix), name);
  }
  decorate?.(wb);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('xlsxToSheets —— 工作簿结构', () => {
  it('多 sheet 按原顺序返回，名称原样（Tab 列表直接用它）', () => {
    const buf = build({
      订单明细: [['订单号'], ['SO-1']],
      库存: [['物料'], ['冷轧板']],
      汇总: [['区域'], ['华东']],
    });

    const workbook = xlsxToSheets(buf);

    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(['订单明细', '库存', '汇总']);
  });

  it('单元格是**显示文本**：数字不带类型，前端只负责摆放', () => {
    const buf = build({ 表: [['物料', '数量'], ['冷轧板', 120]] });

    const sheet = xlsxToSheets(buf).sheets[0]!;

    expect(sheet.rows).toEqual([
      ['物料', '数量'],
      ['冷轧板', '120'],
    ]);
  });

  it('空缺单元格补空串（前端少一次判空）', () => {
    const buf = build({ 表: [['a', 'b', 'c'], ['1', null, '3']] });

    expect(xlsxToSheets(buf).sheets[0]?.rows[1]).toEqual(['1', '', '3']);
  });

  it('数字按原簿格式渲染（千分位 / 小数位保留，不是裸 number）', () => {
    const buf = build({ 表: [['金额'], [144000]] }, (wb) => {
      const cell = wb.Sheets['表']!['A2']!;
      cell.z = '#,##0.00';
      // 清掉 aoa_to_sheet 预置的 w，让写读往返按 z 重算（与真实 Excel 文件同路径）
      cell.w = undefined as unknown as string;
    });

    expect(xlsxToSheets(buf).sheets[0]?.rows[1]?.[0]).toBe('144,000.00');
  });
});

describe('xlsxToSheets —— numericCols（数字列右对齐的判据）', () => {
  it('整列为数字 → 进 numericCols；文本列不进', () => {
    const buf = build({
      表: [
        ['物料', '数量'],
        ['冷轧板', 120],
        ['热轧板', 80],
      ],
    });

    expect(xlsxToSheets(buf).sheets[0]?.numericCols).toEqual([1]);
  });

  it('表头是文本、数据是数字时仍判为数字列（阈值不是 100%）', () => {
    const buf = build({
      表: [
        ['物料', '数量', '备注'],
        ['A', 120, ''],
        ['B', 80, ''],
        ['C', 60, '急'],
      ],
    });

    // 数量列 3/3 数字；备注列 1/2 非空是文本 → 不是数字列
    expect(xlsxToSheets(buf).sheets[0]?.numericCols).toEqual([1]);
  });

  it('日期列**不**判为数字（否则日期会被右对齐成数字样式）', () => {
    const buf = build({
      表: [
        ['日期', '数量'],
        [new Date(Date.UTC(2026, 10, 1)), 10],
        [new Date(Date.UTC(2026, 10, 2)), 20],
      ],
    });

    const sheet = xlsxToSheets(buf).sheets[0]!;

    expect(sheet.numericCols).toEqual([1]);
    // 日期是格式化文本，不是 46319 这类序列号
    expect(Number.isNaN(Number(sheet.rows[1]?.[0]))).toBe(true);
    expect(sheet.rows[1]?.[0]).not.toBe('');
  });
});

describe('xlsxToSheets —— 合并单元格', () => {
  it('返回起点 + 跨度（前端直接绑 rowspan / colspan）', () => {
    const buf = build({ 表: [['区域', '客户'], ['华东', 'A'], ['', 'B']] }, (wb) => {
      const ws = wb.Sheets['表']!;
      ws['!merges'] = [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }];
    });

    expect(xlsxToSheets(buf).sheets[0]?.merges).toEqual([
      { r: 1, c: 0, rowSpan: 2, colSpan: 1 },
    ]);
  });
});

describe('xlsxToSheets —— 上限', () => {
  it('超过行上限 → 截断到 SHEET_MAX_ROWS 并置 truncated', () => {
    const matrix = Array.from({ length: SHEET_MAX_ROWS + 5 }, (_, r) => [r]);
    const sheet = xlsxToSheets(build({ 表: matrix })).sheets[0]!;

    expect(sheet.rows).toHaveLength(SHEET_MAX_ROWS);
    expect(sheet.truncated).toBe(true);
  });

  it('超过列上限 → 截断到 SHEET_MAX_COLS 并置 truncated', () => {
    const matrix = [Array.from({ length: SHEET_MAX_COLS + 5 }, (_, c) => c)];
    const sheet = xlsxToSheets(build({ 表: matrix })).sheets[0]!;

    expect(sheet.rows[0]).toHaveLength(SHEET_MAX_COLS);
    expect(sheet.truncated).toBe(true);
  });

  it('未超限 → truncated 为假（前端不显示"仅显示前 N 行"）', () => {
    const buf = build({ 表: [['物料', '数量'], ['A', 1]] });

    expect(xlsxToSheets(buf).sheets[0]?.truncated).toBe(false);
  });
});
