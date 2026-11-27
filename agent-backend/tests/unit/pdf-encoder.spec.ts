import { describe, expect, it } from 'vitest';

import type { FileAccess } from '../../src/domain/file-access.js';
import { encodePdf, parsePdfBlocks, validatePdfSource } from '../../src/domain/tools/encoders/pdf.js';
import { readToolFile } from '../../src/domain/tools/read-file.js';

function accessOf(buf: Buffer): FileAccess {
  return {
    truncateBytes: 128 * 1024,
    assertPathAllowed: () => {},
    readBuffer: async () => buf,
  } as unknown as FileAccess;
}

describe('validatePdfSource', () => {
  it('空内容 → 明确错误（提示受限 Markdown 的写法）', () => {
    expect(validatePdfSource('  \n')).toContain('内容为空');
  });

  it('含不可打印控制字符 → 拒绝（保留 \\t \\n \\r）', () => {
    expect(validatePdfSource('标题\u0007正文')).toContain('控制字符');
    expect(validatePdfSource('标题\t正文\n第二段\r\n')).toBeNull();
  });

  it('普通 Markdown → 通过', () => {
    expect(validatePdfSource('# 月报\n\n产量 1200 件\n')).toBeNull();
  });
});

describe('parsePdfBlocks —— 受限 Markdown 映射', () => {
  it('标题按 `#` 个数分级', () => {
    const blocks = parsePdfBlocks('# 一级\n## 二级\n### 三级\n');

    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: '一级' },
      { kind: 'heading', level: 2, text: '二级' },
      { kind: 'heading', level: 3, text: '三级' },
    ]);
  });

  it('空行分段：多行合并为一个段落', () => {
    const blocks = parsePdfBlocks('第一句\n第二句\n\n另一段\n');

    expect(blocks).toEqual([
      { kind: 'paragraph', text: '第一句 第二句' },
      { kind: 'paragraph', text: '另一段' },
    ]);
  });

  it('列表：`-` 与 `1.` 都归为条目，标记不落进正文', () => {
    const blocks = parsePdfBlocks('- 甲\n* 乙\n1. 丙\n');

    expect(blocks).toEqual([
      { kind: 'bullet', text: '甲' },
      { kind: 'bullet', text: '乙' },
      { kind: 'bullet', text: '丙' },
    ]);
  });

  it('表格：分隔行 `|---|` 被丢弃，单元格去空白', () => {
    const blocks = parsePdfBlocks('| 物料 | 数量 |\n|---|---|\n| A | 10 |\n');

    expect(blocks).toEqual([
      {
        kind: 'table',
        rows: [
          ['物料', '数量'],
          ['A', '10'],
        ],
      },
    ]);
  });

  it('不认识的行不吞内容（当段落处理）', () => {
    const blocks = parsePdfBlocks('> 引用样式\n');

    expect(blocks).toEqual([{ kind: 'paragraph', text: '> 引用样式' }]);
  });
});

describe('encodePdf —— 产出与中文往返', () => {
  it('产出合法 PDF 头，且体积非空', async () => {
    const buf = await encodePdf('# 月报\n\n产量 1200 件\n');

    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(-1024).toString('latin1')).toContain('%%EOF');
  });

  it('中文可被读侧解析回来（字体嵌入 + ToUnicode 生效）', async () => {
    const buf = await encodePdf('# 月度产能报告\n\n产线A 停机 2 小时，产量 1200 件。\n');

    const result = await readToolFile(accessOf(buf), '临时空间/th_1_报告.pdf');

    expect(result.text).toContain('月度产能报告');
    expect(result.text).toContain('产线A');
    expect(result.text).toContain('1200');
  });

  it('表格与列表都能落到文本层（不被排版吞掉）', async () => {
    const buf = await encodePdf(
      '## 明细\n\n| 物料 | 数量 |\n|---|---|\n| A | 10 |\n\n- 备注一\n- 备注二\n',
    );

    const result = await readToolFile(accessOf(buf), '临时空间/th_1_明细.pdf');

    expect(result.text).toContain('明细');
    expect(result.text).toContain('物料');
    expect(result.text).toContain('10');
    expect(result.text).toContain('备注二');
  });

  it('超长内容自动分页，不抛错', async () => {
    const paragraph = '这是一段用于验证自动分页的中文内容，重复出现以撑满页面。'.repeat(20);
    const buf = await encodePdf(Array.from({ length: 8 }, (_, i) => `## 第 ${i + 1} 节\n\n${paragraph}`).join('\n\n'));

    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(10000);
  });
});
