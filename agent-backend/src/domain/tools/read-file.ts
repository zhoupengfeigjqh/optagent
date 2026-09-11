/**
 * read_file 工具的格式分派（T037 / FR-021）。
 *
 * - 文本（.csv/.txt/.json/.md/.log）：FileAccess.read 直读（内部已做截断与 utimes）
 * - .xlsx：SheetJS 逐 sheet 转 CSV
 * - .pdf：pdfjs-dist 提取文本层；无文本层（扫描件）→ 友好提示
 * - 其余扩展名：明确拒绝并说明支持范围
 *
 * xlsx/pdf 解析后的文本同样套用 32KB（可配）截断 + offset/limit 分段，
 * 保证 LLM 上下文不被大文件打爆。
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as XLSX from 'xlsx';
import type { FileAccess } from '../file-access.js';

const TEXT_EXTENSIONS = new Set(['.csv', '.txt', '.json', '.md', '.log']);
const SUPPORTED = '.csv/.xlsx/.txt/.json/.pdf/.md/.log';

export interface ReadToolResult {
  /** 交给模型的文本（含截断提示） */
  text: string;
  truncated: boolean;
  totalSize: number;
}

export interface ReadToolOptions {
  /** 字节偏移（对解析后文本生效） */
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

  let full: string;
  if (ext === '.xlsx') {
    full = xlsxToText(await fa.readBuffer(relPath));
  } else if (ext === '.pdf') {
    full = await pdfToText(await fa.readBuffer(relPath));
  } else {
    return {
      text: `不支持的文件格式 "${ext || '（无扩展名）'}"，read_file 支持 ${SUPPORTED}`,
      truncated: false,
      totalSize: 0,
    };
  }

  const buf = Buffer.from(full, 'utf8');
  const totalSize = buf.length;
  const offset = opts.offset ?? 0;
  const limit = Math.min(opts.limit ?? fa.truncateBytes, fa.truncateBytes);
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

/** xlsx → 逐 sheet CSV 文本 */
function xlsxToText(buf: Buffer): string {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    parts.push(`### Sheet: ${name}\n${XLSX.utils.sheet_to_csv(ws)}`);
  }
  return parts.length > 0 ? parts.join('\n\n') : '该 Excel 文件没有任何工作表';
}

let pdfWorkerReady = false;

/** pdf → 文本层拼接；无文本层返回友好提示 */
async function pdfToText(buf: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfWorkerReady) {
    // Node 无浏览器 Worker：指向本地 worker 文件，pdfjs 自动走 fake worker（主线程）
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
