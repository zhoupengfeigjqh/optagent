import * as XLSX from 'xlsx';

export const SHEET_MAX_ROWS = 1000;

export const SHEET_MAX_COLS = 100;

const NUMERIC_COL_RATIO = 0.6;

export interface PreviewMerge {
  r: number;
  c: number;
  rowSpan: number;
  colSpan: number;
}

export interface PreviewSheet {
  name: string;
  rows: string[][];
  numericCols: number[];
  merges: PreviewMerge[];
  truncated: boolean;
}

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
  return /[ymdhs]/i.test(cell.z);
}

function displayText(cell: XLSX.CellObject): string {
  try {
    return XLSX.utils.format_cell(cell);
  } catch {
    return cell.v === undefined || cell.v === null ? '' : String(cell.v);
  }
}

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

export function xlsxToSheets(buf: Buffer): PreviewWorkbook {
  const wb = XLSX.read(buf, { type: 'buffer', cellNF: true });
  const sheets: PreviewSheet[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    sheets.push(sheetToPreview(name, ws));
  }
  return { sheets };
}
