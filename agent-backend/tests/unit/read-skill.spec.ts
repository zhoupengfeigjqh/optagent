/**
 * 单元测试：`read_skill` 的领域实现。
 *
 * 守住三条：
 * 1. **能读到**：默认 `SKILL.md`，也能读 `references/` 等附件；目录给清单；
 * 2. **失败可读**：技能/文件不存在、二进制，都要给出可操作的说明（含可用清单），不是一句报错；
 * 3. **越不出去**：`..` 穿越、跨技能、绝对路径、符号链接、非法技能名一律拒绝——
 *    这是"本数字人只能读自己的技能"的边界。
 */
import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SkillAccessError, readSkillFile } from '../../src/domain/tools/read-skill.js';

/** 技能目录之外的越界目标 */
const OUTSIDE = 'SECRET';

let dir: string;
let skillsRoot: string;
let skillDir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'read-skill-'));
  skillsRoot = path.join(dir, 'skills');
  skillDir = path.join(skillsRoot, '调度算法');
  mkdirSync(path.join(skillDir, 'references'), { recursive: true });
  writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    '---\nname: 调度算法\ndescription: 选型指引\n---\n\n# 正文\n\n见 references/算法详解.md\n',
    'utf8',
  );
  writeFileSync(path.join(skillDir, 'references', '算法详解.md'), '# 算法详解\n\n内容A\n', 'utf8');
  writeFileSync(path.join(skillDir, 'references', '选型决策树.md'), '# 决策树\n', 'utf8');
  // 二进制（含 NUL）
  writeFileSync(path.join(skillDir, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x4e, 0x47]));
  // 本数字人的另一个技能
  mkdirSync(path.join(skillsRoot, '另一个技能'), { recursive: true });
  writeFileSync(path.join(skillsRoot, '另一个技能', 'SKILL.md'), '另一个技能的正文', 'utf8');
  // 技能目录之外的文件（越界用例的目标）
  writeFileSync(path.join(dir, 'secret.txt'), OUTSIDE, 'utf8');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readSkillFile —— 正常读取', () => {
  it('缺省读 SKILL.md（技能正文入口）', () => {
    const r = readSkillFile(skillsRoot, '调度算法');
    expect(r.text).toContain('# 正文');
    expect(r.truncated).toBe(false);
    expect(r.totalSize).toBeGreaterThan(0);
  });

  it('可读 references/ 等附件（中文文件名与子目录）', () => {
    expect(readSkillFile(skillsRoot, '调度算法', 'references/算法详解.md').text).toContain('内容A');
    expect(readSkillFile(skillsRoot, '调度算法', 'references/选型决策树.md').text).toContain('决策树');
  });

  it('技能名两侧空白被容错（模型常带空格）', () => {
    expect(readSkillFile(skillsRoot, '  调度算法  ').text).toContain('# 正文');
  });

  it('path 为目录时返回该目录下的文件清单，而不是报错', () => {
    const r = readSkillFile(skillsRoot, '调度算法', 'references');
    expect(r.text).toContain('references/算法详解.md');
    expect(r.text).toContain('references/选型决策树.md');
  });

  it('反斜杠按分隔符归一（模型可能用 Windows 写法）', () => {
    expect(readSkillFile(skillsRoot, '调度算法', 'references\\算法详解.md').text).toContain('内容A');
  });

  it('内容过大时截断，并可按 offset 续读', () => {
    writeFileSync(path.join(skillDir, 'big.md'), `${'A'.repeat(1000)}${'B'.repeat(1000)}`, 'utf8');

    const first = readSkillFile(skillsRoot, '调度算法', 'big.md', { truncateBytes: 1000 });
    expect(first.truncated).toBe(true);
    expect(first.totalSize).toBe(2000);
    expect(first.text).toContain('可用 offset=1000 继续读取');

    const second = readSkillFile(skillsRoot, '调度算法', 'big.md', {
      offset: 1000,
      truncateBytes: 1000,
    });
    expect(second.text.startsWith('B')).toBe(true);
    expect(second.truncated).toBe(false);
  });

  it('limit 超上限时被 truncateBytes 兜住（不因参数放大上下文）', () => {
    writeFileSync(path.join(skillDir, 'big.md'), 'A'.repeat(5000), 'utf8');
    const r = readSkillFile(skillsRoot, '调度算法', 'big.md', { limit: 99999, truncateBytes: 100 });
    expect(r.text).toContain('内容已截断');
    expect(r.text.length).toBeLessThan(300);
  });
});

describe('readSkillFile —— 失败也要可读（含可用清单）', () => {
  it('技能不存在：说明并列出本数字人的可用技能', () => {
    const r = readSkillFile(skillsRoot, '不存在的技能');
    expect(r.text).toContain('没有名为「不存在的技能」的技能');
    expect(r.text).toContain('调度算法');
    expect(r.text).toContain('另一个技能');
  });

  it('文件不存在：说明并列出该技能下的可用文件', () => {
    const r = readSkillFile(skillsRoot, '调度算法', 'references/没有这个.md');
    expect(r.text).toContain('没有「references/没有这个.md」');
    expect(r.text).toContain('references/算法详解.md');
  });

  it('二进制文件：明说无法阅读（不把 NUL 乱码塞给模型）', () => {
    const r = readSkillFile(skillsRoot, '调度算法', 'logo.png');
    expect(r.text).toContain('二进制文件');
    expect(r.text).not.toContain('\u0000');
  });
});

describe('readSkillFile —— 越不出去（沙箱边界）', () => {
  it.each([
    ['`..` 穿越到技能目录之外', '调度算法', '../../secret.txt'],
    ['跨技能读取（同根另一技能）', '调度算法', '../另一个技能/SKILL.md'],
    ['路径从技能根出发向上越级', '调度算法', '../'],
    ['绝对路径（posix）', '调度算法', '/etc/passwd'],
    ['绝对路径（Windows 盘符）', '调度算法', 'C:/Windows/win.ini'],
    ['技能名含路径分隔符', '调度算法/../另一个技能', undefined],
    ['技能名为 `..`', '..', undefined],
    ['技能名为空', '', undefined],
    ['path 非字符串', '调度算法', 42 as unknown as string],
  ])('%s', (_label, skill, relPath) => {
    expect(() => readSkillFile(skillsRoot, skill as unknown, relPath as unknown)).toThrow(
      SkillAccessError,
    );
  });

  it('符号链接（文件）一律拒绝', () => {
    const link = path.join(skillDir, 'link.md');
    try {
      fs.symlinkSync(path.join(dir, 'secret.txt'), link, 'file');
    } catch {
      return; // Windows 未开启开发者模式时无法创建符号链接：跳过而非误报
    }
    expect(() => readSkillFile(skillsRoot, '调度算法', 'link.md')).toThrow(SkillAccessError);
  });

  it('符号链接（目录）指向技能之外：越界被拒', () => {
    try {
      fs.symlinkSync(dir, path.join(skillDir, 'escape'), 'dir');
    } catch {
      return; // 同上
    }
    expect(() => readSkillFile(skillsRoot, '调度算法', 'escape/secret.txt')).toThrow(
      SkillAccessError,
    );
  });

  it('越界时**不返回任何内容**（不静默降级为截断或空串）', () => {
    let caught: unknown;
    try {
      readSkillFile(skillsRoot, '调度算法', '../../secret.txt');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SkillAccessError);
    expect((caught as Error).message).toContain('路径越界');
    expect((caught as Error).message).not.toContain(OUTSIDE);
  });
});
