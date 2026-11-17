/**
 * Excel → 结构化逐 sheet 数据（2026-11-17，`.xlsx` 预览表格化）。
 *
 * 与 `xlsx-text.ts` 的分工：
 * - `xlsxToText`：给 `read_file` 工具（以及需要"一段文本"的地方）——每个 sheet 前加
 *   `### Sheet: 名称` 的 CSV 文本，是模型侧口径；
 * - `xlsxToSheets`（本文件）：给 `GET /api/files/preview` 的**前端渲染**口径——把工作簿
 *   拆成 `{ name, rows, numericCols, merges }`，前端拿到就能画表，不需要 CSV 解析器。
 *
 * 两个刻意的取舍（2026-11-17，档 A）：
 * 1. **单元格值是"显示文本"**（`XLSX.utils.format_cell`），不是原始值。千分位、小数位、
 *    百分比、日期格式都按原簿的 `z` 呈现——"看得清"优先于"拿得到原始数"。数字列的对齐
 *    信息另外用 `numericCols` 给出，不让前端靠正则猜（订单号这类纯数字文本不该右对齐）。
 * 2. **有上限**：`SHEET_MAX_ROWS` / `SHEET_MAX_COLS` 之外的单元格不返回，`truncated` 置真。
 *    原生表格没有虚拟滚动，一个 10 万行的 sheet 直接进 DOM 会卡死面板（宪章原则五）。
 *
 * 超限是**呈现层截断**，原始文件不受影响——用户要完整内容时走下载。
 */
import * as XLSX from 'xlsx';

/** 单个 sheet 的最大返回行数（超出截断，`truncated` 置真）。 */
export const SHEET_MAX_ROWS = 1000;

/** 单个 sheet 的最大返回列数。 */
export const SHEET_MAX_COLS = 100;

/**
 * 判定"数字列"的比例阈值：非空单元格里数字占比达到这个值，整列右对齐。
 *
 * 取 0.6 而不是"全部"：真实表格常有零星空值/备注格，严格要求 100% 会让绝大多数
 * 数字列都判不出来。**表头行（第 0 行）不参与统计**——它天然是文本，算进分母会把
 * "一行表头 + 一两行数据"的小表压到阈值以下（2026-11-17 实测踩到）。
 */
const NUMERIC_COL_RATIO = 0.6;

/** 合并单元格（左上角起点 + 跨度，前端直接映射到 `rowspan` / `colspan`）。 */
export interface PreviewMerge {
  /** 起点的行下标（0 基，已相对返回的 `rows`） */
  r: number;
  /** 起点的列下标（0 基） */
  c: number;
  rowSpan: number;
  colSpan: number;
}

/** 一个工作表的预览数据。 */
export interface PreviewSheet {
  /** 工作表名（Tab 标签） */
  name: string;
  /** 行 × 列的显示文本；空缺单元格为 `''`（不返回 `null`，前端少一次判空） */
  rows: string[][];
  /** 需要右对齐的列下标（数字列，判据见 `NUMERIC_COL_RATIO`） */
  numericCols: number[];
  /** 合并单元格；跨越截断边界的按可见范围裁短 */
  merges: PreviewMerge[];
  /** 是否因超过 `SHEET_MAX_ROWS` / `SHEET_MAX_COLS` 被截断 */
  truncated: boolean;
}

/** 工作簿预览数据（`GET /api/files/preview` 对 `.xlsx` 的响应体）。 */
export interface PreviewWorkbook {
  sheets: PreviewSheet[];
}

/**
 * 日期单元格判定：`t==='d'`，或数字单元格带日期格式。
 *
 * 依赖 `cell.z` 存在——读取时必须带 `cellNF: true`，否则 SheetJS 只保留格式化文本
 * `w`（如 `11/1/26`）而不保留格式串，日期就会被当成普通数字右对齐（见 `xlsxToSheets`）。
 */
