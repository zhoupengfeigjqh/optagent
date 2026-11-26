import { parse as parseYaml } from 'yaml';

export const TERM_MAPPING_FILE = 'term_mapping.json';

const VALUE_SEPARATOR = '或';

export interface TermMappingResult {
  json: string;
  entries: number;
  /** 降级原因；空数组表示一切正常 */
  warnings: string[];
}

export function buildTermMapping(raw: string): TermMappingResult {
  const warnings: string[] = [];
  const concepts = readConcepts(raw, warnings);

  const merged = new Map<string, string[]>();
  let titleless = 0;

  for (const item of concepts) {
    const concept = asRecord(item);
    const title = textOf(concept.title);
    const terms = Array.isArray(concept.terms) ? concept.terms : [];
    if (title === null) {
      if (terms.length > 0) titleless++;
      continue;
    }
    for (const rawTerm of terms) {
      const term = textOf(rawTerm);
      if (term === null) continue;
      const titles = merged.get(term);
      if (titles === undefined) {
        merged.set(term, [title]);
        continue;
      }
      if (!titles.includes(title)) titles.push(title);
    }
  }

  if (titleless > 0) warnings.push(`${titleless} 个 concept 缺 title，其 terms 已跳过`);

  const doc: Record<string, string> = {};
  for (const [term, titles] of merged) doc[term] = titles.join(VALUE_SEPARATOR);

  return { json: `${JSON.stringify(doc, null, 2)}\n`, entries: merged.size, warnings };
}

/**
 * 取 `concepts` 数组；任何异常都收敛为"空数组 + warning"。
 *
 * 与 `metadata.ts` 的差异：那里解析失败是**拒绝导入**（`VALIDATION_FAILED`），
 * 这里只是派生文件，失败必须放行（FR-006）。
 */
function readConcepts(raw: string, warnings: string[]): unknown[] {
  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (err) {
    warnings.push(`ontology.yaml 不是合法 YAML：${(err as Error).message}`);
    return [];
  }
  const record = asRecord(data);
  const concepts = record.concepts;
  if (concepts === undefined || concepts === null) return [];
  if (!Array.isArray(concepts)) {
    warnings.push('concepts 不是数组，按空处理');
    return [];
  }
  return concepts;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 文本归一：去首尾空白后为空即 `null`（数字形式的 term/title 不采用，避免把 `1` 当术语） */
function textOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
