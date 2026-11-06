/**
 * 术语替换：Trie（前缀树）+ **单遍最长优先匹配**（018）。
 *
 * 纯函数：只有字符串进、字符串出；不读盘、不读时钟、不依赖开关。开关与字典加载
 * 都在调用方（`routes/term-normalize.ts`），保证这一层可以穷举测试。
 *
 * 三条口径：
 * 1. **最长优先**：`供应商编号` 命中时不会被拆成 `供应商` + `编号`；
 * 2. **单遍、不重叠、不递归**：替换结果不会在同一轮被再次匹配（`A→B`、`B→C` 只走一步）；
 * 3. **最短长度 2**（用户 2026-11-06 确认）：单字术语（`料`、`单`）噪声太大，直接不建进树。
 *
 * 返回的 `start`/`end` 是 **UTF-16 下标**（与 JS 字符串切片一致），前端可直接用于高亮。
 */

/** 最短命中长度（按 Unicode 码点计） */
export const MIN_TERM_LENGTH = 2;

export interface TermMatch {
  /** 原文中的命中片段 */
  term: string;
  /** 替换成的值（可能是 `A或B`） */
  value: string;
  /** 原文中的起始下标（UTF-16） */
  start: number;
  /** 原文中的结束下标（UTF-16，开区间） */
  end: number;
}

export interface NormalizeResult {
  /** 是否真的发生了改变（`value === term` 不算） */
  applied: boolean;
  normalized: string;
  matches: TermMatch[];
}

interface TrieNode {
  children: Map<string, TrieNode>;
  /** 该节点对应的术语的替换值；仅词尾节点有 */
  value?: string;
}

/**
 * 对一段文本应用术语表。
 *
 * @param table `term → value`；value 为 `A或B` 时原样插入（多义保留，用户 2026-11-06 确认）
 */
export function normalizeByTerms(
  text: string,
  table: Readonly<Record<string, string>>,
  minLength: number = MIN_TERM_LENGTH,
): NormalizeResult {
  const root = buildTrie(table, minLength);
  // 按码点切分并记录 UTF-16 偏移：中文为主，但 emoji / 生僻字不得把高亮下标算错
  const points = Array.from(text);
  const offsets: number[] = [];
  let cursor = 0;
  for (const point of points) {
    offsets.push(cursor);
    cursor += point.length;
  }
  const endOffset = (index: number): number =>
    index < points.length ? (offsets[index] as number) : text.length;

  const matches: TermMatch[] = [];
  let out = '';
  let i = 0;

  while (i < points.length) {
    let node = root;
    let j = i;
    let bestEnd = -1;
    let bestValue: string | undefined;

    while (j < points.length) {
      const next = node.children.get(points[j] as string);
      if (next === undefined) break;
      node = next;
      j += 1;
      // 记录"到目前为止最长的词尾"，走到无路可走时它就是最长匹配
      if (node.value !== undefined) {
        bestEnd = j;
        bestValue = node.value;
      }
    }

    if (bestValue !== undefined) {
      const term = points.slice(i, bestEnd).join('');
      if (bestValue !== term) {
        out += bestValue;
        matches.push({ term, value: bestValue, start: offsets[i] as number, end: endOffset(bestEnd) });
      } else {
        // 术语本身就是标题：不算替换，也就不会触发确认弹窗
        out += term;
      }
      i = bestEnd;
      continue;
    }

    out += points[i] as string;
    i += 1;
  }

  return { applied: matches.length > 0, normalized: out, matches };
}

function buildTrie(
  table: Readonly<Record<string, string>>,
  minLength: number,
): TrieNode {
  const root: TrieNode = { children: new Map() };
  for (const [term, value] of Object.entries(table)) {
    const points = Array.from(term);
    if (points.length < minLength || value === '') continue;
    let node = root;
    for (const point of points) {
      let next = node.children.get(point);
      if (next === undefined) {
        next = { children: new Map() };
        node.children.set(point, next);
      }
      node = next;
    }
    node.value = value;
  }
  return root;
}
