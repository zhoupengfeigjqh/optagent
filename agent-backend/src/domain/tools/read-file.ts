/**
 * read_file 工具的格式分派（T037 / FR-021）。
 *
 * - 文本（.csv/.txt/.json/.md/.log/.html）：FileAccess.read 直读（内部已做截断与 utimes）；
 *   `.html` 按**原文**读（2026-10-20），不解析 DOM、不执行脚本、不剥标签——模型要的是源码
 * - .xlsx / .xls：SheetJS 逐 sheet 转 CSV（`.xls` 为 OLE2/BIFF 容器，库按文件头自判）
 * - .pdf：pdfjs-dist 提取文本层；无文本层（扫描件）→ 友好提示
 * - 其余扩展名（2026-11-16）：**按内容嗅探兜底**——整个缓冲无 NUL 即按 utf8 文本读，
 *   含 NUL 才拒绝。与 `write_file` 的「未登记扩展名回落文本」对齐，
 *   保证"模型写得进去的，一定读得回来"；判据仍是内容而非扩展名名分
 *
 * xlsx/pdf 解析后的文本同样套用 32KB（可配）截断 + offset/limit 分段，
 * 保证 LLM 上下文不被大文件打爆。
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { FileAccess } from '../file-access.js';
// 2026-11-16：`xlsxToText` 抽到 `domain/preview/xlsx-text.ts`——读侧与预览侧共用一份
import { xlsxToText } from '../preview/xlsx-text.js';

const TEXT_EXTENSIONS = new Set(['.csv', '.txt', '.json', '.md', '.log', '.html']);
/** 需经 SheetJS 转文本的 Excel 容器（`.xlsx` zip / `.xls` OLE2，库按文件头自判） */
const EXCEL_EXTENSIONS = new Set(['.xlsx', '.xls']);
const SUPPORTED = '.csv/.xlsx/.xls/.txt/.json/.pdf/.md/.log/.html';

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

  if (EXCEL_EXTENSIONS.has(ext)) {
    return sliceText(xlsxToText(await fa.readBuffer(relPath)), opts, fa.truncateBytes);
  }
  if (ext === '.pdf') {
    return sliceText(await pdfToText(await fa.readBuffer(relPath)), opts, fa.truncateBytes);
  }

  // 未知扩展名（2026-11-16）：与 `write_file` 的"文本回落"对齐——写按扩展名编码，读按内容嗅探。
  // 判据是全缓冲含 NUL：含 = 二进制，仍按"不支持"拒绝（文案与改造前逐字一致）。
  // 这里已经读完整文件（`readBuffer`），逐字节判定不再多一次 IO。
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

/** 解析后文本的截断分片（Excel / PDF / 未知扩展名三条路共用） */
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
