import path from 'node:path';

import { encodePdf, validatePdfSource } from './encoders/pdf.js';
import { encodeText, validateCsv, validateJson } from './encoders/text.js';
import { encodeXlsx, parseTableSource } from './encoders/xlsx.js';

export type WriteModeName = 'text' | 'markdown' | 'json' | 'html' | 'csv' | 'xlsx' | 'pdf';

export type ContentFormat = 'text' | 'json' | 'csv' | 'table' | 'doc';

export interface WriteMode {
  name: WriteModeName;
  contentFormat: ContentFormat;
  validate?: (content: string) => string | null;
  encode: (content: string) => Buffer | Promise<Buffer>;
  inlinePreview: boolean;
}

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

export const FALLBACK_WRITE_MODE: WriteMode = textMode('text', 'text');

/** 表格源校验与编码共用 `parseTableSource`：同一份判据，避免"能过校验却编不出来" */
function validateTableSource(content: string): string | null {
  const parsed = parseTableSource(content);
  return parsed.ok ? null : parsed.error;
}

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

export function resolveWriteMode(filename: string): WriteMode {
  const ext = path.extname(filename).toLowerCase();
  return REGISTRY[ext] ?? FALLBACK_WRITE_MODE;
}

/** 已登记的扩展名清单（模型可见文案与规格断言共用，避免两处各写一份） */
export function supportedExtensions(): string[] {
  return Object.keys(REGISTRY);
}
