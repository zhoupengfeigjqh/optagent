import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { FileAccess } from '../file-access.js';
import { xlsxToText } from '../preview/xlsx-text.js';

const TEXT_EXTENSIONS = new Set(['.csv', '.txt', '.json', '.md', '.log', '.html']);
const EXCEL_EXTENSIONS = new Set(['.xlsx', '.xls']);
const SUPPORTED = '.csv/.xlsx/.xls/.txt/.json/.pdf/.md/.log/.html';

export interface ReadToolResult {
  text: string;
  truncated: boolean;
  totalSize: number;
}

export interface ReadToolOptions {
  offset?: number | undefined;
  /** 本次最多返回字节数（默认/上限均为 FileAccess 的截断配置） */
  limit?: number | undefined;
}

export async function readToolFile(
  fa: FileAccess,
  relPath: string,
  opts: ReadToolOptions = {},
): Promise<ReadToolResult> {
  // 权限先行：穿越/越权必须报 PermissionError，而非格式提示
  fa.assertPathAllowed(relPath);
  const ext = path.extname(relPath).toLowerCase();

  if (TEXT_EXTENSIONS.has(ext)) {
    const r = await fa.read(relPath, { offset: opts.offset, limit: opts.limit });
    return {
      text: withTruncationNote(r.content, r.truncated, r.totalSize, opts.offset ?? 0),
      truncated: r.truncated,
      totalSize: r.totalSize,
    };
  }

  if (EXCEL_EXTENSIONS.has(ext)) {
    return sliceText(xlsxToText(await fa.readBuffer(relPath)), opts, fa.truncateBytes);
  }
  if (ext === '.pdf') {
    return sliceText(await pdfToText(await fa.readBuffer(relPath)), opts, fa.truncateBytes);
  }

  const buf = await fa.readBuffer(relPath);
  if (buf.includes(0)) {
    return {
      text: `不支持的文件格式 "${ext || '（无扩展名）'}"，read_file 支持 ${SUPPORTED}`,
      truncated: false,
      totalSize: 0,
    };
  }
  return sliceText(buf.toString('utf8'), opts, fa.truncateBytes, buf.length);
}

function sliceText(
  full: string,
  opts: ReadToolOptions,
  truncateBytes: number,
  totalSizeInput?: number,
): ReadToolResult {
  const buf = Buffer.from(full, 'utf8');
  const totalSize = totalSizeInput ?? buf.length;
  const offset = opts.offset ?? 0;
  const limit = Math.min(opts.limit ?? truncateBytes, truncateBytes);
  const slice = buf.subarray(offset, offset + limit).toString('utf8');
  const truncated = offset + Buffer.byteLength(slice, 'utf8') < totalSize;
  return { text: withTruncationNote(slice, truncated, totalSize, offset), truncated, totalSize };
}

function withTruncationNote(
  content: string,
  truncated: boolean,
  totalSize: number,
  offset: number,
): string {
  if (!truncated) return content;
  const consumed = offset + Buffer.byteLength(content, 'utf8');
  return (
    `${content}\n\n[内容已截断：本次返回至第 ${consumed} 字节，共 ${totalSize} 字节；` +
    `可用 offset=${consumed} 继续读取]`
  );
}

let pdfWorkerReady = false;

async function pdfToText(buf: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfWorkerReady) {
    const req = createRequire(import.meta.url);
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ).href;
    pdfWorkerReady = true;
  }
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useWorkerFetch: false,
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const text = tc.items
        .map((it) => ('str' in it ? it.str : ''))
        .join('')
        .trim();
      if (text) pages.push(`--- 第 ${i}/${doc.numPages} 页 ---\n${text}`);
    }
    if (pages.length === 0) {
      return '该 PDF 没有可提取的文本层（可能是扫描件或纯图片），无法直接阅读其内容';
    }
    return pages.join('\n\n');
  } finally {
    await loadingTask.destroy();
  }
}
