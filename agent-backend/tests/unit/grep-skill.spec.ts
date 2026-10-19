/**
 * 单元测试：`grep_skill` 的领域实现（2026-10-17）。
 *
 * 守住四条：
 * 1. **搜得到**：缺省跨全部技能、限定技能只搜该技能；命中行形如
 *    `技能名/路径:行号: 内容`（可直接回填给 `read_skill`）；
 * 2. **有界可见**（原则九）：超过 100 条明说"仅显示前 100 条"，绝不静默截断；
 * 3. **失败可读**：空/非法正则、技能不存在、技能根为空都给可操作说明（不上抛、不记越权）；
 * 4. **越不出去**：非法技能名与 `read_skill` 同一判据（分隔符 / `..` / 控制字符一律拒）。
 */
import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { grepSkillFiles } from '../../src/domain/tools/grep-skill.js';
import { SkillAccessError } from '../../src/domain/tools/skill-access.js';

let dir: string;
let skillsRoot: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'grep-skill-'));
  skillsRoot = path.join(dir, 'skills');

  const a = path.join(skillsRoot, '调度算法');
  mkdirSync(path.join(a, 'references'), { recursive: true });
  writeFileSync(path.join(a, 'SKILL.md'), '# 调度算法\n\n交付日期是关键词\n', 'utf8');
  writeFileSync(path.join(a, 'references', '算法详解.md'), '# 详解\n\n交付日期风险\n', 'utf8');
  // 二进制（含 NUL）：应被跳过并计数，而不是把乱码塞进上下文
  writeFileSync(path.join(a, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x4e, 0x47]));

  const b = path.join(skillsRoot, '质量检验');
  mkdirSync(b, { recursive: true });
  writeFileSync(path.join(b, 'SKILL.md'), '# 质量检验\n\n交付日期前完成检验\n', 'utf8');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('grepSkillFiles —— 检索', () => {
  it('缺省检索全部技能：命中行带技能名与行号，可直接回填 read_skill', () => {
    const text = grepSkillFiles(skillsRoot, '交付日期');

    expect(text).toContain('找到 3 处匹配');
    expect(text).toContain('调度算法/SKILL.md:3: 交付日期是关键词');
    expect(text).toContain('调度算法/references/算法详解.md:3: 交付日期风险');
    expect(text).toContain('质量检验/SKILL.md:3: 交付日期前完成检验');
  });

  it('指定 skill 时只搜该技能', () => {
    const text = grepSkillFiles(skillsRoot, '交付日期', '质量检验');

    expect(text).toContain('质量检验/SKILL.md:3');
    expect(text).not.toContain('调度算法');
    expect(text).not.toContain('找到 3 处');
  });

  it('大小写不敏感（与 grep_files 同一口径）', () => {
    writeFileSync(path.join(skillsRoot, '调度算法', 'notes.md'), 'Delivery 说明\n', 'utf8');

    expect(grepSkillFiles(skillsRoot, 'delivery')).toContain('调度算法/notes.md:1');
  });

  it('无匹配时给可读说明（不返回空串）', () => {
    expect(grepSkillFiles(skillsRoot, '不存在的关键词')).toContain(
      '未找到匹配 "不存在的关键词" 的技能内容',
    );
  });

  it('二进制文件被跳过并在末尾注明（计数可见）', () => {
    const text = grepSkillFiles(skillsRoot, '交付日期');

    expect(text).toContain('已跳过 1 个二进制文件');
    expect(text).not.toContain('\u0000');
  });

  it('符号链接被跳过并注明（技能目录内的链接一律不跟进）', () => {
    writeFileSync(path.join(dir, 'outside.txt'), '交付日期（技能之外）\n', 'utf8');
    try {
      fs.symlinkSync(
        path.join(dir, 'outside.txt'),
        path.join(skillsRoot, '调度算法', 'link.md'),
        'file',
      );
    } catch {
      return; // Windows 未开启开发者模式时无法创建符号链接：跳过而非误报
    }

    const text = grepSkillFiles(skillsRoot, '交付日期');

    expect(text).toContain('已跳过 1 个符号链接');
    expect(text).not.toContain('技能之外');
  });

  it('匹配超过 100 条时明说"仅显示前 100 条"（有界必须可见）', () => {
    writeFileSync(
      path.join(skillsRoot, '质量检验', 'big.md'),
      Array.from({ length: 101 }, (_, i) => `命中 ${i}`).join('\n'),
      'utf8',
    );

    const text = grepSkillFiles(skillsRoot, '命中');
    expect(text).toContain('找到 101 处匹配（仅显示前 100 条）');
  });
});

describe('grepSkillFiles —— 用法问题（可读说明，不上抛）', () => {
  it('空检索式与非法正则：给可操作说明', () => {
    expect(grepSkillFiles(skillsRoot, '   ')).toContain('检索式不能为空');
    expect(grepSkillFiles(skillsRoot, '(')).toContain('非法检索表达式');
    expect(grepSkillFiles(skillsRoot, 42)).toContain('检索式不能为空');
  });

  it('限定的技能不存在：列出可用技能', () => {
    const text = grepSkillFiles(skillsRoot, '交付日期', '不存在的技能');

    expect(text).toContain('没有名为「不存在的技能」的技能');
    expect(text).toContain('调度算法');
  });

  it('技能根为空或不存在：明说没有配置技能', () => {
    expect(grepSkillFiles(path.join(dir, 'nope'), 'x')).toContain('没有配置任何技能');

    const empty = path.join(dir, 'empty-skills');
    mkdirSync(empty, { recursive: true });
    expect(grepSkillFiles(empty, 'x')).toContain('没有配置任何技能');
  });
});

describe('grepSkillFiles —— 越权（与 read_skill 同一判据）', () => {
  it('非法技能名一律拒绝：分隔符 / `..` / 控制字符', () => {
    expect(() => grepSkillFiles(skillsRoot, 'x', '../调度算法')).toThrow(SkillAccessError);
    expect(() => grepSkillFiles(skillsRoot, 'x', 'a/b')).toThrow(SkillAccessError);
    expect(() => grepSkillFiles(skillsRoot, 'x', 'a\\b')).toThrow(SkillAccessError);
    expect(() => grepSkillFiles(skillsRoot, 'x', 'a\u0000b')).toThrow(SkillAccessError);
  });
});
