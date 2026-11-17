/**
 * write_file 工具（T038 / FR-022）：写临时产出。
 *
 * 2026-11-16 起**按扩展名路由输出模式**（`specs/022-write-file-format-routing`）：
 * 扩展名决定"要不要把文本编码成别的容器"，不再一律按 utf8 文本落盘——
 * 此前写 `x.pdf` / `x.xlsx` 会得到一个"扩展名像二进制、内容却是文本"的假文件，
 * 写入成功、入口可点、打开即失败，是最难排查的静默损坏。
 *
 * 权限与命名仍由 `FileAccess` 强制（仅 `临时空间/` 顶层扁平文件名 +
 * `{threadId}_` 前缀 + 禁 `:`），本模块只做：路由 → 校验 → 编码 → 交字节给写口。
 */
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

  // 二进制编码器在此产出 Buffer（`.xlsx` 同步、`.pdf` 走 pdfkit 流因而为 Promise）
  const buf = await mode.encode(content);

  const maxBytes = opts.maxBytes ?? DEFAULT_WRITE_MAX_BYTES;
  if (buf.length > maxBytes) {
    throw new WriteTooLargeError(
      `生成后 ${buf.length} 字节，超过 ${maxBytes} 字节上限；请拆分或精简内容后重试。`,
    );
  }

  // FileAccess.writeBytes 内部强制 tmp/ + thread_id 前缀，越权抛 PermissionError
  const relPath = await fa.writeBytes(threadId, filename, buf);
  return { path: relPath, bytes: buf.length, mode: mode.name };
}
