import { describe, expect, it } from 'vitest';

import {
  FALLBACK_WRITE_MODE,
  resolveWriteMode,
  supportedExtensions,
} from '../../src/domain/tools/write-modes.js';

describe('resolveWriteMode —— 已登记扩展名', () => {
  it.each([
    ['th_1_说明.txt', 'text'],
    ['th_1_分析.md', 'markdown'],
    ['th_1_看板.html', 'html'],
    ['th_1_明细.csv', 'csv'],
    ['th_1_数据.json', 'json'],
    ['th_1_汇总.xlsx', 'xlsx'],
    ['th_1_报告.pdf', 'pdf'],
  ])('%s → %s', (filename, expected) => {
    expect(resolveWriteMode(filename).name).toBe(expected);
  });

  it('扩展名大小写不敏感', () => {
    expect(resolveWriteMode('REPORT.MD').name).toBe('markdown');
    expect(resolveWriteMode('REPORT.Json').name).toBe('json');
  });

  it('只取最后一段扩展名（archive.tar.gz → .gz 未登记 → 回落文本）', () => {
    expect(resolveWriteMode('th_1_a.tar.gz')).toBe(FALLBACK_WRITE_MODE);
  });
});

describe('resolveWriteMode —— 未登记扩展名回落文本', () => {
  it.each(['th_1_日志.log', 'th_1_配置.yaml', 'th_1_脚本.sh', 'th_1_无扩展名'])(
    '%s → 文本模式（本期不拒绝）',
    (filename) => {
      const mode = resolveWriteMode(filename);
      expect(mode.name).toBe('text');
      expect(mode.contentFormat).toBe('text');
    },
  );

  it('回落模式的编码就是 utf8 原样（与改造前完全一致）', () => {
    const buf = resolveWriteMode('th_1_x.log').encode('第一行\n第二行');
    expect(buf.toString('utf8')).toBe('第一行\n第二行');
  });

  it('.xls 走回落文本：BIFF8 容器不在此列，写出来只能当文本（描述里已点名改用 .xlsx）', () => {
    expect(resolveWriteMode('th_1_总BOM.xls').name).toBe('text');
  });
});

describe('二进制格式（二期 `.xlsx` / 三期 `.pdf`）', () => {
  it('.xlsx 命中 table 模式：validate 复用表格源校验', () => {
    const mode = resolveWriteMode('th_1_汇总.xlsx');

    expect(mode.contentFormat).toBe('table');
    expect(mode.validate?.('物料,数量\nA,10')).toBeNull();
    expect(mode.validate?.('')).toContain('内容为空');
  });

  it('.xlsx encode 直接产出 xlsx 容器字节（zip 魔数 PK）', () => {
    const buf = resolveWriteMode('th_1_汇总.xlsx').encode('物料,数量\nA,10\n') as Buffer;

    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('.pdf 命中 doc 模式：encode 为异步（pdfkit 流式产出）', async () => {
    const mode = resolveWriteMode('th_1_报告.pdf');

    expect(mode.contentFormat).toBe('doc');
    const pending = mode.encode('# 标题\n\n正文');
    expect(pending).toBeInstanceOf(Promise);
    const buf = await pending;
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('.pdf 的 validate 拦空内容与不可打印控制字符', () => {
    const mode = resolveWriteMode('th_1_报告.pdf');

    expect(mode.validate?.('   ')).toContain('内容为空');
    expect(mode.validate?.('标题\u0001正文')).toContain('控制字符');
    expect(mode.validate?.('# 标题\n正文')).toBeNull();
  });
});

describe('supportedExtensions', () => {
  it('与注册表同源：七个已登记扩展名，顺序即展示顺序', () => {
    expect(supportedExtensions()).toEqual([
      '.txt',
      '.md',
      '.html',
      '.csv',
      '.json',
      '.xlsx',
      '.pdf',
    ]);
  });

  it('每个清单项都能被解析回非回落模式（清单不会与注册表漂移）', () => {
    for (const ext of supportedExtensions()) {
      expect(resolveWriteMode(`th_1_x${ext}`)).not.toBe(FALLBACK_WRITE_MODE);
    }
  });
});
