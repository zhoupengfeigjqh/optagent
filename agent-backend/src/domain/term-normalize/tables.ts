import fs from 'node:fs';
import path from 'node:path';

/** 017 产物文件名（与平台侧 `TERM_MAPPING_FILE` 同名，改名必须两侧同改） */
export const TERM_MAPPING_FILE = 'term_mapping.json';

export const TERM_VALUE_SEPARATOR = '或';

const ONTOLOGY_DIR = 'ontology';

export interface TermTableLoadResult {
  table: Record<string, string>;
  /** 降级原因（缺文件不算降级；坏 JSON / 结构非法才算） */
  warnings: string[];
  files: number;
}

export function mergeTermValues(previous: string, next: string): string {
  const candidates = new Set<string>();
  for (const part of `${previous}${TERM_VALUE_SEPARATOR}${next}`.split(TERM_VALUE_SEPARATOR)) {
    const text = part.trim();
    if (text !== '') candidates.add(text);
  }
  return [...candidates].join(TERM_VALUE_SEPARATOR);
}

export function mergeTermTables(
  tables: readonly Readonly<Record<string, string>>[],
): Record<string, string> {
  const merged = new Map<string, string>();
  for (const table of tables) {
    for (const [term, value] of Object.entries(table)) {
      if (term === '' || value === '') continue;
      const previous = merged.get(term);
      merged.set(term, previous === undefined ? value : mergeTermValues(previous, value));
    }
  }
  return Object.fromEntries(merged);
}

/**
 * 读取某个数字人**全部本体**的术语表并合并。
 *
 * 目录名排序后再读：同一份部署产物每次得到逐字节相同的表，缓存与排障都不会出现
 * "刷新两次结果不同"。坏文件只跳过并记 warning——术语表是增强件，读不出来不能影响对话。
 */
export function loadTermTable(agentPath: string): TermTableLoadResult {
  const warnings: string[] = [];
  const tables: Record<string, string>[] = [];
  let files = 0;

  for (const scenario of listDirs(path.join(agentPath, ONTOLOGY_DIR))) {
    for (const ontology of listDirs(path.join(agentPath, ONTOLOGY_DIR, scenario))) {
      const file = path.join(agentPath, ONTOLOGY_DIR, scenario, ontology, TERM_MAPPING_FILE);
      const table = readTable(file, warnings);
      if (table === null) continue;
      files++;
      tables.push(table);
    }
  }

  return { table: mergeTermTables(tables), warnings, files };
}

/** 读单个字典文件；不存在 → `null`（不算降级），坏内容 → `null` + warning */
function readTable(file: string, warnings: string[]): Record<string, string> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null; // 文件不存在 / 不可读：该本体没有术语字典，属正常形态
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      warnings.push(`${file} 不是对象，已跳过`);
      return null;
    }
    const table: Record<string, string> = {};
    for (const [term, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && term !== '' && value !== '') table[term] = value;
    }
    return table;
  } catch (err) {
    warnings.push(`${file} 不是合法 JSON：${(err as Error).message}`);
    return null;
  }
}

function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}
