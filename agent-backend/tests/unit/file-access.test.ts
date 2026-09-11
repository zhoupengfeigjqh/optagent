import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureUserDirs, userDataDir } from '../../src/domain/dirs';
import { FileAccess, PermissionError } from '../../src/domain/file-access';

describe('FileAccess 权限矩阵与路径安全', () => {
  let root: string;
  let fa: FileAccess;
  const data = () => userDataDir(root, 'admin');

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-fa-'));
    ensureUserDirs(root, 'admin');
    fa = new FileAccess({ optAgentRoot: root, userId: 'admin' });
    writeFileSync(path.join(data(), '生产计划', 'plan.csv'), 'id,数量\n1,100\n');
    writeFileSync(path.join(data(), 'shared', 'note.txt'), 'hello shared');
    writeFileSync(path.join(data(), 'tmp', 't1_out.txt'), 'tmp content');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe('读权限：7 业务目录 + shared + tmp 均可读', () => {
    it.each(['生产计划/plan.csv', 'shared/note.txt', 'tmp/t1_out.txt'])('可读 %s', async (p) => {
      const r = await fa.read(p);
      expect(r.content.length).toBeGreaterThan(0);
      expect(r.truncated).toBe(false);
    });

    it('读取不存在的文件 → PermissionError', async () => {
      await expect(fa.read('生产计划/nope.csv')).rejects.toThrow(PermissionError);
    });

    it('读 tmp 文件刷新 mtime（7 天清理依据）', async () => {
      const file = path.join(data(), 'tmp', 't1_out.txt');
      const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
      fs.utimesSync(file, old, old);
      await fa.read('tmp/t1_out.txt');
      expect(fs.statSync(file).mtime.getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

    it('截断与 offset/limit', async () => {
      writeFileSync(path.join(data(), 'shared', 'big.txt'), 'a'.repeat(5000));
      const faSmall = new FileAccess({ optAgentRoot: root, userId: 'admin', truncateKb: 1 });
      const r = await faSmall.read('shared/big.txt');
      expect(r.truncated).toBe(true);
      expect(r.content.length).toBe(1024);
      const r2 = await faSmall.read('shared/big.txt', { offset: 1024, limit: 100 });
      expect(r2.content).toBe('a'.repeat(100));
    });
  });

  describe('写权限：仅 tmp + thread_id 前缀', () => {
    it('写 tmp 合规文件成功并返回相对路径', async () => {
      const rel = await fa.write('t1', 't1_result.txt', 'ok');
      expect(rel).toBe('tmp/t1_result.txt');
      expect(fs.readFileSync(path.join(data(), 'tmp', 't1_result.txt'), 'utf8')).toBe('ok');
    });

    it('无 thread_id 前缀 → 拒绝', async () => {
      await expect(fa.write('t1', 'result.txt', 'x')).rejects.toThrow(PermissionError);
    });

    it('带子目录的写入 → 拒绝（扁平文件名）', async () => {
      await expect(fa.write('t1', 'sub/t1_x.txt', 'x')).rejects.toThrow(PermissionError);
    });

    it('伪造前缀写业务目录 → 拒绝', async () => {
      await expect(fa.write('t1', '../生产计划/t1_x.txt', 'x')).rejects.toThrow(PermissionError);
    });
  });

  describe('路径穿越攻击', () => {
    it.each([
      '../escape.txt',
      'tmp/../../escape.txt',
      'tmp/../../../etc/passwd',
      '/etc/passwd',
      'C:/Windows/win.ini',
      '生产计划/../../users/other/secret.txt',
    ])('拒绝 %s', async (p) => {
      await expect(fa.read(p)).rejects.toThrow(PermissionError);
    });

    it('白名单外目录 → 拒绝', async () => {
      await expect(fa.read('threads/t1/history.jsonl')).rejects.toThrow(PermissionError);
      await expect(fa.list('agents')).rejects.toThrow(PermissionError);
    });

    it('符号链接/junction 穿越 → 拒绝', () => {
      // Windows 文件 symlink 需特权，用目录 junction 等价验证 realpath 校验
      const outsideDir = path.join(root, 'outside');
      fs.mkdirSync(outsideDir);
      writeFileSync(path.join(outsideDir, 'secret.txt'), 'secret');
      symlinkSync(outsideDir, path.join(data(), 'tmp', 'linkdir'), 'junction');
      return expect(fa.read('tmp/linkdir/secret.txt')).rejects.toThrow(PermissionError);
    });
  });

  describe('list', () => {
    it('列出业务目录内容', async () => {
      const entries = await fa.list('生产计划');
      expect(entries).toHaveLength(1);
      expect(entries[0]!.name).toBe('plan.csv');
      expect(entries[0]!.isDirectory).toBe(false);
    });

    it('目录不存在 → PermissionError', async () => {
      await expect(fa.list('tmp/不存在')).rejects.toThrow(PermissionError);
    });
  });

  describe('grep', () => {
    beforeEach(() => {
      writeFileSync(path.join(data(), '生产计划', 'a.json'), '{"k": "目标值ABC"}');
      writeFileSync(path.join(data(), 'tmp', 't1_b.txt'), '第二行有ABC\n');
      writeFileSync(path.join(data(), 'tmp', 't1_c.xlsx'), Buffer.from([0x50, 0x4b]));
    });

    it('跨白名单目录检索文本文件', async () => {
      const r = await fa.grep('ABC');
      expect(r.matches.length).toBeGreaterThanOrEqual(2);
      expect(r.matches.map((m) => m.file).sort()).toContain('生产计划/a.json');
    });

    it('跳过二进制并计数', async () => {
      const r = await fa.grep('ABC', 'tmp');
      expect(r.skippedBinary).toBe(1);
      expect(r.matches.every((m) => !m.file.endsWith('.xlsx'))).toBe(true);
    });

    it('限定目录检索', async () => {
      const r = await fa.grep('数量', '生产计划');
      expect(r.matches).toHaveLength(1);
      expect(r.matches[0]!.line).toBe(1);
    });

    it('非法正则 → PermissionError', async () => {
      await expect(fa.grep('([未闭合')).rejects.toThrow(PermissionError);
    });
  });
});
