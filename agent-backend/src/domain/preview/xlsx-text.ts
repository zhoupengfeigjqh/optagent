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
