import { describe, expect, it } from 'vitest';

import type { FileAccess } from '../../src/domain/file-access.js';
import {
  DEFAULT_WRITE_MAX_BYTES,
  writeToolFile,
} from '../../src/domain/tools/write-file.js';
import { ContentFormatError, WriteTooLargeError } from '../../src/domain/tools/write-modes.js';

const THREAD = 'th_1';

function stubAccess(): {
  fa: FileAccess;
  writes: Array<{ filename: string; data: Buffer }>;
} {
  const writes: Array<{ filename: string; data: Buffer }> = [];
  const fa = {
    writeBytes: async (threadId: string, filename: string, data: Buffer): Promise<string> => {
      if (!filename.startsWith(`${threadId}_`)) throw new Error(`前缀缺失: ${filename}`);
      writes.push({ filename, data });
      return `临时空间/${filename}`;
    },
  } as unknown as FileAccess;
  return { fa, writes };
}

describe('writeToolFile —— 文本五类原样写盘', () => {
  it.each([
    ['th_1_说明.txt', 'text'],
    ['th_1_分析.md', 'markdown'],
    ['th_1_看板.html', 'html'],
    ['th_1_明细.csv', 'csv'],
  ])('%s → mode=%s，utf8 原样', async (filename, expectedMode) => {
    const { fa, writes } = stubAccess();
    const content = '第一行\n第二行';

    const result = await writeToolFile(fa, THREAD, filename, content);

    expect(result).toEqual({
      path: `临时空间/${filename}`,
      bytes: Buffer.byteLength(content, 'utf8'),
      mode: expectedMode,
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.data.toString('utf8')).toBe(content);
  });

  it('.json 合法 → 原样落盘（不重排，模型回读时看到的就是自己写的）', async () => {
    const { fa, writes } = stubAccess();
    const content = '{ "a": 1,\n  "b": [2, 3] }';

    const result = await writeToolFile(fa, THREAD, 'th_1_数据.json', content);

    expect(result.mode).toBe('json');
    expect(writes[0]?.data.toString('utf8')).toBe(content);
  });

  it('未登记扩展名 → 回落 text（不拒绝，与改造前一致）', async () => {
    const { fa, writes } = stubAccess();

    const result = await writeToolFile(fa, THREAD, 'th_1_日志.log', 'a: 1\n');

    expect(result.mode).toBe('text');
    expect(writes[0]?.data.toString('utf8')).toBe('a: 1\n');
  });
});

describe('writeToolFile —— 校验失败不落盘', () => {
  it('非法 JSON → ContentFormatError，零写入', async () => {
    const { fa, writes } = stubAccess();

    await expect(writeToolFile(fa, THREAD, 'th_1_数据.json', '{rows: 42}')).rejects.toBeInstanceOf(
      ContentFormatError,
    );
    expect(writes).toHaveLength(0);
  });

  it('空 JSON → ContentFormatError（提示内容为空，而不是解析器的内部报错）', async () => {
    const { fa } = stubAccess();

    await expect(writeToolFile(fa, THREAD, 'th_1_数据.json', '   ')).rejects.toThrow(/内容为空/);
  });

  it('CSV 引号未闭合 → ContentFormatError，零写入', async () => {
    const { fa, writes } = stubAccess();

    await expect(
      writeToolFile(fa, THREAD, 'th_1_明细.csv', '名称,备注\nA,"未闭合\n'),
    ).rejects.toBeInstanceOf(ContentFormatError);
    expect(writes).toHaveLength(0);
  });

  it('CSV 引号内的 `""` 是转义，不算未闭合', async () => {
    const { fa, writes } = stubAccess();

    await writeToolFile(fa, THREAD, 'th_1_明细.csv', 'a,b\n"他说""你好""",1\n');

    expect(writes).toHaveLength(1);
  });
});

describe('writeToolFile —— 二进制格式（二期 `.xlsx` / 三期 `.pdf`）', () => {
  it('.xlsx：CSV 行数据 → xlsx 容器字节，bytes 取落盘大小', async () => {
    const { fa, writes } = stubAccess();

    const result = await writeToolFile(fa, THREAD, 'th_1_汇总.xlsx', '物料,数量\nA,10\n');

    expect(result.mode).toBe('xlsx');
    expect(writes[0]?.data.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(result.bytes).toBe(writes[0]?.data.length);
    // 编码后的字节数与原文长度无关——这正是"不能用 content 长度当 bytes"的原因
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('.xlsx 表格源非法（空内容）→ ContentFormatError，零写入', async () => {
    const { fa, writes } = stubAccess();

    await expect(writeToolFile(fa, THREAD, 'th_1_空.xlsx', '  \n')).rejects.toBeInstanceOf(
      ContentFormatError,
    );
    expect(writes).toHaveLength(0);
  });

  it('.pdf：受限 Markdown → PDF 容器字节', async () => {
    const { fa, writes } = stubAccess();

    const result = await writeToolFile(fa, THREAD, 'th_1_报告.pdf', '# 月报\n\n产量 1200 件\n');

    expect(result.mode).toBe('pdf');
    expect(writes[0]?.data.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(result.bytes).toBe(writes[0]?.data.length);
  });

  it('.pdf 空内容 → ContentFormatError，零写入', async () => {
    const { fa, writes } = stubAccess();

    await expect(writeToolFile(fa, THREAD, 'th_1_空.pdf', '   ')).rejects.toBeInstanceOf(
      ContentFormatError,
    );
    expect(writes).toHaveLength(0);
  });
});

describe('writeToolFile —— 体积上限', () => {
  it('超过注入的上限 → WriteTooLargeError，零写入', async () => {
    const { fa, writes } = stubAccess();

    await expect(
      writeToolFile(fa, THREAD, 'th_1_大.txt', 'x'.repeat(5), { maxBytes: 4 }),
    ).rejects.toBeInstanceOf(WriteTooLargeError);
    expect(writes).toHaveLength(0);
  });

  it('恰好等于上限 → 放行（判据是"超过"而非"达到"）', async () => {
    const { fa, writes } = stubAccess();

    const result = await writeToolFile(fa, THREAD, 'th_1_刚好.txt', '1234', { maxBytes: 4 });

    expect(result.bytes).toBe(4);
    expect(writes).toHaveLength(1);
  });

  it('未注入上限时取 5MB 兜底（与生产缺省 PREVIEW_MAX_MB 对齐）', () => {
    expect(DEFAULT_WRITE_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});
