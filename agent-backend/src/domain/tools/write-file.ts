/**
 * write_file 工具（T038 / FR-022）：写临时产出。
 *
 * 仅允许 tmp/ 且强制 `{thread_id}_` 前缀（由 FileAccess 强制，
 * 这里只做入参整形与结果描述）。越权由 FileAccess 抛 PermissionError，
 * 上层（builtin-tools 适配器）转成自然语言提示，对话不中断（FR-022）。
 */
import type { FileAccess } from '../file-access.js';

export interface WriteToolResult {
  path: string;
  bytes: number;
}

export async function writeToolFile(
  fa: FileAccess,
  threadId: string,
  filename: string,
  content: string,
): Promise<WriteToolResult> {
  // FileAccess.write 内部强制 tmp/ + thread_id 前缀，越权抛 PermissionError
  const relPath = await fa.write(threadId, filename, content);
  return { path: relPath, bytes: Buffer.byteLength(content, 'utf8') };
}
