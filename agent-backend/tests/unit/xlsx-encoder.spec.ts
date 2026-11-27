import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { xlsxToText } from '../../src/domain/preview/xlsx-text.js';
import { encodeXlsx, parseTableSource } from '../../src/domain/tools/encoders/xlsx.js';

function readBack(buf: Buffer): Record<string, string[][]> {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const out: Record<string, string[][]> = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    out[name] = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' });
  }
  return out;
}

describe('parseTableSource —— 结构解析', () => {
  it('单表 CSV：按行按列切开，未加引号的单元格去首尾空白', () => {
    const parsed = parseTableSource('物料, 数量\nA, 10\nB, 20\n');

    expect(parsed).toEqual({
      ok: true,
      sheets: [
        {
          name: 'Sheet1',
          rows: [
            ['物料', '数量'],
            ['A', '10'],
            ['B', '20'],
          ],
        },
      ],
    });
  });

  it('引号内的逗号、换行、`""` 转义都保留原样', () => {
    const parsed = parseTableSource('名称,备注\n"含,逗号","第一行\n第二行"\n"他说""你好""",ok\n');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.sheets[0]?.rows).toEqual([
      ['名称', '备注'],
      ['含,逗号', '第一行\n第二行'],
      ['他说"你好"', 'ok'],
    ]);
  });

  it('`# Sheet: 名称` 分段 → 多个工作表', () => {
    const parsed = parseTableSource(
      '# Sheet: 物料\n物料,数量\nA,10\n# Sheet: 成本\n项,金额\n人工,1000\n',
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.sheets.map((sheet) => sheet.name)).toEqual(['物料', '成本']);
    expect(parsed.sheets[1]?.rows).toEqual([
      ['项', '金额'],
      ['人工', '1000'],
    ]);
  });

  it('首个标记之前的内容自成一段（无名 → Sheet1）', () => {
    const parsed = parseTableSource('前言,值\nx,1\n# Sheet: 明细\na,b\n1,2\n');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.sheets.map((sheet) => sheet.name)).toEqual(['Sheet1', '明细']);
  });

  it('参差行补空串成矩形（Excel 里就是空白单元格）', () => {
    const parsed = parseTableSource('a,b,c\n1,2\n');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.sheets[0]?.rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', ''],
    ]);
  });

  it('全空行被丢弃（模型常在末尾留空行）', () => {
    const parsed = parseTableSource('a,b\n\n\n1,2\n\n');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.sheets[0]?.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseTableSource —— 校验与命名', () => {
  it('空内容 → 明确错误（提示可用 `# Sheet:` 分段）', () => {
    const parsed = parseTableSource('   \n\n');

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('内容为空');
  });

  it('引号未闭合 → 明确错误', () => {
    const parsed = parseTableSource('a,b\n"未闭合,2\n');

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('引号未闭合');
  });

  it('只有空白单元格 → 视为没有表格行', () => {
    const parsed = parseTableSource(',,\n,,\n');

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('没有可识别的表格行');
  });

  it('表名非法字符改写为 `_`，超长截断到 31 字符', () => {
    const parsed = parseTableSource(`# Sheet: 报/表[2026]:Q1\n a,b\n1,2\n`);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.sheets[0]?.name).toBe('报_表_2026__Q1');

    const long = parseTableSource(`# Sheet: ${'长'.repeat(40)}\na\n1\n`);
    expect(long.ok).toBe(true);
    if (!long.ok) return;
    expect(long.sheets[0]?.name).toHaveLength(31);
  });

  it('重名表 → 追加 `(2)` 而不是报错', () => {
    const parsed = parseTableSource('# Sheet: 数据\na\n1\n# Sheet: 数据\nb\n2\n');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.sheets.map((sheet) => sheet.name)).toEqual(['数据', '数据(2)']);
  });
});

describe('encodeXlsx —— 往返与安全', () => {
  it('往返一致：编码后读回的行列与输入等价', () => {
    const buf = encodeXlsx('# Sheet: 物料\n物料,数量\nA,10\n# Sheet: 成本\n项,金额\n人工,1000\n');

    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
    const sheets = readBack(buf);
    expect(Object.keys(sheets)).toEqual(['物料', '成本']);
    expect(sheets['物料']).toEqual([
      ['物料', '数量'],
      ['A', '10'],
    ]);
  });

  it('写读共用同一口径：xlsxToText 能看到 sheet 分段与单元格内容', () => {
    const text = xlsxToText(encodeXlsx('物料,数量\nA,10\n'));

    expect(text).toContain('### Sheet: Sheet1');
    expect(text).toContain('物料,数量');
    expect(text).toContain('A,10');
  });

  it('公式注入载荷落成字符串单元格，不产生公式（`f` 字段不存在）', () => {
    const buf = encodeXlsx('名称,值\n=cmd|\'/c calc\'!A0,1\n@SUM(1+1),2\n-1+1,3\n');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]!]!;

    for (const addr of ['A2', 'A3', 'A4']) {
      const cell = ws[addr] as XLSX.CellObject | undefined;
      expect(cell?.t).toBe('s');
      expect(cell?.f).toBeUndefined();
    }
    expect((ws.A2 as XLSX.CellObject).v).toBe("=cmd|'/c calc'!A0");
  });

  it('数字样内容仍是字符串（不悄悄变成数值，避免前导零丢失）', () => {
    const sheets = readBack(encodeXlsx('编码,数量\n0012,3\n'));
    expect(sheets['Sheet1']?.[1]).toEqual(['0012', '3']);
  });

  it('中文与英文混排都能正常往返（编码不是 UTF-16 或拉丁 1）', () => {
    const text = xlsxToText(encodeXlsx('名称,说明\n产线A,停机 2 小时\n'));
    expect(text).toContain('产线A,停机 2 小时');
  });
});
