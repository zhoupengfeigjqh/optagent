/**
 * 上传表字段校验（`data_prep_fields` 的消费端，契约 `runtime-api-delta.md` §3.1）。
 *
 * 职责：
 * - 按 §3.1 判据对**单元格文本**做取值类型判定（6 种 JSON Schema 基本类型子集）；
 * - 把上传表（`.csv` 文本 / `.xlsx` 第一个 sheet）解析为「表头 + 数据行」；
 * - 校验：required 字段的表头 MUST 存在；出现的字段取值类型**逐行**匹配；空单元格跳过。
 *
 * 调用方：文件上传路由（仅"数据准备空间且该目录有字段约束"时，`routes/files.ts`）。
 * 运行环境是**唯一权威**：前端不做同款校验（避免双实现漂移，契约 §3.1 已登记该决定）。
 *
 * 失败以**逐条中文清单**返回（上限 `MAX_ISSUES` 条，超出截断为"…等 N 处"）。
 * xlsx 解析复用既有依赖 `xlsx`（`domain/tools/read-file.ts` 同款用法）。
 */

import * as XLSX from 'xlsx';

import type { ScenarioField, ScenarioFieldType } from './dirs.js';

/** 问题清单上限：超出截断，避免 400 响应体过大（上传文件本身 ≤5MB，行数有界） */
export const MAX_ISSUES = 30;

/** 取值类型的用户可读标签（问题清单用） */
const TYPE_LABELS: Record<ScenarioFieldType, string> = {
  string: '文本',
  integer: '整数',
  number: '数字',
  boolean: '布尔（true/false）',
  object: 'JSON 对象',
  array: 'JSON 数组',
};

/** 单元格文本是否满足声明的取值类型。空串**不匹配任何类型**（调用方负责跳过空单元格） */
export function valueMatchesType(raw: string, type: ScenarioFieldType): boolean {
  const value = raw.trim();
  if (value === '') return false;
  switch (type) {
    case 'string':
      return true;
    case 'integer':
      // 整数字面量：可带正负号，不含小数点与指数
      return /^[+-]?\d+$/.test(value);
    case 'number':
      // 数字字面量：允许小数与指数；小数点两侧至少一侧有数字
      return /^[+-]?(?:\d+\.\d+|\d+|\.\d+)(?:[eE][+-]?\d+)?$/.test(value);
    case 'boolean':
      // 仅认 JSON 字面量 true/false（不接受 TRUE / 1 / 是）
      return value === 'true' || value === 'false';
    case 'object':
    case 'array': {
      // 粗校验：可 JSON.parse 且顶层类型匹配（不做嵌套校验，契约 §3.1）
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

/** 解析后的上传表：第一行为表头，其余为数据行（单元格均已 trim） */
export interface UploadTable {
  header: string[];
  rows: string[][];
}

/**
 * CSV 文本 → 表结构。
 *
 * 支持逗号分隔、`"` 引用（`""` 转义）、`\r\n` / `\n`；单元格统一 trim；
 * 表头＝首个**非全空行**（容忍文件开头的空行）；全空行（含文件末尾换行
 * 产生的空行）一律丢弃——`checkUploadTable` 的行号按剩余数据行顺序计。
 */
export function parseCsvRows(text: string): UploadTable {
  const lines = text.split(/\r\n|\n/);
  // 引号内的换行不做支持（§3.1 登记的口径：逗号分隔的简单表格）
  const rows = lines
    .map(parseCsvLine)
    .filter((cells) => cells.some((cell) => cell !== ''));
  if (rows.length === 0) return { header: [], rows: [] };
  return { header: rows[0]!, rows: rows.slice(1) };
}

/** 单行 CSV：按逗号切分，处理 `"..."` 引用与 `""` 转义 */
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

/**
 * CSV 字节 → 文本：UTF-8（去 BOM）优先；出现替换字符（U+FFFD，非法 UTF-8 序列）时
 * 回退 GBK（中文 Excel 导出的常见编码）。`TextDecoder('gbk')` 由 Node 全量 ICU 提供。
 */
export function decodeCsvBuffer(buf: Buffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('�')) return utf8.replace(/^\uFEFF/, '');
  return new TextDecoder('gbk').decode(buf).replace(/^\uFEFF/, '');
}

/** xlsx 字节 → 表结构：仅**第一个 sheet**（契约 §3.1 口径）；单元格取**显示文本**（`raw: false`，日期等按格式串判定） */
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
  // 全空行丢弃，与 `parseCsvRows` 同一口径（行号按剩余数据行顺序计）
  const rows = matrix
    .map((row) => row.map((cell) => String(cell ?? '').trim()))
    .filter((cells) => cells.some((cell) => cell !== ''));
  if (rows.length === 0) return { header: [], rows: [] };
  return { header: rows[0]!, rows: rows.slice(1) };
}

/**
 * 校验上传表，返回逐条问题清单（空数组＝通过）。
 *
 * - 表头 MUST 含全部 required 字段（一次性列出所有缺失）；
 * - 出现的字段（含可选）：逐数据行判定取值类型；空单元格跳过（required 语义是
 *   "表头必含"，不做行级必填，契约 §3.1）；
 * - 数据行号按"表头为第 1 行"计（第 1 条数据是第 2 行）；
 * - 重复表头取首个匹配列。
 */
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
    if (col === -1) continue; // 可选字段未出现 → 无约束
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

/**
 * 上传校验入口：按扩展名分派解析，返回问题清单。
 *
 * 解析失败（损坏的 csv/xlsx）视为一条问题返回，由路由统一以
 * `FILE_SCHEMA_INVALID` 拒绝——不区分"损坏"与"不符合约束"对用户更可读。
 */
export function checkUploadBuffer(
  fields: readonly ScenarioField[],
  ext: string,
  buf: Buffer,
): string[] {
  // xlsx 前置 ZIP 魔数校验：SheetJS 对非 zip 输入异常宽容（不抛错、产出脏表），
  // 损坏文件在这里确定性拦截（与 admin-backend `skills.ts` 的 ZIP_MAGIC 同一口径）
  if (ext === '.xlsx' && (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50)) {
    return ['文件内容无法解析为有效表格（文件损坏或编码异常）'];
  }
  let table: UploadTable;
  try {
    table = ext === '.xlsx' ? parseXlsxRows(buf) : parseCsvRows(decodeCsvBuffer(buf));
  } catch {
    return ['文件内容无法解析为有效表格（文件损坏或编码异常）'];
  }
  return checkUploadTable(fields, table);
}
