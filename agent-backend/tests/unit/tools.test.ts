/**
 * 内置工具单元测试（T036）：
 * - read_file：csv/txt/json 直读、xlsx→CSV、pdf 文本层提取、无文本层友好提示、
 *   32KB 截断 + offset/limit 分段、不支持的格式明确拒绝
 * - write_file：仅 tmp + thread_id 前缀强制
 * - list_dir：白名单目录列举
 * - grep_files：跳过二进制并注明数量
 * - calculator：正常求值 + 拒绝非表达式注入
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureUserDirs, userDataDir } from '../../src/domain/dirs';
import { FileAccess, PermissionError } from '../../src/domain/file-access';
import { readToolFile } from '../../src/domain/tools/read-file';
import { writeToolFile } from '../../src/domain/tools/write-file';
import { listToolDir } from '../../src/domain/tools/list-dir';
import { grepToolFiles } from '../../src/domain/tools/grep-files';
import { calcTool, evaluateExpression } from '../../src/domain/tools/calculator';

/** 构造带文本层的最小单页 PDF（手工计算 xref 偏移） */
function makeTextPdf(text: string): Buffer {
  const content = `BT /F1 24 Tf 100 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

describe('内置工具（US3）', () => {
  let root: string;
  let fa: FileAccess;
  const dataDir = () => userDataDir(root, 'admin');

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-tools-'));
    ensureUserDirs(root, 'admin');
    fa = new FileAccess({ optAgentRoot: root, userId: 'admin', truncateKb: 1 }); // 1KB 便于测截断
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe('read_file', () => {
    it('csv/txt/json 直读', async () => {
      writeFileSync(path.join(dataDir(), '生产计划', 'a.csv'), '产品,数量\nA,10');
      writeFileSync(path.join(dataDir(), '使用规则', 'r.txt'), '规则一');
      writeFileSync(path.join(dataDir(), 'shared', 'd.json'), '{"k":1}');
      expect((await readToolFile(fa, '生产计划/a.csv')).text).toContain('产品,数量');
      expect((await readToolFile(fa, '使用规则/r.txt')).text).toBe('规则一');
      expect((await readToolFile(fa, 'shared/d.json')).text).toBe('{"k":1}');
    });

    it('xlsx 逐 sheet 转 CSV', async () => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([
          ['产品', '数量'],
          ['A', 10],
        ]),
        '计划',
      );
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['线体'], ['L1']]), '产线');
      writeFileSync(
        path.join(dataDir(), '生产计划', 'p.xlsx'),
        XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }),
      );
      const r = await readToolFile(fa, '生产计划/p.xlsx');
      expect(r.text).toContain('### Sheet: 计划');
      expect(r.text).toContain('产品,数量');
      expect(r.text).toContain('A,10');
      expect(r.text).toContain('### Sheet: 产线');
    });

    it('pdf 提取文本层', async () => {
      writeFileSync(path.join(dataDir(), 'shared', 'doc.pdf'), makeTextPdf('Hello PDF'));
      const r = await readToolFile(fa, 'shared/doc.pdf');
      expect(r.text).toContain('Hello PDF');
    });

    it('pdf 无文本层 → 友好提示', async () => {
      // 无 Contents 的页：无文本可提取
      const noText = makeTextPdf('')
        .toString('latin1')
        .replace(/BT .* ET/, '');
      writeFileSync(path.join(dataDir(), 'shared', 'scan.pdf'), Buffer.from(noText, 'latin1'));
      const r = await readToolFile(fa, 'shared/scan.pdf');
      expect(r.text).toContain('没有可提取的文本层');
    });

    it('超截断上限 → 截断并给出 offset 提示；offset 分段续读', async () => {
      writeFileSync(path.join(dataDir(), '使用规则', 'big.txt'), 'x'.repeat(1500));
      const first = await readToolFile(fa, '使用规则/big.txt');
      expect(first.truncated).toBe(true);
      expect(first.totalSize).toBe(1500);
      expect(first.text).toContain('内容已截断');
      expect(first.text).toContain('offset=1024');
      const rest = await readToolFile(fa, '使用规则/big.txt', { offset: 1024 });
      expect(rest.truncated).toBe(false);
      expect(rest.text).toBe('x'.repeat(476));
    });

    it('不支持的格式 → 明确提示支持范围', async () => {
      writeFileSync(path.join(dataDir(), 'tmp', 'a.exe'), 'MZ');
      const r = await readToolFile(fa, 'tmp/a.exe');
      expect(r.text).toContain('不支持的文件格式');
    });

    it('路径穿越 → PermissionError', async () => {
      await expect(readToolFile(fa, '../etc/passwd.txt')).rejects.toBeInstanceOf(PermissionError);
    });
  });

  describe('write_file', () => {
    it('写入 tmp 且强制 thread_id 前缀，返回相对路径', async () => {
      const r = await writeToolFile(fa, 't-1', 't-1_结果.csv', 'a,b');
      expect(r.path).toBe('tmp/t-1_结果.csv');
      expect(r.bytes).toBe(3);
    });

    it('缺 thread_id 前缀 → PermissionError', async () => {
      await expect(writeToolFile(fa, 't-1', '结果.csv', 'x')).rejects.toBeInstanceOf(
        PermissionError,
      );
      await expect(writeToolFile(fa, 't-1', 't-2_结果.csv', 'x')).rejects.toBeInstanceOf(
        PermissionError,
      );
    });

    it('试图写入业务目录（带子路径）→ PermissionError', async () => {
      await expect(
        writeToolFile(fa, 't-1', '../生产计划/t-1_结果.csv', 'x'),
      ).rejects.toBeInstanceOf(PermissionError);
    });
  });

  describe('list_dir', () => {
    it('列出白名单目录内容', async () => {
      writeFileSync(path.join(dataDir(), '生产计划', 'a.csv'), 'x');
      const text = await listToolDir(fa, '生产计划');
      expect(text).toContain('a.csv');
      expect(text).toContain('共 1 项');
    });
    it('空目录与非白名单目录', async () => {
      expect(await listToolDir(fa, 'tmp')).toContain('为空');
      await expect(listToolDir(fa, 'threads')).rejects.toBeInstanceOf(PermissionError);
    });
  });

  describe('grep_files', () => {
    it('命中文本文件；跳过 xlsx/pdf 并注明数量', async () => {
      writeFileSync(path.join(dataDir(), '生产计划', 'a.csv'), '苹果,10\n香蕉,20');
      writeFileSync(path.join(dataDir(), '生产计划', 'b.xlsx'), Buffer.from([0x50, 0x4b, 1, 2]));
      const text = await grepToolFiles(fa, '苹果', '生产计划');
      expect(text).toContain('生产计划/a.csv:1');
      expect(text).toContain('已跳过 1 个二进制文件');
    });
    it('无命中与非法表达式', async () => {
      expect(await grepToolFiles(fa, '不存在词', '生产计划')).toContain('未找到');
      await expect(grepToolFiles(fa, '([', '生产计划')).rejects.toBeInstanceOf(PermissionError);
    });
  });

  describe('calculator', () => {
    it('四则运算/括号/幂/函数/常量', () => {
      expect(evaluateExpression('1+2*3')).toBe(7);
      expect(evaluateExpression('(1+2)*3')).toBe(9);
      expect(evaluateExpression('2^10')).toBe(1024);
      expect(evaluateExpression('-3 + abs(-5)')).toBe(2);
      expect(evaluateExpression('sqrt(16) + max(1, 9)')).toBe(13);
      expect(evaluateExpression('10 % 3')).toBe(1);
      expect(calcTool('1+1')).toBe('1+1 = 2');
    });
    it('拒绝非表达式注入', () => {
      for (const bad of [
        'process.exit(1)',
        'require("fs")',
        'a=1',
        '1;2',
        'while(1){}',
        'globalThis',
        '${7*7}',
        '1 +',
        '(1+2',
        '',
      ]) {
        expect(() => evaluateExpression(bad)).toThrow();
      }
    });
    it('除零与结果溢出拒绝', () => {
      expect(() => evaluateExpression('1/0')).toThrow('除数为 0');
      expect(() => evaluateExpression('10^9999')).toThrow();
    });
  });
});
