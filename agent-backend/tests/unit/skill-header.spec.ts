/**
 * 单元测试：技能头部读取与解析（016）。
 *
 * 守住的边界：
 * - frontmatter 缺失 / 未闭合 / YAML 非法 / 缺 name 或 description → 逐技能失败，不抛整轮；
 * - `ontology_id` / `scenario_id` 数字与字符串等价归一化；`ontology_name` 去空白；
 * - 只读前 64KB：正文再长也不影响头部解析（有界读取的核心收益）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SKILL_HEADER_MAX_BYTES,
  parseSkillHeader,
  readSkillHeaderFile,
  loadSkillHeaders,
} from '../../src/domain/skill-header.js';

const tmpDirs: string[] = [];

function tmpAgentDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-skill-header-'));
  tmpDirs.push(dir);
  return dir;
}

function writeSkill(agentDir: string, dirName: string, content: string): void {
  const dir = path.join(agentDir, 'skills', dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf8');
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('parseSkillHeader', () => {
  it('解析完整头部并保留原文 name / description', () => {
    const header = parseSkillHeader(
      [
        '---',
        'name: raw-material-inventory-new',
        'description: 原材料采购和库存本体技能',
        'metadata:',
        '  ontology_id: 1',
        '  ontology_name: 原材料采购和库存',
        '  scenario_id: "2"',
        '  scenario_name: 生产调度',
        '---',
        '',
        '# 正文不参与判定',
      ].join('\n'),
      'raw-material-inventory-new',
    );

    expect(header.name).toBe('raw-material-inventory-new');
    expect(header.description).toBe('原材料采购和库存本体技能');
    expect(header.metadata).toEqual({
      ontologyId: '1',
      ontologyName: '原材料采购和库存',
      scenarioId: '2',
      scenarioName: '生产调度',
    });
    expect(header.dirName).toBe('raw-material-inventory-new');
  });

  it('非本体技能：metadata 缺失时四个字段全为 null', () => {
    const header = parseSkillHeader('---\nname: a\ndescription: b\n---\n');
    expect(header.metadata).toEqual({
      ontologyId: null,
      ontologyName: null,
      scenarioId: null,
      scenarioName: null,
    });
  });

  it('空白 ontology_id 归一化为 null（不把空串当本体技能）', () => {
    const header = parseSkillHeader(
      '---\nname: a\ndescription: b\nmetadata:\n  ontology_id: "  "\n---\n',
    );
    expect(header.metadata.ontologyId).toBeNull();
  });

  it('缺 frontmatter 抛 missing_frontmatter', () => {
    expect(() => parseSkillHeader('# 没有元数据\n')).toThrowError(/frontmatter/);
  });

  it('frontmatter 未闭合按 missing_frontmatter', () => {
    expect(() => parseSkillHeader('---\nname: a\ndescription: b\n')).toThrowError(/frontmatter/);
  });

  it('YAML 非法按 invalid_yaml', () => {
    expect(() => parseSkillHeader('---\nname: [unclosed\n---\n')).toThrowError(/YAML/);
  });

  it('缺 name / description 按 missing_fields', () => {
    expect(() => parseSkillHeader('---\nname: a\n---\n')).toThrow();
    expect(() => parseSkillHeader('---\ndescription: b\n---\n')).toThrow();
  });
});

describe('readSkillHeaderFile / loadSkillHeaders', () => {
  it('只读前 64KB：超长正文不影响头部解析', () => {
    const dir = tmpAgentDir();
    writeSkill(dir, 'big', `---\nname: big\ndescription: 大文件\n---\n${'x'.repeat(SKILL_HEADER_MAX_BYTES * 2)}`);
    const header = loadSkillHeaders(dir);
    expect(header.skills).toHaveLength(1);
    expect(header.skills[0]!.name).toBe('big');
    expect(header.warnings).toEqual([]);
  });

  it('单个坏技能只记 warning，其余技能照常', () => {
    const dir = tmpAgentDir();
    writeSkill(dir, 'ok', '---\nname: ok\ndescription: 正常\n---\n');
    writeSkill(dir, 'bad', 'no frontmatter');
    const result = loadSkillHeaders(dir);
    expect(result.skills.map((skill) => skill.name)).toEqual(['ok']);
    expect(result.warnings).toEqual(['bad:missing_frontmatter']);
  });

  it('技能目录不存在返回空集且不告警', () => {
    const dir = tmpAgentDir();
    expect(loadSkillHeaders(dir)).toEqual({ skills: [], warnings: [] });
  });

  it('符号链接目录被跳过（不跟随物化异常）', () => {
    const dir = tmpAgentDir();
    writeSkill(dir, 'real', '---\nname: real\ndescription: 正常\n---\n');
    const link = path.join(dir, 'skills', 'link');
    try {
      fs.symlinkSync(path.join(dir, 'skills', 'real'), link, 'junction');
    } catch {
      return; // 无权限创建链接的环境直接跳过（Windows 非管理员常见）
    }
    const result = loadSkillHeaders(dir);
    expect(result.skills.map((skill) => skill.name)).toEqual(['real']);
  });

  it('中文目录与中文路径可正常读取', () => {
    const dir = tmpAgentDir();
    writeSkill(dir, '生产计划', '---\nname: 生产计划\ndescription: 中文技能\n---\n');
    expect(readSkillHeaderFile(path.join(dir, 'skills', '生产计划', 'SKILL.md')).name).toBe('生产计划');
  });
});
