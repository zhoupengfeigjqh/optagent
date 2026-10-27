/**
 * upload-name 模块单测（012）：落盘命名 = **原名** / `原名(n).ext`（半角括号，紧贴主名）
 *
 * 运行方式（本地执行；容器只负责部署，见宪章原则三 / 原则八）：
 *   npm run test:all   # 全部测试
 *   npm run test       # 仅本目录单测
 *
 * 覆盖变更的核心约束（012 FR-020~FR-028）：
 * - 不重名 ⇒ 原名（**不再**追加 `_YYYYMMDD_HHMMSS`）；
 * - 重名 ⇒ 取"当前目录内未被占用的最小正整数"编号，扩展名保持在末尾（`a.tar(1).gz`）；
 * - 并发唯一性靠**排他占名**（`linkSync` / `COPYFILE_EXCL`）：已存在即失败，**绝不覆盖**；
 * - 编号有界（`MAX_NAME_ATTEMPTS`）：用尽抛 `UploadNameConflictError`（路由映射 409）。
 *
 * 说明：`tests/` 不在 tsconfig 的 include 内（不参与构建），此处用无扩展名导入，
 * 由 Vitest 解析到 `src/domain/upload-name.ts`。
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  MAX_BASE_CHARS,
  MAX_NAME_ATTEMPTS,
  UploadNameConflictError,
  candidateName,
  claimName,
  splitName,
} from '../../src/domain/upload-name';

const root = mkdtempSync(path.join(tmpdir(), 'optagent-upload-name-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let seq = 0;
/** 造一个暂存文件（每次调用都新建：占名成功会删掉暂存名） */
function stage(content: string): string {
  seq += 1;
  const file = path.join(root, `.staging-${seq}`);
  writeFileSync(file, content, 'utf8');
  return file;
}

function dir(name: string): string {
  const abs = path.join(root, name);
  mkdirSync(abs, { recursive: true });
  return abs;
}

describe('splitName：主名 / 扩展名切分（沿用 path.extname 语义）', () => {
  it.each([
    ['报告.csv', '报告', '.csv'],
    ['a.tar.gz', 'a.tar', '.gz'],
    ['README', 'README', ''],
    ['.env', '.env', ''],
    // 目录段由 `basename` 先剥掉（`/\` 替换是防御性的，Windows 上 basename 已同时识别两种分隔符）
    ['子目录/数据.csv', '数据', '.csv'],
    ['', 'file', ''],
  ])('%s ⇒ stem=%s ext=%s', (original, stem, ext) => {
    expect(splitName(original)).toEqual({ stem, ext });
  });
});

describe('candidateName：原名 / 原名(n).ext', () => {
  it('index 0 是原名（无时间戳、无编号）', () => {
    expect(candidateName('报告.csv', 0)).toBe('报告.csv');
  });

  it('index n 在扩展名前插 (n)，半角括号紧贴主名', () => {
    expect(candidateName('报告.csv', 1)).toBe('报告(1).csv');
    expect(candidateName('报告.csv', 2)).toBe('报告(2).csv');
    expect(candidateName('报告.csv', 12)).toBe('报告(12).csv');
  });

  it('多点扩展名 / 无扩展名 / 隐藏文件：编号只插在最后一个扩展名前', () => {
    expect(candidateName('a.tar.gz', 1)).toBe('a.tar(1).gz');
    expect(candidateName('README', 1)).toBe('README(1)');
    expect(candidateName('.env', 1)).toBe('.env(1)');
  });

  it('控制字符不剥离（沿用既有 basename 清洗口径，FR-027）', () => {
    // 只处理 basename 与 `/`、`\`；换行/制表按原样保留（与改动前一致，不扩大清洗范围）
    expect(candidateName('a\nb.csv', 0)).toBe('a\nb.csv');
  });

  it('超长主名按 MAX_BASE_CHARS 截断（给编号与扩展名留位）', () => {
    const long = `${'长'.repeat(MAX_BASE_CHARS + 50)}.csv`;
    const name = candidateName(long, 1);
    expect(Array.from(name).indexOf('(')).toBeGreaterThanOrEqual(0);
    expect(Array.from(name).length).toBeLessThanOrEqual(
      MAX_BASE_CHARS + '(9999)'.length + '.csv'.length,
    );
    expect(name.endsWith('(1).csv')).toBe(true);
  });
});

