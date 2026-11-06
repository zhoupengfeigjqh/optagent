/**
 * 术语表（017 产物）的**唯一读取与合并落点**（018）。
 *
 * 为什么单独成模块：文件名、合并分隔符、跨本体合并口径这三件事只要出现第二处定义，
 * 就会和平台侧生成端（`admin-backend/src/domain/ontology/term-mapping.ts`）悄悄漂移。
 * 本模块是运行环境侧的**唯一**口径来源，其余模块只消费 `loadTermTable()` 的结果。
 *
 * 口径（与 `specs/017` / `specs/018` 一致）：
 * - 文件：`agents/{agent}/ontology/{场景}/{本体}/term_mapping.json`，内容 `{term: value}`；
 * - value 可能是单值，也可能是 `A或B`（同 term 多义）；跨本体同名 key 的 value 继续用
 *   `或` 合并、去重、保持"本体目录名 → 文件内原序"的确定性顺序。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 017 产物文件名（与平台侧 `TERM_MAPPING_FILE` 同名，改名必须两侧同改） */
export const TERM_MAPPING_FILE = 'term_mapping.json';

/** 多义合并分隔符（与平台侧 017 生成口径一致：无空格） */
export const TERM_VALUE_SEPARATOR = '或';

/** 本体产物子目录名（与 `specs/001` 的物化布局一致） */
const ONTOLOGY_DIR = 'ontology';

export interface TermTableLoadResult {
  /** 合并后的 `term → value`（插入序 = 目录序 → 文件内原序） */
  table: Record<string, string>;
  /** 降级原因（缺文件不算降级；坏 JSON / 结构非法才算） */
  warnings: string[];
  /** 实际读到的字典文件数（0 = 该数字人没有可用术语） */
  files: number;
}

/**
 * 合并两个 value：拆成候选集后去重再拼回，保证 `A或B` + `B或C` = `A或B或C`。
 *
 * 不直接用字符串拼接（`prev + '或' + next`）：跨本体重复部署是最常见的场景，
 * 直接拼接会得到 `供应商或供应商` 这种噪声。
 */
export function mergeTermValues(previous: string, next: string): string {
  const candidates = new Set<string>();
  for (const part of `${previous}${TERM_VALUE_SEPARATOR}${next}`.split(TERM_VALUE_SEPARATOR)) {
    const text = part.trim();
    if (text !== '') candidates.add(text);
  }
  return [...candidates].join(TERM_VALUE_SEPARATOR);
}

/** 按给定顺序合并多张表；同名 key 的 value 用 `或` 合并 */
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

/** 只列目录（不存在 → 空数组），并排序保证确定性 */
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
