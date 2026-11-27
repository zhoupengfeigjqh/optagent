import * as XLSX from 'xlsx';

/** xlsx 规范硬上限 */
const MAX_ROWS = 1_048_576;
const MAX_COLS = 16_384;
/** 单次生成的总单元格上限（内存与耗时护栏，远低于规范上限） */
const MAX_CELLS = 200_000;
const MAX_SHEET_NAME = 31;

const SHEET_MARKER = /^\s*#\s*sheet\s*[:：]\s*(.+?)\s*$/i;

export interface TableSheet {
  name: string;
  rows: string[][];
}

interface ParsedCell {
  value: string;
  quoted: boolean;
}

export type TableParseResult =
  | { ok: true; sheets: TableSheet[] }
  | { ok: false; error: string };

/**
 * RFC4180 最小实现：支持引号包裹、`""` 转义、引号内的换行与逗号。
 *
 * 不做的事：不去猜分隔符（只认 `,`）、不推断类型（一律字符串）。
 * 引号未闭合是**结构性损坏**，必须报错而不是猜一个结果。
 */
function parseCsv(body: string): { ok: true; rows: ParsedCell[][] } | { ok: false; error: string } {
  const rows: ParsedCell[][] = [];
  let row: ParsedCell[] = [];
  let cell = '';
  let quoted = false;
  let inQuotes = false;

  const pushCell = (): void => {
    row.push({ value: quoted ? cell : cell.trim(), quoted });
    cell = '';
    quoted = false;
  };
  const pushRow = (): void => {
    pushCell();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === '') {
      cell = '';
      inQuotes = true;
      quoted = true;
      continue;
    }
    if (ch === ',') {
      pushCell();
      continue;
    }
    if (ch === '\r') continue;
    if (ch === '\n') {
      pushRow();
      continue;
    }
    cell += ch;
  }
  if (inQuotes) {
    return { ok: false, error: 'CSV 引号未闭合：某个字段以 " 开头但没有配对的收尾引号。' };
  }
  // 末行：有内容或有占位单元格才收（避免末尾换行多出一行空行）
  if (cell !== '' || quoted || row.length > 0) pushRow();

  return { ok: true, rows };
}

function normalizeRows(rows: ParsedCell[][]): string[][] {
  const kept = rows
    .map((cells) => cells.map((c) => c.value))
    .filter((cells) => cells.some((value) => value !== ''));
  const width = kept.reduce((max, cells) => Math.max(max, cells.length), 0);
  return kept.map((cells) =>
    cells.length === width ? cells : [...cells, ...Array<string>(width - cells.length).fill('')],
  );
}

function splitSections(content: string): Array<{ name: string | undefined; body: string[] }> {
  const sections: Array<{ name: string | undefined; body: string[] }> = [];
  let current: { name: string | undefined; body: string[] } = { name: undefined, body: [] };
  for (const line of content.split(/\r?\n/)) {
    const marker = SHEET_MARKER.exec(line);
    if (marker) {
      sections.push(current);
      current = { name: marker[1], body: [] };
      continue;
    }
    current.body.push(line);
  }
  sections.push(current);
  return sections;
}

function sanitizeSheetName(raw: string | undefined, index: number, used: Set<string>): string {
  const cleaned = (raw ?? '')
    // eslint-disable-next-line no-control-regex -- Excel 表名不允许控制字符
    .replace(/[\\[\]*?:/\u0000-\u001F]/g, '_')
    .trim();
  const base = (cleaned === '' ? `Sheet${index + 1}` : cleaned).slice(0, MAX_SHEET_NAME);
  let name = base;
  let suffix = 2;
  while (used.has(name)) {
    const tail = `(${suffix})`;
    name = `${base.slice(0, MAX_SHEET_NAME - tail.length)}${tail}`;
    suffix += 1;
  }
  used.add(name);
  return name;
}

/**
 * 解析并校验表格源。校验与编码共用它——**同一份判据**，避免"能过校验却编不出来"。
 */
export function parseTableSource(content: string): TableParseResult {
  if (content.replace(/^\uFEFF/, '').trim() === '') {
    return {
      ok: false,
      error: '内容为空：.xlsx 需要 CSV 行数据，可用 "# Sheet: 名称" 行分隔多个工作表。',
    };
  }

  const used = new Set<string>();
  const sheets: TableSheet[] = [];
  let totalCells = 0;

  for (const [index, section] of splitSections(content.replace(/^\uFEFF/, '')).entries()) {
    const parsed = parseCsv(section.body.join('\n'));
    if (!parsed.ok) return { ok: false, error: parsed.error };

    const rows = normalizeRows(parsed.rows);
    if (rows.length === 0) continue;
    if (rows.length > MAX_ROWS) {
      return {
        ok: false,
        error: `工作表「${section.name ?? index + 1}」有 ${rows.length} 行，超过 xlsx 上限 ${MAX_ROWS}。`,
      };
    }
    const cols = rows[0]?.length ?? 0;
    if (cols > MAX_COLS) {
      return {
        ok: false,
        error: `工作表「${section.name ?? index + 1}」有 ${cols} 列，超过 xlsx 上限 ${MAX_COLS}。`,
      };
    }
    totalCells += rows.length * cols;
    if (totalCells > MAX_CELLS) {
      return {
        ok: false,
        error: `表格过大（约 ${totalCells} 个单元格），超过单次生成上限 ${MAX_CELLS}；请拆分后分多次写入。`,
      };
    }
    sheets.push({ name: sanitizeSheetName(section.name, index, used), rows });
  }

  if (sheets.length === 0) {
    return { ok: false, error: '没有可识别的表格行：请给出至少一行逗号分隔的数据。' };
  }
  return { ok: true, sheets };
}

function columnWidths(rows: string[][]): XLSX.ColInfo[] {
  const cols = rows[0]?.length ?? 0;
  const widths = Array.from({ length: cols }, (_, ci) => {
    const longest = rows.reduce((max, cells) => {
      const text = cells[ci] ?? '';
      const visual = [...text].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0);
      return Math.max(max, visual);
    }, 0);
    return { wch: Math.min(40, Math.max(8, longest)) };
  });
  return widths;
}

export function encodeXlsx(content: string): Buffer {
  const parsed = parseTableSource(content);
  if (!parsed.ok) throw new Error(parsed.error);

  const wb = XLSX.utils.book_new();
  for (const sheet of parsed.sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    // 兜底：任何非字符串单元格强制回字符串，并清掉公式字段（防 `=cmd|...` 被当公式）
    for (const addr of Object.keys(ws)) {
      if (addr.startsWith('!')) continue;
      const cell = (ws as unknown as Record<string, XLSX.CellObject | undefined>)[addr];
      if (!cell) continue;
      if (cell.t !== 's') {
        cell.t = 's';
        cell.v = String(cell.v ?? '');
      }
      delete cell.f;
    }
    ws['!cols'] = columnWidths(sheet.rows);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;
}
