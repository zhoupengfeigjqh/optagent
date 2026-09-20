/**
 * 算法规则文件解析（HITL「从算法规则选择」的数据源）。
 *
 * 规则文件由用户上传到「数据准备/算法规则」，**首行是表头，其余每行是一条规则**；
 * 选择器把勾选行原样转成 `array[object]` 填入工具参数（键 = 表头列名，值 = 该行值）。
 * 本模块按扩展名分派解析（`.xlsx` / `.csv` 都走 `xlsx` 库），运行环境侧解析、
 * 前端只渲染——不在用户侧引入表格解析依赖。
 *
 * 目录名与 `admin-backend` `PREDEFINED_DATA_PREP_DIRS` 保持同步（平台预定义目录）。
 */
import path from 'node:path';

import * as XLSX from 'xlsx';

/** 「数据准备」下的预定义规则子目录（平台预定义，与 admin-backend 常量同步） */
export const RULES_SUBDIR = '算法规则';

/** 单文件规则行数上限（有界返回；超出即拒，防止一张巨型表格拖垮确认弹窗） */
export const MAX_RULE_ROWS = 1000;

export interface ParsedRuleFile {
  /** 表头列名（保持文件内顺序） */
  columns: string[];
  /** 数据行：键 = 表头列名，值 = 该行该列的值（JSON 可序列化的标量） */
  rows: Array<Record<string, unknown>>;
  /** 优先级列名（表头里匹配 `priority`/`优先级` 的那一列；无则 null） */
  priority_column: string | null;
}

/** 优先级列表头判定（大小写不敏感的子串匹配） */
const PRIORITY_HEADER = /priority|优先级/i;

/**
 * 解析规则文件缓冲区。解析/格式问题一律抛 `Error`（中文可读消息），
 * 由路由层映射为 4xx——规则文件是用户上传的内容，损坏时应当给出可读结论
 * 而不是 500。
 */
export function parseRuleFile(filename: string, buf: Buffer): ParsedRuleFile {
  const ext = path.extname(filename).toLowerCase();
  if (ext !== '.xlsx' && ext !== '.csv') {
    throw new Error(`不支持的规则文件格式「${ext === '' ? '无扩展名' : ext}」，仅支持 .xlsx / .csv`);
  }

  let workbook: XLSX.WorkBook;
  try {
    if (ext === '.csv') {
      // CSV 按 UTF-8 显式解码：xlsx 库对二进制缓冲里的 CSV 默认按 1252 代码页，
      // 中文表头会乱码
      workbook = XLSX.read(buf.toString('utf8'), { type: 'string' });
    } else {
      // .xlsx（zip 容器）先验魔数：纯文本会被 xlsx 库宽容地按 CSV 解析，不验则
      // "改后缀名的文本文件"能蒙混过关
      if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
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
  // sheetjs 会以数据区最大列数撑宽表格：尾部空行里的 `,,` 会多撑出一列拖尾 null，
  // 不是真表头——先剔除拖尾空列（中间的空列名仍视为非法表头）
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
    // 整行为空的行不产出规则（表格尾部的空行/空行分隔）
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
