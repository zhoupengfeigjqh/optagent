import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import PDFDocument from 'pdfkit';

const require = createRequire(import.meta.url);

const MARGIN = 56;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const PAGE_BOTTOM = PAGE_HEIGHT - MARGIN;

const FONT_REGULAR_FILE = path.join('400Regular', 'NotoSansSC_400Regular.ttf');
const FONT_BOLD_FILE = path.join('700Bold', 'NotoSansSC_700Bold.ttf');

type PdfDoc = InstanceType<typeof PDFDocument>;

function fontDir(): string {
  return path.dirname(require.resolve('@expo-google-fonts/noto-sans-sc/package.json'));
}

const fontCache = new Map<string, Buffer>();

function fontBuffer(file: string): Buffer {
  const cached = fontCache.get(file);
  if (cached) return cached;
  const buf = readFileSync(path.join(fontDir(), file));
  fontCache.set(file, buf);
  return buf;
}

export function validatePdfSource(content: string): string | null {
  if (content.trim() === '') {
    return (
      '.pdf 内容为空：请给出受限 Markdown 文本' +
      '（# 标题、普通段落、- 列表、| a | b | 表格，空行分段）。'
    );
  }
  // 控制字符（保留 \t \n \r）会让 PDF 文本流出现不可见乱码
  // eslint-disable-next-line no-control-regex -- 这里就是要拦控制字符
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(content)) {
    return '.pdf 内容含不可打印控制字符，请改为纯文本后重试。';
  }
  return null;
}

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'table'; rows: string[][] };

const HEADING = /^(#{1,3})\s+(.+)$/;
const BULLET = /^[-*+]\s+(.+)$/;
const NUMBERED = /^\d+[.)]\s+(.+)$/;
const TABLE_SEPARATOR = /^\|?[\s:|-]+\|?$/;

function splitTableRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function parsePdfBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let table: string[][] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ').trim() });
    paragraph = [];
  };
  const flushTable = (): void => {
    if (table.length === 0) return;
    blocks.push({ kind: 'table', rows: table });
    table = [];
  };

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') {
      flushParagraph();
      flushTable();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      flushTable();
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        text: heading[2]!.trim(),
      });
      continue;
    }

    if (line.startsWith('|')) {
      flushParagraph();
      if (!TABLE_SEPARATOR.test(line)) table.push(splitTableRow(line));
      continue;
    }
    flushTable();

    const bullet = BULLET.exec(line) ?? NUMBERED.exec(line);
    if (bullet) {
      flushParagraph();
      blocks.push({ kind: 'bullet', text: bullet[1]!.trim() });
      continue;
    }

    paragraph.push(line);
  }
  flushParagraph();
  flushTable();
  return blocks;
}

function inlineSegments(text: string): Array<{ text: string; bold: boolean }> {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((part) => part !== '');
  const segments = parts.map((part) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    return bold ? { text: bold[1]!, bold: true } : { text: part, bold: false };
  });
  return segments.length > 0 ? segments : [{ text, bold: false }];
}

function writeParagraph(doc: PdfDoc, text: string): void {
  const segments = inlineSegments(text);
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    doc.font(segment.bold ? 'bold' : 'regular').fontSize(11);
    doc.text(segment.text, {
      lineGap: 3,
      ...(last ? { paragraphGap: 7 } : { continued: true }),
    });
  });
}

function renderTable(doc: PdfDoc, rows: string[][]): void {
  const cols = Math.max(...rows.map((row) => row.length), 1);
  const colWidth = CONTENT_WIDTH / cols;
  const pad = 4;
  const fontSize = 9.5;

  for (const [index, row] of rows.entries()) {
    const header = index === 0;
    const heights = Array.from({ length: cols }, (_, ci) => {
      doc.font(header ? 'bold' : 'regular').fontSize(fontSize);
      return doc.heightOfString(row[ci] ?? '', { width: colWidth - pad * 2 }) + pad * 2;
    });
    const height = Math.max(...heights, 18);

    if (doc.y + height > PAGE_BOTTOM) doc.addPage();
    const top = doc.y;

    for (let ci = 0; ci < cols; ci += 1) {
      doc
        .font(header ? 'bold' : 'regular')
        .fontSize(fontSize)
        .text(row[ci] ?? '', MARGIN + ci * colWidth + pad, top + pad, {
          width: colWidth - pad * 2,
          lineGap: 1,
        });
    }
    doc
      .moveTo(MARGIN, top + height)
      .lineTo(MARGIN + CONTENT_WIDTH, top + height)
      .strokeColor('#d0d7de')
      .lineWidth(0.6)
      .stroke();
    doc.y = top + height;
    doc.x = MARGIN;
  }
  doc.moveDown(0.4);
}

function renderBlocks(doc: PdfDoc, blocks: Block[]): void {
  for (const block of blocks) {
    switch (block.kind) {
      case 'heading': {
        const size = block.level === 1 ? 19 : block.level === 2 ? 15 : 12.5;
        doc.font('bold').fontSize(size);
        doc.text(block.text, { lineGap: 2, paragraphGap: block.level === 1 ? 8 : 5 });
        break;
      }
      case 'paragraph':
        writeParagraph(doc, block.text);
        break;
      case 'bullet':
        doc.font('regular').fontSize(11);
        doc.text(`•  ${block.text}`, { indent: 10, lineGap: 3, paragraphGap: 3 });
        break;
      case 'table':
        renderTable(doc, block.rows);
        break;
    }
  }
}

export async function encodePdf(content: string): Promise<Buffer> {
  const dir = fontDir();
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: { Producer: 'optagent', Creator: 'optagent write_file' },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err: Error) => reject(err));
  });

  try {
    doc.registerFont('regular', fontBuffer(FONT_REGULAR_FILE));
    doc.registerFont('bold', fontBuffer(FONT_BOLD_FILE));
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `PDF 中文字体加载失败（${dir}）：${reason}。请确认部署环境已安装 @expo-google-fonts/noto-sans-sc。`,
      { cause: err },
    );
  }

  renderBlocks(doc, parsePdfBlocks(content));
  doc.end();
  return finished;
}