function isDateCell(cell: XLSX.CellObject): boolean {
  if (cell.t === 'd') {
    return true;
  }
  if (cell.t !== 'n' || typeof cell.z !== 'string' || cell.z.length === 0) {
    return false;
  }
  // 日期/时间格式必含 ymdhs 之一；数字格式（0.00 / #,##0 / 0%）与 General 都不含
  return /[ymdhs]/i.test(cell.z);
}

/** 单元格显示文本；`format_cell` 在异常格式上会抛，退回原始值。 */
function displayText(cell: XLSX.CellObject): string {
  try {
    return XLSX.utils.format_cell(cell);
  } catch {
    return cell.v === undefined || cell.v === null ? '' : String(cell.v);
  }
}

/** 单个工作表 → 预览数据（纯函数，便于单测）。 */
function sheetToPreview(name: string, ws: XLSX.WorkSheet): PreviewSheet {
  const ref = ws['!ref'];
  if (!ref) {
    return { name, rows: [], numericCols: [], merges: [], truncated: false };
  }

  const range = XLSX.utils.decode_range(ref);
  const totalRows = range.e.r - range.s.r + 1;
  const totalCols = range.e.c - range.s.c + 1;
  const rowCount = Math.min(totalRows, SHEET_MAX_ROWS);
  const colCount = Math.min(totalCols, SHEET_MAX_COLS);

  const rows: string[][] = [];
  const numericCount = new Array<number>(colCount).fill(0);
  const filledCount = new Array<number>(colCount).fill(0);

  for (let r = 0; r < rowCount; r += 1) {
    const line: string[] = [];
    for (let c = 0; c < colCount; c += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r: range.s.r + r, c: range.s.c + c })] as
        | XLSX.CellObject
        | undefined;
      if (!cell || cell.v === undefined || cell.v === null) {
        line.push('');
        continue;
      }
      line.push(displayText(cell));
      // 表头行（r=0）不参与数字列统计：它天然是文本，算进分母会压低下方的数字列
      if (r > 0) {
        filledCount[c] = (filledCount[c] ?? 0) + 1;
        if (cell.t === 'n' && !isDateCell(cell)) {
          numericCount[c] = (numericCount[c] ?? 0) + 1;
        }
      }
    }
    rows.push(line);
  }

  const numericCols: number[] = [];
  for (let c = 0; c < colCount; c += 1) {
    const filled = filledCount[c] ?? 0;
    const numeric = numericCount[c] ?? 0;
    if (filled > 0 && numeric / filled >= NUMERIC_COL_RATIO) {
      numericCols.push(c);
    }
  }

  const merges: PreviewMerge[] = [];
  for (const merge of ws['!merges'] ?? []) {
    const r = merge.s.r - range.s.r;
    const c = merge.s.c - range.s.c;
    // 起点落在可见范围外就整块丢弃；跨边界时把跨度裁到可见范围内
    if (r < 0 || c < 0 || r >= rowCount || c >= colCount) {
      continue;
    }
    merges.push({
      r,
      c,
      rowSpan: Math.min(merge.e.r - merge.s.r + 1, rowCount - r),
      colSpan: Math.min(merge.e.c - merge.s.c + 1, colCount - c),
    });
  }

  return {
    name,
    rows,
    numericCols,
    merges,
    truncated: totalRows > rowCount || totalCols > colCount,
  };
}

/**
 * 解析工作簿。
 *
 * 解析失败（损坏文件、加密文件）直接抛出，由路由映射成 `400 VALIDATION_FAILED`；
 * 没有任何工作表的文件返回空 `sheets`（由前端提示，不当异常）。
 */
export function xlsxToSheets(buf: Buffer): PreviewWorkbook {
  // `cellNF: true` 必开：不保留 `cell.z` 就无法区分「日期数字」与「普通数字」，
  // 日期列会被右对齐成 46327 这样的序列号（2026-11-17 实测）
  const wb = XLSX.read(buf, { type: 'buffer', cellNF: true });
  const sheets: PreviewSheet[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    sheets.push(sheetToPreview(name, ws));
  }
  return { sheets };
}
