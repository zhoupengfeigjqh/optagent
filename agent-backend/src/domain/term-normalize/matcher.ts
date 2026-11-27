
export const MIN_TERM_LENGTH = 2;

export interface TermMatch {
  term: string;
  value: string;
  start: number;
  end: number;
}

export interface NormalizeResult {
  applied: boolean;
  normalized: string;
  matches: TermMatch[];
}

interface TrieNode {
  children: Map<string, TrieNode>;
  value?: string;
}

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
