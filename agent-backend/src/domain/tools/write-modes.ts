/**
 * `write_file` 的输出格式注册表（2026-11-16，契约见 `specs/022-write-file-format-routing`）。
 *
 * 模型只传 `filename` + `content` 两个参数，**扩展名决定落盘格式**：
 * - 文本五类（`.txt` / `.md` / `.html` / `.csv` / `.json`）原样按 UTF-8 写盘，
 *   其中 `.json` / `.csv` 先过形状校验（防止落一个打不开的文件）；
 * - `.xlsx`：content 是 CSV 行数据（可 `# Sheet: 名称` 分段）→ 编码成 xlsx 容器；
 * - `.pdf`：content 是受限 Markdown → 编码成 PDF（嵌入开源中文字体）；
 * - **其余扩展名一律回落文本模式**：行为与改造前一致，
 *   `.log` / `.yaml` / `.sql` 等继续可写，零兼容破坏。
 *
 * 二进制格式 MUST NOT 走"扩展名像二进制、内容却是文本"的降级——那种静默损坏
 * 比报错更难排查（文件能写、入口可点、打开即失败）。
 *
 * 为什么路由在**工具层**而不在 `FileAccess`：`FileAccess.write` 还有第二个调用方
 * （`tool-events` 的外置正文副本 `{threadId}_toolresult_{callId}.txt`），
 * 把"模型可见的格式白名单"塞进权限层，会让内部调用也被迫受它约束
 * （将来白名单收紧 → 工具事件外置静默退化）。分层口径：
 * 格式知识只在本模块 + `encoders/`，`FileAccess` 只管路径与权限。
 */
import path from 'node:path';

import { encodePdf, validatePdfSource } from './encoders/pdf.js';
import { encodeText, validateCsv, validateJson } from './encoders/text.js';
import { encodeXlsx, parseTableSource } from './encoders/xlsx.js';

/** 已登记的落盘格式。`text` 同时承担"未登记扩展名"的回落模式。 */
export type WriteModeName = 'text' | 'markdown' | 'json' | 'html' | 'csv' | 'xlsx' | 'pdf';

/** content 的解释方式（只影响文案与校验，不影响写盘路径） */
export type ContentFormat = 'text' | 'json' | 'csv' | 'table' | 'doc';

export interface WriteMode {
  name: WriteModeName;
  contentFormat: ContentFormat;
  /** 不合格返回人话原因；`undefined` = 该格式不校验 */
  validate?: (content: string) => string | null;
  /**
   * 纯函数、无 IO；需要二进制的格式在这里产出 Buffer。
   * `.pdf` 走 pdfkit 的流式产出，故允许返回 Promise（其余格式同步返回）。
   */
  encode: (content: string) => Buffer | Promise<Buffer>;
  /** 该格式落盘后能否在界面内联查看（供文案与验收对齐） */
  inlinePreview: boolean;
}

/** content 与扩展名不匹配（JSON 解析失败、CSV 引号未闭合…） */
export class ContentFormatError extends Error {
  readonly code = 'CONTENT_FORMAT_MISMATCH';
  constructor(message: string) {
    super(message);
    this.name = 'ContentFormatError';
  }
}

/** 编码后体积超过写入上限（默认取 `PREVIEW_MAX_MB`） */
export class WriteTooLargeError extends Error {
  readonly code = 'FILE_TOO_LARGE';
  constructor(message: string) {
    super(message);
    this.name = 'WriteTooLargeError';
  }
}

function textMode(name: WriteModeName, contentFormat: ContentFormat): WriteMode {
  return { name, contentFormat, encode: encodeText, inlinePreview: true };
}

/** 未登记扩展名的回落模式（与 `.txt` 同一行为） */
export const FALLBACK_WRITE_MODE: WriteMode = textMode('text', 'text');

/** 表格源校验与编码共用 `parseTableSource`：同一份判据，避免"能过校验却编不出来" */
function validateTableSource(content: string): string | null {
  const parsed = parseTableSource(content);
  return parsed.ok ? null : parsed.error;
}

/**
 * 扩展名 → 模式。键**一律小写含点**，查询前统一 `toLowerCase()`。
 *
 * 顺序即"支持清单"的展示顺序（失败文案与规格断言共用）。
 */
const REGISTRY: Readonly<Record<string, WriteMode>> = {
  '.txt': textMode('text', 'text'),
  '.md': textMode('markdown', 'text'),
  '.html': textMode('html', 'text'),
  '.csv': { ...textMode('csv', 'csv'), validate: validateCsv },
  '.json': { ...textMode('json', 'json'), validate: validateJson },
  '.xlsx': {
    name: 'xlsx',
    contentFormat: 'table',
    validate: validateTableSource,
    encode: encodeXlsx,
    inlinePreview: true,
  },
  '.pdf': {
    name: 'pdf',
    contentFormat: 'doc',
    validate: validatePdfSource,
    encode: encodePdf,
    inlinePreview: true,
  },
};

/** 按文件名分派输出模式；未登记的扩展名（含无扩展名）回落文本模式 */
export function resolveWriteMode(filename: string): WriteMode {
  const ext = path.extname(filename).toLowerCase();
  return REGISTRY[ext] ?? FALLBACK_WRITE_MODE;
}

/** 已登记的扩展名清单（模型可见文案与规格断言共用，避免两处各写一份） */
export function supportedExtensions(): string[] {
  return Object.keys(REGISTRY);
}
