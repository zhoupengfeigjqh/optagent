
export const TOOL_INLINE_MAX_BYTES = 32 * 1024;
/** 外置正文的落盘上限 2MB（超出截断并标 truncated） */
export const TOOL_ARTIFACT_MAX_BYTES = 2 * 1024 * 1024;
/** 摘要字符上限（外置结果的卡片说明用） */
const TOOL_SUMMARY_MAX_CHARS = 200;
/** 入参摘要：单值字符上限 */
const DIGEST_VALUE_MAX_CHARS = 120;
const DIGEST_MAX_ITEMS = 8;
/** call_id 进入文件名前的安全长度 */
const CALL_ID_MAX_CHARS = 64;

export interface SerializedToolResult {
  text: string;
  bytes: number;
}

export function serializeToolResult(result: unknown): SerializedToolResult {
  const parts: string[] = [];
  if (typeof result === 'string') {
    parts.push(result);
  } else if (result !== null && typeof result === 'object') {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block === null || typeof block !== 'object') continue;
        const b = block as { type?: unknown; text?: unknown; mimeType?: unknown; data?: unknown };
        if (b.type === 'text' && typeof b.text === 'string') {
          parts.push(b.text);
        } else if (b.type === 'image') {
          const mime = typeof b.mimeType === 'string' ? b.mimeType : 'image/*';
          const approxBytes = typeof b.data === 'string' ? Math.floor((b.data.length * 3) / 4) : 0;
          parts.push(
            approxBytes > 0 ? `[图片 ${mime} ~${formatBytes(approxBytes)}]` : `[图片 ${mime}]`,
          );
        }
      }
      if (parts.length === 0) parts.push(safeJson(result));
    } else {
      parts.push(safeJson(result));
    }
  } else if (result !== undefined && result !== null) {
    parts.push(String(result));
  }

  const text = parts.join('\n');
  return { text, bytes: Buffer.byteLength(text, 'utf8') };
}

export function truncateToBytes(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return { text, truncated: false };
  let sliced = buf.subarray(0, maxBytes).toString('utf8');
  const lastCode = sliced.charCodeAt(sliced.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdfff) sliced = sliced.slice(0, -1);
  return { text: sliced, truncated: true };
}

export interface TruncationNoteOptions {
  /** 完整正文所在的临时空间相对路径（有值 = 已落盘，模型可按路径 `read_file` 取回） */
  artifactPath?: string;
}

export function withRecordTruncationNote(
  text: string,
  totalBytes: number,
  options: TruncationNoteOptions = {},
): string {
  const head =
    `${text}\n\n（记录已截断：原文 ${formatBytes(totalBytes)}，` +
    `仅保留前 ${formatBytes(TOOL_INLINE_MAX_BYTES)}；`;
  return options.artifactPath
    ? `${head}完整正文在 ${options.artifactPath}，可用 read_file 读取）`
    : `${head}完整内容未保存，要查看更多请重新调用该工具，用更小范围或 offset 分段获取）`;
}

export function summarizeResult(text: string, maxChars = TOOL_SUMMARY_MAX_CHARS): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized === '') return '';
  const lines = normalized.split('\n');
  const firstLine = lines.find((l) => l.trim() !== '')?.trim() ?? '';
  const head = firstLine.length <= maxChars ? firstLine : `${firstLine.slice(0, maxChars)}…`;
  return lines.length > 1 ? `${head}（共 ${lines.length} 行）` : head;
}

/**
 * 外置正文文件名（**唯一推导入口**）。
 *
 * 事件行里**不存路径**，只存体积；读取时按同一函数重算，因此数据被篡改
 * 也无法把读指针带出该会话的临时空间。
 */
export function artifactFileName(threadId: string, callId: string): string {
  return `${threadId}_toolresult_${sanitizeCallId(callId)}.txt`;
}

export function artifactRelPath(threadId: string, callId: string, tmpSpace: string): string {
  return `${tmpSpace}/${artifactFileName(threadId, callId)}`;
}

/** call_id 安全化：只保留文件名安全字符（provider 生成的 id 不可信） */
export function sanitizeCallId(callId: string): string {
  const cleaned = callId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, CALL_ID_MAX_CHARS);
  return cleaned === '' ? 'c' : cleaned;
}

export function digestArgs(args: unknown): Record<string, string> | undefined {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (n >= DIGEST_MAX_ITEMS) break;
    if (typeof value === 'string') {
      out[key] =
        value.length <= DIGEST_VALUE_MAX_CHARS
          ? value
          : `${value.slice(0, DIGEST_VALUE_MAX_CHARS)}…`;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = String(value);
    } else if (value === null) {
      out[key] = 'null';
    } else if (Array.isArray(value)) {
      out[key] = `<数组 ${value.length} 项>`;
    } else if (typeof value === 'object') {
      out[key] = '<对象>';
    } else {
      continue;
    }
    n++;
  }
  return n > 0 ? out : undefined;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
