/**
 * 工具结果序列化 / 摘要 / 命名（002 特性：工具调用记录）。
 *
 * 本模块只做**纯函数**转换，不碰磁盘，便于单测边界：
 * - `serializeToolResult`：把 provider 的 AgentToolResult 拍平成文本
 *   （`content` 块数组 → 文本拼接；图片块只留占位，**绝不落 base64**）
 * - 体积阈值：超过内联阈值才外置为临时空间文件（见 tool-events）
 * - `summarizeResult`：**规则提取**，不调 LLM（否则每轮多一次模型调用）
 * - `artifactFileName`：外置文件名的唯一推导入口（路径不从数据里读，防注入）
 * - `digestArgs`：入参只留**短标量摘要**，长字段/嵌套结构替换为占位符
 */
import path from 'node:path';

/** 结果 ≤ 该字节数：原文内联进 tool-events.jsonl 的 `inline_content` */
export const TOOL_INLINE_MAX_BYTES = 16 * 1024;
/** 外置正文的落盘上限（超出截断并标 truncated） */
export const TOOL_ARTIFACT_MAX_BYTES = 10 * 1024 * 1024;
/** 摘要字符上限（外置结果的索引行展示用） */
export const TOOL_SUMMARY_MAX_CHARS = 200;
/** 入参摘要：单值字符上限 */
const DIGEST_VALUE_MAX_CHARS = 120;
/** 入参摘要：最多保留几个键 */
const DIGEST_MAX_ITEMS = 8;
/** call_id 进入文件名前的安全长度 */
const CALL_ID_MAX_CHARS = 64;

export interface SerializedToolResult {
  text: string;
  bytes: number;
}

/**
 * 把工具执行结果拍平成文本。
 *
 * - `string` → 原样
 * - `{ content: [{type:'text',text}, {type:'image',mimeType,data}] }` → 文本块拼接，
 *   图片块只留 `[图片 mime ~体积]` 占位（base64 落盘会膨胀且无检索价值）
 * - 其它对象 → JSON（保底可读）
 */
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
          parts.push(approxBytes > 0 ? `[图片 ${mime} ~${formatBytes(approxBytes)}]` : `[图片 ${mime}]`);
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

/** 按字节截断（不切坏 UTF-8：末尾残留的代理字符丢弃） */
export function truncateToBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return { text, truncated: false };
  let sliced = buf.subarray(0, maxBytes).toString('utf8');
  const lastCode = sliced.charCodeAt(sliced.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdfff) sliced = sliced.slice(0, -1);
  return { text: sliced, truncated: true };
}

/**
 * 规则提取摘要（首个非空行 + 总行数）。
 *
 * 刻意不用 LLM：摘要会在每次组 prompt 时反复使用，走模型等于每轮多一次调用。
 */
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

/** 外置正文的 user-data 相对路径（供索引行展示与内部读取） */
export function artifactRelPath(threadId: string, callId: string, tmpSpace: string): string {
  return `${tmpSpace}/${artifactFileName(threadId, callId)}`;
}

/** call_id 安全化：只保留文件名安全字符（provider 生成的 id 不可信） */
export function sanitizeCallId(callId: string): string {
  const cleaned = callId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, CALL_ID_MAX_CHARS);
  return cleaned === '' ? 'c' : cleaned;
}

/**
 * 入参摘要（D1）：只留短标量，长字符串截断、数组/对象只留形状。
 *
 * 入参原文不落盘——它可能含大 payload 或敏感信息，而"调了什么、查的哪个文件"
 * 这类展示/审计需求靠短标量已经够用。
 */
export function digestArgs(args: unknown): Record<string, string> | undefined {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (n >= DIGEST_MAX_ITEMS) break;
    if (typeof value === 'string') {
      out[key] = value.length <= DIGEST_VALUE_MAX_CHARS ? value : `${value.slice(0, DIGEST_VALUE_MAX_CHARS)}…`;
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

/** 人类可读体积（摘要与占位符用） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 文件名是否为本模块推导出的外置正文（读取前的二次校验） */
export function isArtifactFileName(filename: string, threadId: string): boolean {
  if (path.basename(filename) !== filename) return false;
  return filename.startsWith(`${threadId}_toolresult_`) && filename.endsWith('.txt');
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
