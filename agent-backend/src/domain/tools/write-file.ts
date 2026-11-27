import type { FileAccess } from '../file-access.js';
import {
  ContentFormatError,
  WriteTooLargeError,
  resolveWriteMode,
  type WriteModeName,
} from './write-modes.js';

export interface WriteToolResult {
  path: string;
  bytes: number;
  mode: WriteModeName;
}

export interface WriteToolOptions {
  /**
   * 落盘字节上限。生产由 `server.ts` 注入 `PREVIEW_MAX_MB`，
   * 与预览上限同源——否则会写出一个"能下载、点开即 413"的文件。
   */
  maxBytes?: number | undefined;
}

/** 未注入上限时的兜底（测试等直调场景），与生产缺省 `PREVIEW_MAX_MB = 5` 对齐 */
export const DEFAULT_WRITE_MAX_BYTES = 5 * 1024 * 1024;

export async function writeToolFile(
  fa: FileAccess,
  threadId: string,
  filename: string,
  content: string,
  opts: WriteToolOptions = {},
): Promise<WriteToolResult> {
  const mode = resolveWriteMode(filename);

  const invalid = mode.validate?.(content) ?? null;
  if (invalid !== null) throw new ContentFormatError(invalid);

  const buf = await mode.encode(content);

  const maxBytes = opts.maxBytes ?? DEFAULT_WRITE_MAX_BYTES;
  if (buf.length > maxBytes) {
    throw new WriteTooLargeError(
      `生成后 ${buf.length} 字节，超过 ${maxBytes} 字节上限；请拆分或精简内容后重试。`,
    );
  }

  const relPath = await fa.writeBytes(threadId, filename, buf);
  return { path: relPath, bytes: buf.length, mode: mode.name };
}
