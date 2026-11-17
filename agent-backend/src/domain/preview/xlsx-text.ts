/**
 * Excel → 逐 sheet CSV 文本（2026-11-16 从 `domain/tools/read-file.ts` 抽出）。
 *
 * 抽出的原因：**两个调用方**都要它——
 * 1. `read_file` 工具：`.xlsx` / `.xls` 解析成文本交给模型；
 * 2. `GET /api/files/preview`：`.xlsx` 内联预览（前端不引入解析库，服务端转 CSV 文本）。
 *
 * 输出形态是既定口径：每个 sheet 前加 `### Sheet: 名称`，与 `grep`/模型阅读习惯一致，
 * 也让"预览里看到的分段"与"模型读到的分段"完全同构。
 */
import * as XLSX from 'xlsx';

export function xlsxToText(buf: Buffer): string {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    parts.push(`### Sheet: ${name}\n${XLSX.utils.sheet_to_csv(ws)}`);
  }
  return parts.length > 0 ? parts.join('\n\n') : '该 Excel 文件没有任何工作表';
}
