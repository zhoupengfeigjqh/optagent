
import * as XLSX from 'xlsx';

import type { ScenarioField, ScenarioFieldType } from './dirs.js';

/** 问题清单上限：超出截断，避免 400 响应体过大（上传文件本身 ≤5MB，行数有界） */
export const MAX_ISSUES = 30;

export function supportsFieldCheck(ext: string): boolean {
  // 大小写不敏感（上游 `routes/files.ts` 已归一小写，此处再兜一层，避免误触发/漏触发）
  const normalized = ext.toLowerCase();
  return normalized === '.csv' || isExcelContainer(normalized);
}

function isExcelContainer(ext: string): boolean {
  return ext === '.xlsx' || ext === '.xls';
}

const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;

function hasOle2Magic(buf: Buffer): boolean {
  return buf.length >= OLE2_MAGIC.length && OLE2_MAGIC.every((byte, i) => buf[i] === byte);
}

const TYPE_LABELS: Record<ScenarioFieldType, string> = {
  string: '文本',
  integer: '整数',
  number: '数字',
  boolean: '布尔（true/false）',
  object: 'JSON 对象',
  array: 'JSON 数组',
};

export function valueMatchesType(raw: string, type: ScenarioFieldType): boolean {
  const value = raw.trim();
  if (value === '') return false;
  switch (type) {
    case 'string':
      return true;
    case 'integer':
      return /^[+-]?\d+$/.test(value);
    case 'number':
      return /^[+-]?(?:\d+\.\d+|\d+|\.\d+)(?:[eE][+-]?\d+)?$/.test(value);
    case 'boolean':
      return value === 'true' || value === 'false';
    case 'object':
    case 'array': {
      try {
        const parsed: unknown = JSON.parse(value);
        return type === 'object'
          ? typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
          : Array.isArray(parsed);
      } catch {
        return false;
      }
    }
  }
}

export interface UploadTable {
  header: string[];
  rows: string[][];
}

export function parseCsvRows(text: string): UploadTable {
  const lines = text.split(/\r\n|\n/);
  const rows = lines.map(parseCsvLine).filter((cells) => cells.some((cell) => cell !== ''));
  if (rows.length === 0) return { header: [], rows: [] };
  return { header: rows[0]!, rows: rows.slice(1) };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function decodeCsvBuffer(buf: Buffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('�')) return utf8.replace(/^\uFEFF/, '');
  return new TextDecoder('gbk').decode(buf).replace(/^\uFEFF/, '');
}

export function parseXlsxRows(buf: Buffer): UploadTable {
  const workbook = XLSX.read(buf, { type: 'buffer' });
  const first = workbook.SheetNames[0];
  const sheet = first ? workbook.Sheets[first] : undefined;
  if (!sheet) return { header: [], rows: [] };
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });
  const rows = matrix
    .map((row) => row.map((cell) => String(cell ?? '').trim()))
    .filter((cells) => cells.some((cell) => cell !== ''));
  if (rows.length === 0) return { header: [], rows: [] };
  return { header: rows[0]!, rows: rows.slice(1) };
}

export function checkUploadTable(fields: readonly ScenarioField[], table: UploadTable): string[] {
  const issues: string[] = [];

  if (table.header.length === 0) {
    return ['文件为空或没有读取到表头'];
  }

  const missing = fields.filter((f) => f.required && !table.header.includes(f.name));
  if (missing.length > 0) {
    issues.push(`缺少必填表头：${missing.map((f) => `「${f.name}」`).join('、')}`);
  }

  for (const field of fields) {
    const col = table.header.indexOf(field.name);
    if (col === -1) continue;
    table.rows.forEach((row, i) => {
      const cell = (row[col] ?? '').trim();
      if (cell === '') return;
      if (!valueMatchesType(cell, field.type)) {
        const shown = cell.length > 32 ? `${cell.slice(0, 32)}…` : cell;
        issues.push(
          `第 ${i + 2} 行「${field.name}」取值 "${shown}" 类型不符（期望${TYPE_LABELS[field.type]}）`,
        );
      }
    });
  }

  if (issues.length > MAX_ISSUES) {
    const total = issues.length;
    return [...issues.slice(0, MAX_ISSUES), `…等 ${total} 处问题，请修正后重新上传`];
  }
  return issues;
}

export function checkUploadBuffer(
  fields: readonly ScenarioField[],
  ext: string,
  buf: Buffer,
): string[] {
  const normalized = ext.toLowerCase();
  if (normalized === '.xlsx' && (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50)) {
    return ['文件内容无法解析为有效表格（文件损坏或编码异常）'];
  }
  if (normalized === '.xls' && !hasOle2Magic(buf)) {
    return ['文件内容无法解析为有效表格（文件损坏或编码异常）'];
  }
  let table: UploadTable;
  try {
    table = isExcelContainer(normalized) ? parseXlsxRows(buf) : parseCsvRows(decodeCsvBuffer(buf));
  } catch {
    return ['文件内容无法解析为有效表格（文件损坏或编码异常）'];
  }
  return checkUploadTable(fields, table);
}
