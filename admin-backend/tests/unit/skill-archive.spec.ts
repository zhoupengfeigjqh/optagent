/**
 * 单元测试：SKILL 归档安全解析（T090）
 *
 * 覆盖 `data-model.md` §4 的**七项校验**各自的正 / 异 / 边界（原则三）。
 * 恶意夹具由 `helpers/zip-fixture.ts` 现场构造——正规打包工具**产不出**
 * 这些形态（这正是必须自建夹具的原因）。
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import {
  DEFAULT_ARCHIVE_LIMITS,
  entryDepth,
  extractSkillArchive,
  isDirectoryEntry,
  isSymlinkEntry,
  stripCommonPrefix,
  unsafeEntryReason,
} from '../../src/domain/skill-library/archive.js';
import { parseSkillMetadata } from '../../src/domain/skill-library/metadata.js';
import { MODE_SYMLINK, buildZip, zipFixture } from '../helpers/zip-fixture.js';

const VALID_SKILL_MD = '---\nname: pdf-parse\ndescription: 解析 PDF 文本层\n---\n\n正文\n';

async function expectArchiveError(
  buffer: Buffer,
  code: string,
  limits?: Parameters<typeof extractSkillArchive>[1],
): Promise<ApiError> {
  let caught: unknown;
  try {
    await extractSkillArchive(buffer, limits);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ApiError);
  expect((caught as ApiError).code).toBe(code);
  return caught as ApiError;
}

describe('纯函数：条目安全判定', () => {
  it('unsafeEntryReason 放行常规路径（含中文与空格）', () => {
    expect(unsafeEntryReason('SKILL.md')).toBeNull();
    expect(unsafeEntryReason('附件/说明 文档.md')).toBeNull();
    expect(unsafeEntryReason('a/b/c.txt')).toBeNull();
  });

  it('unsafeEntryReason 拒绝绝对路径 / 穿越 / 控制字符', () => {
    expect(unsafeEntryReason('/etc/passwd')).toMatch(/绝对路径/);
    expect(unsafeEntryReason('C:/windows/x')).toMatch(/盘符/);
    expect(unsafeEntryReason('../secret')).toMatch(/穿越/);
    expect(unsafeEntryReason('a/../../b')).toMatch(/穿越/);
    expect(unsafeEntryReason('a\u0000b')).toMatch(/控制字符/);
    expect(unsafeEntryReason('')).toMatch(/为空/);
  })

  it('反斜杠按**路径分隔符**归一（Windows 打包工具产出），但仍拒绝反斜杠开头的绝对路径与穿越', () => {
    // Windows 的"发送到压缩文件夹"/PowerShell 用 \ 作分隔符：必须能装
    expect(unsafeEntryReason('pkg\\SKILL.md')).toBeNull();
    expect(unsafeEntryReason('pkg\\references\\a.md')).toBeNull();
    // 起点为 \ 属绝对路径（如 \Windows\System32），仍拒绝
    expect(unsafeEntryReason('\\Windows\\x')).toMatch(/绝对路径/);
    // 归一后仍能识别穿越
    expect(unsafeEntryReason('pkg\\..\\..\\etc')).toMatch(/穿越/);
  });

  it('isSymlinkEntry / isDirectoryEntry / entryDepth', () => {
    expect(isSymlinkEntry(MODE_SYMLINK << 16)).toBe(true);
    expect(isSymlinkEntry(0o100644 << 16)).toBe(false);
    expect(isDirectoryEntry('a/')).toBe(true);
    expect(isDirectoryEntry('a\\')).toBe(true); // 反斜杠结尾同样视为目录
    expect(isDirectoryEntry('a')).toBe(false);
    expect(entryDepth('a/b/c.txt')).toBe(3);
    expect(entryDepth('a\\b\\c.txt')).toBe(3); // 反斜杠按分隔符计层级
    expect(entryDepth('a/')).toBe(1);
    expect(entryDepth('')).toBe(0);
  });

  it('stripCommonPrefix 只剥离全部条目共享的单一顶层目录', () => {
    expect(stripCommonPrefix(['pkg/SKILL.md', 'pkg/a.txt'])).toEqual({
      prefix: 'pkg',
      relative: ['SKILL.md', 'a.txt'],
    });
    expect(stripCommonPrefix(['SKILL.md', 'a.txt']).prefix).toBe('');
    expect(stripCommonPrefix(['a/x', 'b/y']).prefix).toBe('');
    expect(stripCommonPrefix([]).prefix).toBe('');
  });
});

describe('parseSkillMetadata', () => {
  it('正向：解析 name / description（容忍 CRLF）', () => {
    expect(parseSkillMetadata('---\r\nname: x\r\ndescription: y\r\n---\r\n正文')).toEqual({
      name: 'x',
      description: 'y',
    });
  });

  it('异常：缺 frontmatter / 缺字段 / 空字段 → ADM_SKILL_ARCHIVE_INVALID', () => {
    const cases = ['正文没有元数据块', '---\ndescription: y\n---\n', '---\nname: x\n---\n', '---\nname: "  "\ndescription: y\n---\n'];
    for (const raw of cases) {
      let caught: unknown;
      try {
        parseSkillMetadata(raw);
      } catch (err) {
        caught = err;
      }
      expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_SKILL_ARCHIVE_INVALID);
    }
  });

  it('异常：name 不可作目录名 → VALIDATION_FAILED', () => {
    let caught: unknown;
    try {
      parseSkillMetadata('---\nname: a/b\ndescription: y\n---\n');
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});

describe('extractSkillArchive —— 七项校验', () => {
  it('① 合规包（根级 SKILL.md）解析成功', async () => {
    const archive = await extractSkillArchive(
      zipFixture({ 'SKILL.md': VALID_SKILL_MD, 'helper.txt': '附件' }),
    );
    expect(archive.prefix).toBe('');
    expect(archive.skillMd).toBe(VALID_SKILL_MD);
    expect(archive.entries.map((e) => e.path).sort()).toEqual(['SKILL.md', 'helper.txt']);
  });

  it('① 合规包（Windows 打包：反斜杠分隔 + 顶层目录 + 参考文件）同样可装', async () => {
    // 实测缺陷回归：Windows 打包工具用 \ 作条目分隔符，曾导致"正常打包的技能装不上"
    const archive = await extractSkillArchive(
      zipFixture({
        '调度故障问答\\SKILL.md': VALID_SKILL_MD,
        '调度故障问答\\references\\手册.md': '参考正文',
      }),
    );
    expect(archive.prefix).toBe('调度故障问答');
    expect(archive.skillMd).toBe(VALID_SKILL_MD);
    expect([...archive.files.keys()].sort()).toEqual(['SKILL.md', 'references/手册.md']);
  });

  it('① 合规包（单层目录）剥掉顶层目录', async () => {
    const archive = await extractSkillArchive(
      zipFixture({ 'pdf-parse/SKILL.md': VALID_SKILL_MD, 'pdf-parse/ref/a.md': 'x' }),
    );
    expect(archive.prefix).toBe('pdf-parse');
    expect(archive.entries.map((e) => e.path).sort()).toEqual(['SKILL.md', 'ref/a.md']);
  });

  it('① 非法压缩包（不是 ZIP）→ ADM_SKILL_ARCHIVE_INVALID', async () => {
    await expectArchiveError(
      Buffer.from('这不是一个 zip 文件，只是一段文本'),
      ERROR_CODES.ADM_SKILL_ARCHIVE_INVALID,
    );
  });

  it('② 缺 SKILL.md → ADM_SKILL_ARCHIVE_INVALID', async () => {
    const err = await expectArchiveError(
      zipFixture({ 'readme.md': '没有技能说明' }),
      ERROR_CODES.ADM_SKILL_ARCHIVE_INVALID,
    );
    expect(err.message).toContain('SKILL.md');
  });

  it('③ 元数据缺字段 → 由 install 层的 parseSkillMetadata 拒绝（此处校验包格式可用）', async () => {
    const archive = await extractSkillArchive(zipFixture({ 'SKILL.md': '---\nname: x\n---\n' }));
    expect(() => parseSkillMetadata(archive.skillMd)).toThrow(ApiError);
  });

  it('⑤ 拒绝 `../` 越界路径 → ADM_SKILL_ARCHIVE_UNSAFE', async () => {
    await expectArchiveError(
      zipFixture({ 'SKILL.md': VALID_SKILL_MD, '../escape.txt': 'x' }),
      ERROR_CODES.ADM_SKILL_ARCHIVE_UNSAFE,
    );
  });

  it('⑤ 拒绝绝对路径 → ADM_SKILL_ARCHIVE_UNSAFE', async () => {
    await expectArchiveError(
      zipFixture({ 'SKILL.md': VALID_SKILL_MD, '/etc/passwd': 'x' }),
      ERROR_CODES.ADM_SKILL_ARCHIVE_UNSAFE,
    );
  });

  it('⑤ 拒绝符号链接条目 → ADM_SKILL_ARCHIVE_UNSAFE', async () => {
    const zip = buildZip([
      { name: 'SKILL.md', content: VALID_SKILL_MD },
      { name: 'link', symlinkTo: '/etc/passwd' },
    ]);
    const err = await expectArchiveError(zip, ERROR_CODES.ADM_SKILL_ARCHIVE_UNSAFE);
    expect(err.message).toContain('符号链接');
  });

  it('⑥ 拒绝超大（总大小超限）→ ADM_SKILL_ARCHIVE_UNSAFE', async () => {
    await expectArchiveError(
      zipFixture({ 'SKILL.md': VALID_SKILL_MD, 'big.bin': 'x'.repeat(2048) }),
      ERROR_CODES.ADM_SKILL_ARCHIVE_UNSAFE,
      { maxTotalBytes: 1024 },
    );
  });

  it('⑥ 拒绝单文件超限 → ADM_SKILL_ARCHIVE_UNSAFE', async () => {
    await expectArchiveError(
      zipFixture({ 'SKILL.md': VALID_SKILL_MD, 'big.bin': 'x'.repeat(2048) }),
      ERROR_CODES.ADM_SKILL_ARCHIVE_UNSAFE,
      { maxFileBytes: 1024 },
    );
  });

  it('⑥ 拒绝文件数超限 → ADM_SKILL_ARCHIVE_UNSAFE', async () => {
    const files: Record<string, string> = { 'SKILL.md': VALID_SKILL_MD };
    for (let i = 0; i < 5; i += 1) files[`f${i}.txt`] = 'x';
    await expectArchiveError(zipFixture(files), ERROR_CODES.ADM_SKILL_ARCHIVE_UNSAFE, {
      maxFiles: 3,
    });
  });

  it('⑥ 拒绝深层嵌套 → ADM_SKILL_ARCHIVE_UNSAFE', async () => {
    await expectArchiveError(
      zipFixture({ 'SKILL.md': VALID_SKILL_MD, 'a/b/c/d/e/deep.txt': 'x' }),
      ERROR_CODES.ADM_SKILL_ARCHIVE_UNSAFE,
      { maxDepth: 3 },
    );
  });

  it('⑦ 拒绝重复条目名 → ADM_SKILL_ARCHIVE_UNSAFE', async () => {
    const zip = buildZip([
      { name: 'SKILL.md', content: VALID_SKILL_MD },
      { name: 'dup.txt', content: 'a' },
      { name: 'dup.txt', content: 'b' },
    ]);
    const err = await expectArchiveError(zip, ERROR_CODES.ADM_SKILL_ARCHIVE_UNSAFE);
    expect(err.message).toContain('重复条目名');
  });

  it('边界：空压缩包（只有目录项）→ ADM_SKILL_ARCHIVE_INVALID', async () => {
    const zip = buildZip([{ name: 'only-dir/' }]);
    await expectArchiveError(zip, ERROR_CODES.ADM_SKILL_ARCHIVE_INVALID);
  });

  it('边界：deflate 压缩的合规包同样可被正确解析', async () => {
    const archive = await extractSkillArchive(zipFixture({ 'SKILL.md': VALID_SKILL_MD }, { compress: true }));
    expect(archive.skillMd).toBe(VALID_SKILL_MD);
  });

  it('默认上限存在且合理', () => {
    expect(DEFAULT_ARCHIVE_LIMITS.maxTotalBytes).toBeGreaterThan(0);
    expect(DEFAULT_ARCHIVE_LIMITS.maxFiles).toBeGreaterThan(0);
    expect(DEFAULT_ARCHIVE_LIMITS.maxDepth).toBeGreaterThan(0);
  });
});
