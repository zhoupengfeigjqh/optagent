import path from 'node:path';

import * as XLSX from 'xlsx';

import { PREDEFINED_DATA_PREP_DIRS } from './dirs.js';

export const RULES_SUBDIR = PREDEFINED_DATA_PREP_DIRS[0];

/** 单文件规则行数上限（有界返回；超出即拒，防止一张巨型表格拖垮确认弹窗） */
export const MAX_RULE_ROWS = 1000;

export interface ParsedRuleFile {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  priority_column: string | null;
}

const PRIORITY_HEADER = /priority|优先级/i;

export function parseRuleFile(filename: string, buf: Buffer): ParsedRuleFile {
  const ext = path.extname(filename).toLowerCase();
  if (ext !== '.xlsx' && ext !== '.xls' && ext !== '.csv') {
    throw new Error(
      `不支持的规则文件格式「${ext === '' ? '无扩展名' : ext}」，仅支持 .xlsx / .xls / .csv`,
    );
  }

  let workbook: XLSX.WorkBook;
  try {
    if (ext === '.csv') {
      workbook = XLSX.read(buf.toString('utf8'), { type: 'string' });
    } else {
      const okZip = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b;
      const okOle2 =
        buf.length >= 8 && buf.readUInt32LE(0) === 0xe011cfd0 && buf.readUInt32LE(4) === 0xe11ab1a1;
      if (ext === '.xls' ? !okOle2 : !okZip) {
        throw new Error('bad magic');
      }
      workbook = XLSX.read(buf, { type: 'buffer' });
    }
  } catch {
    throw new Error('规则文件解析失败：内容损坏或不是有效的表格文件');
  }
  const firstSheetName = workbook.SheetNames[0];
  if (firstSheetName === undefined) throw new Error('规则文件中没有工作表');
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) throw new Error('规则文件中没有工作表');

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: true,
  });
  if (matrix.length === 0) throw new Error('规则文件为空：缺少表头行');

  const headerRow = [...(matrix[0] ?? [])];
  while (
    headerRow.length > 0 &&
    (headerRow[headerRow.length - 1] === null ||
      headerRow[headerRow.length - 1] === undefined ||
      String(headerRow[headerRow.length - 1]).trim() === '')
  ) {
    headerRow.pop();
  }
  const columns = headerRow.map((cell) =>
    cell === null || cell === undefined ? '' : String(cell).trim(),
  );
  if (columns.length === 0 || columns.some((c) => c === '')) {
    throw new Error('规则文件表头非法：存在空列名');
  }
  if (new Set(columns).size !== columns.length) {
    throw new Error('规则文件表头非法：存在重复列名');
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const rawRow of matrix.slice(1)) {
    const record: Record<string, unknown> = {};
    let hasValue = false;
    columns.forEach((column, index) => {
      const value = rawRow?.[index] ?? null;
      record[column] = value;
      if (value !== null && value !== '') hasValue = true;
    });
    if (!hasValue) continue;
    rows.push(record);
    if (rows.length > MAX_RULE_ROWS) {
      throw new Error(`规则行数超过上限（${MAX_RULE_ROWS} 行）：请拆分规则文件`);
    }
  }

  return {
    columns,
    rows,
    priority_column: columns.find((c) => PRIORITY_HEADER.test(c)) ?? null,
  };
}