describe('claimName：排他占名（并发零覆盖）', () => {
  it('不重名 ⇒ 原名落盘，内容正确，暂存文件被清掉', () => {
    const abs = dir('原名');
    const staging = stage('内容A');

    const name = claimName(abs, '报告.csv', staging);

    expect(name).toBe('报告.csv');
    expect(readFileSync(path.join(abs, name), 'utf8')).toBe('内容A');
    expect(existsSync(staging)).toBe(false);
  });

  it('连续同名 ⇒ (1)、(2)，且已存在文件内容不被改写', () => {
    const abs = dir('连续');
    expect(claimName(abs, '报告.csv', stage('第一版'))).toBe('报告.csv');
    expect(claimName(abs, '报告.csv', stage('第二版'))).toBe('报告(1).csv');
    expect(claimName(abs, '报告.csv', stage('第三版'))).toBe('报告(2).csv');

    // 零覆盖：三份内容各自保留
    expect(readFileSync(path.join(abs, '报告.csv'), 'utf8')).toBe('第一版');
    expect(readFileSync(path.join(abs, '报告(1).csv'), 'utf8')).toBe('第二版');
    expect(readFileSync(path.join(abs, '报告(2).csv'), 'utf8')).toBe('第三版');
  });

  it('编号稀疏 ⇒ 取最小可用（删除 (1) 后补回 (1)，不跳号到 (3)）', () => {
    const abs = dir('稀疏');
    claimName(abs, 'a.csv', stage('1'));
    claimName(abs, 'a.csv', stage('2'));
    claimName(abs, 'a.csv', stage('3'));
    unlinkSync(path.join(abs, 'a(1).csv'));

    expect(claimName(abs, 'a.csv', stage('4'))).toBe('a(1).csv');
  });

  it('大小写冲突按目标文件系统语义（Windows/macOS 不敏感 ⇒ 编号，Linux 敏感 ⇒ 原名）', () => {
    const abs = dir('大小写');
    claimName(abs, 'Report.csv', stage('original'));

    const name = claimName(abs, 'report.csv', stage('second'));
    if (process.platform === 'win32' || process.platform === 'darwin') {
      expect(name).toBe('report(1).csv');
    } else {
      expect(name).toBe('report.csv');
    }
    // 无论哪种语义，原文件内容都不得被覆盖
    expect(readFileSync(path.join(abs, 'Report.csv'), 'utf8')).toBe('original');
  });

  it('候选名用尽 ⇒ 抛 UploadNameConflictError（有界重试，不无限循环）', () => {
    const abs = dir('用尽');
    claimName(abs, 'x.csv', stage('0'));
    claimName(abs, 'x.csv', stage('1'));

    // maxAttempts = 1：只允许"原名 + (1)"两次尝试，两者都被占用 ⇒ 显式失败
    expect(() => claimName(abs, 'x.csv', stage('2'), 1)).toThrow(UploadNameConflictError);
    // 暂存文件保持原样（由调用方清理），不得凭空消失
    expect(existsSync(path.join(abs, 'x.csv'))).toBe(true);
    expect(readdirSync(abs).sort()).toEqual(['x(1).csv', 'x.csv']);
  });

  it('上限常量足够大但不无限', () => {
    expect(MAX_NAME_ATTEMPTS).toBeGreaterThan(100);
    expect(Number.isFinite(MAX_NAME_ATTEMPTS)).toBe(true);
  });
});
