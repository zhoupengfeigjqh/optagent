/**
 * 术语字典生成（017）：把 `ontology.yaml` 的 `concepts[].terms` 派生成 `term → concept.title`。
 *
 * 为什么放在平台侧：平台是本体内容的唯一权威源，部署是它"出平台"的唯一通道
 * （与 `ontology.yaml` / `securities.yaml` 同一次物化），运行环境不反向生成、不反向写回。
 *
 * 三条口径（`specs/017-ontology-term-mapping/spec.md`）：
 * 1. **每个 term 一个键**，value 是该 concept 的 `title`；
 * 2. 同一 term 命中多个 concept 时 **value 合并**，按 `concepts[]` 原序用 `或` 连接，
 *    同一 title 只出现一次（否则会得到"供应商或供应商"这种噪声）；
 * 3. `terms` 为空的 concept **跳过**——空数组是常态（现存本体全部为空），
 *    不能因此产出空串键。
 *
 * 本模块是**纯函数**：只有字符串进、字符串出，不做 IO、不读时钟，
 * 部署编排只负责把 `json` 塞进产物清单。任何解析失败都降级为 `{}` + warning，
 * 派生文件坏了**不得**让整次部署失败。
 */
import { parse as parseYaml } from 'yaml';

/** 落盘文件名（与 `ontology.yaml` 同目录） */
export const TERM_MAPPING_FILE = 'term_mapping.json';

/**
 * 同名 key 的 value 合并分隔符。
 *
 * 用「或」而不是「；」：这些 title 不是"同时成立的两件事"，而是同一个词在本体里的
 * 两种叫法（`供应商信息 → 供应商 或 供应商编号`），用「或」读起来才是"任选其一"的语义，
 * 也便于聊天侧把合并结果直接放进句子。
 */
const VALUE_SEPARATOR = '或';

export interface TermMappingResult {
  /** 落盘内容：`{}` 或 2 空格缩进的 JSON + 末尾换行 */
  json: string;
  /** 去重后的键数（= term 条数） */
  entries: number;
  /** 降级原因；空数组表示一切正常 */
  warnings: string[];
}

/**
 * 由本体正文生成术语字典内容。
 *
 * 输入是 `ontology.yaml` 全文（部署期从本体库快照读取），输出可直接写盘。
 */
export function buildTermMapping(raw: string): TermMappingResult {
  const warnings: string[] = [];
  const concepts = readConcepts(raw, warnings);

  /** term → 该 term 命中的 title 列表（插入序 = concepts 原序） */
  const merged = new Map<string, string[]>();
  let titleless = 0;

  for (const item of concepts) {
    const concept = asRecord(item);
    const title = textOf(concept.title);
    const terms = Array.isArray(concept.terms) ? concept.terms : [];
    if (title === null) {
      // 没有 title 就没有 value；只在真的带了 terms 时才值得记一笔
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
