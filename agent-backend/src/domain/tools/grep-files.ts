/**
 * grep_files 工具（T038）：文本检索。
 *
 * 仅作用文本格式（.csv/.txt/.json/.md/.log），.xlsx/.pdf 等二进制跳过
 * 并在结果中注明跳过数量（由 FileAccess.grep 保证）。
 */
import type { FileAccess } from '../file-access.js';

const MAX_MATCHES = 100;

export async function grepToolFiles(
  fa: FileAccess,
  pattern: string,
  dir?: string,
): Promise<string> {
  const { matches, skippedBinary } = await fa.grep(pattern, dir);
  const parts: string[] = [];
  if (matches.length === 0) {
    parts.push(`未找到匹配 "${pattern}" 的内容`);
  } else {
    const shown = matches.slice(0, MAX_MATCHES);
    parts.push(
      `找到 ${matches.length} 处匹配${matches.length > MAX_MATCHES ? `（仅显示前 ${MAX_MATCHES} 条）` : ''}：`,
      ...shown.map((m) => `${m.file}:${m.line}: ${m.text}`),
    );
  }
  if (skippedBinary > 0) {
    parts.push(`（已跳过 ${skippedBinary} 个二进制文件，xlsx/pdf 请用 read_file 阅读）`);
  }
  return parts.join('\n');
}
