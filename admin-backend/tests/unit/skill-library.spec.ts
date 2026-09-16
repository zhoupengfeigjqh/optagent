/**
 * 单元测试：共享技能库的入驻与维护（`FR-035`~`FR-042`）
 *
 * 重点：**原子入驻**与**失败无残留**（`FR-040`、`FR-041`）——
 * 这类不变量一旦破坏，会在运行环境里留下半解压的技能目录。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import { MAX_PREVIEW_BYTES } from '../../src/domain/skill-library/file-access.js';
import { SkillLibraryService } from '../../src/domain/skill-library/install.js';
import { PlatformStore } from '../../src/infra/platform-store.js';
import { buildZip, zipFixture } from '../helpers/zip-fixture.js';

let root: string;
let store: PlatformStore;
let skills: SkillLibraryService;

const SKILL_MD = '---\nname: pdf-parse\ndescription: 解析 PDF\n---\n\n正文\n';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-library-'));
  store = new PlatformStore(root);
  store.ensureLayout();
  skills = new SkillLibraryService(store);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function skillDir(name = 'pdf-parse'): string {
  return path.join(root, 'skills', name);
}

describe('安装', () => {
  it('合规包入驻成功，整包落盘（含附件）', async () => {
    const result = await skills.install(
      zipFixture({ 'SKILL.md': SKILL_MD, 'ref/a.md': '附件' }),
      { overwrite: false, source: 'p.zip' },
    );

    expect(result).toMatchObject({ name: 'pdf-parse', description: '解析 PDF', overwritten: false });
    expect(fs.readFileSync(path.join(skillDir(), 'SKILL.md'), 'utf8')).toBe(SKILL_MD);
    expect(fs.existsSync(path.join(skillDir(), 'ref', 'a.md'))).toBe(true);
  });

  it('名称冲突且未选择覆盖 → ADM_SKILL_NAME_TAKEN，且库中内容不变（FR-040）', async () => {
    await skills.install(zipFixture({ 'SKILL.md': SKILL_MD }), { overwrite: false, source: 'a' });

    let caught: unknown;
    try {
      await skills.install(zipFixture({ 'SKILL.md': '---\nname: pdf-parse\ndescription: 新\n---\n' }), {
        overwrite: false,
        source: 'b',
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_SKILL_NAME_TAKEN);
    expect(skills.read('pdf-parse').description).toBe('解析 PDF');
  });

  it('显式覆盖：**原子替换整目录**，旧附件不残留（FR-040）', async () => {
    await skills.install(zipFixture({ 'SKILL.md': SKILL_MD, 'old.txt': 'x' }), {
      overwrite: false,
      source: 'a',
    });
    const result = await skills.install(
      zipFixture({ 'SKILL.md': '---\nname: pdf-parse\ndescription: 新\n---\n\n新正文\n', 'new.txt': 'y' }),
      { overwrite: true, source: 'b' },
    );

    expect(result.overwritten).toBe(true);
    expect(fs.readdirSync(skillDir()).sort()).toEqual(['SKILL.md', 'new.txt']);
    expect(skills.read('pdf-parse').description).toBe('新');
  });

  it('失败无残留：校验不通过时库中不出现该目录，也不留临时/备份目录（FR-041）', async () => {
    await expect(
      skills.install(zipFixture({ 'readme.md': '没有 SKILL.md' }), { overwrite: false, source: 'a' }),
    ).rejects.toThrow(ApiError);

    expect(fs.existsSync(skillDir())).toBe(false);
    const leftovers = fs
      .readdirSync(path.join(root, 'skills'))
      .filter((name) => name.startsWith('.tmp-') || name.startsWith('.old-'));
    expect(leftovers).toEqual([]);
  });

  it('失败无残留：安全校验不通过（符号链接）同样不留痕', async () => {
    const zip = buildZip([
      { name: 'SKILL.md', content: SKILL_MD },
      { name: 'link', symlinkTo: '/etc/passwd' },
    ]);
    await expect(skills.install(zip, { overwrite: false, source: 'a' })).rejects.toThrow(ApiError);
    expect(fs.existsSync(skillDir())).toBe(false);
  });

  it('元数据缺 description → ADM_SKILL_ARCHIVE_INVALID', async () => {
    let caught: unknown;
    try {
      await skills.install(zipFixture({ 'SKILL.md': '---\nname: pdf-parse\n---\n' }), {
        overwrite: false,
        source: 'a',
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_SKILL_ARCHIVE_INVALID);
  });

  it('SKILL 名不可作目录名 → VALIDATION_FAILED', async () => {
    let caught: unknown;
    try {
      await skills.install(zipFixture({ 'SKILL.md': '---\nname: a/b\ndescription: x\n---\n' }), {
        overwrite: false,
        source: 'a',
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});

describe('列表与读取', () => {
  it('索引里已无实体的残留项被剔除（不出现"幽灵卡片"）', async () => {
    await skills.install(zipFixture({ 'SKILL.md': SKILL_MD }), { overwrite: false, source: 'a' });
    expect(skills.listAll()).toHaveLength(1);

    fs.rmSync(skillDir(), { recursive: true, force: true });
    expect(skills.listAll()).toEqual([]);
  });

  it('list 固定每页 8 项；names 供统一清单判定（FR-019）', async () => {
    for (let i = 0; i < 10; i += 1) {
      await skills.install(
        zipFixture({ 'SKILL.md': `---\nname: skill-${i}\ndescription: d\n---\n` }),
        { overwrite: false, source: 'a' },
      );
    }
    expect(skills.list(1).items).toHaveLength(8);
    expect(skills.list(1).page_size).toBe(8);
    expect(skills.names().size).toBe(10);
  });

  it('read：不存在 / SKILL.md 被外部删除 → ADM_SKILL_NOT_FOUND', async () => {
    expect(() => skills.read('ghost')).toThrow(ApiError);

    await skills.install(zipFixture({ 'SKILL.md': SKILL_MD }), { overwrite: false, source: 'a' });
    fs.rmSync(path.join(skillDir(), 'SKILL.md'));
    let caught: unknown;
    try {
      skills.read('pdf-parse');
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_SKILL_NOT_FOUND);
  });

  it('readFiles 返回整包（相对路径 + 内容），供部署物化（FR-026）', async () => {
    await skills.install(zipFixture({ 'SKILL.md': SKILL_MD, 'ref/a.md': '附件' }), {
      overwrite: false,
      source: 'a',
    });
    const files = skills.readFiles('pdf-parse');
    expect(files.map((f) => f.path).sort()).toEqual(['SKILL.md', 'ref/a.md']);
    expect(files.find((f) => f.path === 'ref/a.md')?.content.toString('utf8')).toBe('附件');
  });

  it('readFiles：不存在 → ADM_SKILL_NOT_FOUND', () => {
    expect(() => skills.readFiles('ghost')).toThrow(ApiError);
  });
});

describe('读取技能内单个文件（2026-09-16）', () => {
  beforeEach(async () => {
    await skills.install(
      zipFixture({
        'SKILL.md': SKILL_MD,
        'references/手册.md': '# 手册\n\n正文内容\n',
        // 含 NUL 字节 → 按二进制处理（夹具用字符串表达，写入后即为二进制内容）
        'assets/二进制.bin': 'a\u0000b\u0000c',
      }),
      { overwrite: false, source: 'a' },
    );
  });

  it('正向：读到 SKILL.md 与参考文件正文（含中文与换行）', () => {
    const md = skills.readFile('pdf-parse', 'SKILL.md');
    expect(md.binary).toBe(false);
    expect(md.content).toBe(SKILL_MD);
    expect(md.size).toBeGreaterThan(0);

    const ref = skills.readFile('pdf-parse', 'references/手册.md');
    expect(ref.content).toContain('正文内容');
    expect(ref.truncated).toBe(false);
  });

  it('正向：Windows 反斜杠路径同样可读（与安装口径一致）', () => {
    const ref = skills.readFile('pdf-parse', 'references\\手册.md');
    expect(ref.path).toBe('references/手册.md');
    expect(ref.content).toContain('正文内容');
  });

  it('二进制文件：不返回正文，只返回大小（binary=true）', () => {
    const bin = skills.readFile('pdf-parse', 'assets/二进制.bin');
    expect(bin.binary).toBe(true);
    expect(bin.content).toBeNull();
    expect(bin.size).toBe(5);
  });

  it('越界路径（..、绝对路径、反斜杠起点）→ VALIDATION_FAILED', () => {
    for (const bad of ['../index.json', '/etc/passwd', '..\\..\\index.json', 'C:/x']) {
      let caught: unknown;
      try {
        skills.readFile('pdf-parse', bad);
      } catch (err) {
        caught = err;
      }
      expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    }
  });

  it('技能内不存在的文件 / 目录项 → ADM_SKILL_NOT_FOUND', () => {
    for (const missing of ['nope.md', 'references']) {
      let caught: unknown;
      try {
        skills.readFile('pdf-parse', missing);
      } catch (err) {
        caught = err;
      }
      expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_SKILL_NOT_FOUND);
    }
  });

  it('技能不存在 → ADM_SKILL_NOT_FOUND；path 缺失 → VALIDATION_FAILED', () => {
    let caught: unknown;
    try {
      skills.readFile('ghost', 'SKILL.md');
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_SKILL_NOT_FOUND);
    expect(() => skills.readFile('pdf-parse', '')).toThrow(ApiError);
    expect(() => skills.readFile('pdf-parse', undefined)).toThrow(ApiError);
  });

  it('超出预览上限：截断并标注 truncated（默认上限 256KB）', async () => {
    const big = 'x'.repeat(MAX_PREVIEW_BYTES + 10);
    await skills.install(zipFixture({ 'SKILL.md': SKILL_MD, 'big.txt': big }), {
      overwrite: true,
      source: 'b',
    });
    const file = skills.readFile('pdf-parse', 'big.txt');
    expect(file.truncated).toBe(true);
    expect(file.size).toBe(big.length);
    expect(file.content?.length).toBe(MAX_PREVIEW_BYTES);
  });
});

describe('在线编辑单个文件（2026-09-16：全部文件可编辑，含附件）', () => {
  beforeEach(async () => {
    await skills.install(
      zipFixture({
        'SKILL.md': SKILL_MD,
        'references/手册.md': '# 手册\n\n正文内容\n',
        'assets/二进制.bin': 'a\u0000b\u0000c',
      }),
      { overwrite: false, source: 'a' },
    );
  });

  it('正向：改附件正文 → 落盘、索引大小与 updated_at 同步，hash 可用于下一次保存', () => {
    const before = skills.readFile('pdf-parse', 'references/手册.md');
    const result = skills.writeFile(
      'pdf-parse',
      'references/手册.md',
      '# 手册（第二版）\n',
      before.hash,
    );

    expect(result).toMatchObject({ path: 'references/手册.md', size: 24 });
    expect(fs.readFileSync(path.join(skillDir(), 'references', '手册.md'), 'utf8')).toBe(
      '# 手册（第二版）\n',
    );

    const after = skills.readFile('pdf-parse', 'references/手册.md');
    expect(after.content).toBe('# 手册（第二版）\n');
    expect(after.hash).toBe(result.hash);
    expect(after.hash).not.toBe(before.hash);
    expect(skills.listAll()[0]?.updated_at).toBe(result.updated_at);
    expect(skills.listAll()[0]?.files.find((f) => f.path === 'references/手册.md')?.size).toBe(
      result.size,
    );
  });

  it('正向：改 SKILL.md → 索引 description 按新正文重新解析（卡片描述不脱节）', () => {
    const before = skills.readFile('pdf-parse', 'SKILL.md');
    skills.writeFile(
      'pdf-parse',
      'SKILL.md',
      '---\nname: pdf-parse\ndescription: 解析 PDF 与 OCR\n---\n\n新正文\n',
      before.hash,
    );
    expect(skills.read('pdf-parse').description).toBe('解析 PDF 与 OCR');
    expect(skills.read('pdf-parse').content).toContain('新正文');
  });

  it('SKILL.md 改名 → 拒绝（技能名是引用键，改名会静默打断数字人引用）', () => {
    const before = skills.readFile('pdf-parse', 'SKILL.md');
    let caught: unknown;
    try {
      skills.writeFile(
        'pdf-parse',
        'SKILL.md',
        '---\nname: pdf-parse-v2\ndescription: x\n---\n\n正文\n',
        before.hash,
      );
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    // 拒绝即不改动：原文仍在
    expect(fs.readFileSync(path.join(skillDir(), 'SKILL.md'), 'utf8')).toBe(SKILL_MD);
  });

  it('并发冲突：base_hash 过期 → 409 且**内容未被改写**（MUST NOT 静默覆盖他人改动）', () => {
    const stale = skills.readFile('pdf-parse', 'references/手册.md').hash;
    // 他处先改了一次
    skills.writeFile('pdf-parse', 'references/手册.md', '他处的改动\n', stale);

    let caught: unknown;
    try {
      skills.writeFile('pdf-parse', 'references/手册.md', '我的改动\n', stale);
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_CONFIG_REVISION_CONFLICT);
    expect(fs.readFileSync(path.join(skillDir(), 'references', '手册.md'), 'utf8')).toBe('他处的改动\n');
  });

  it('base_hash 缺失 → VALIDATION_FAILED（保存前必须先读文件）', () => {
    let caught: unknown;
    try {
      skills.writeFile('pdf-parse', 'references/手册.md', 'x', undefined);
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('越界路径 / 二进制 / 超限 / 不存在 → 按各自错误码拒绝', () => {
    const hash = skills.readFile('pdf-parse', 'references/手册.md').hash;
    const cases: Array<[unknown, string]> = [
      ['../index.json', ERROR_CODES.VALIDATION_FAILED],
      ['/etc/passwd', ERROR_CODES.VALIDATION_FAILED],
      ['assets/二进制.bin', ERROR_CODES.VALIDATION_FAILED],
      ['nope.md', ERROR_CODES.ADM_SKILL_NOT_FOUND],
    ];
    for (const [pathArg, code] of cases) {
      let caught: unknown;
      try {
        skills.writeFile('pdf-parse', pathArg as string, 'x', hash);
      } catch (err) {
        caught = err;
      }
      expect((caught as ApiError).code).toBe(code);
    }

    // 新内容超出在线编辑上限（与预览上限同为 256KB）
    let caught: unknown;
    try {
      skills.writeFile('pdf-parse', 'references/手册.md', 'x'.repeat(MAX_PREVIEW_BYTES + 1), hash);
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('文件超过在线编辑上限 → editable=false 且拒写（只显示了一部分就不许改写）', async () => {
    await skills.install(zipFixture({ 'SKILL.md': SKILL_MD, 'big.txt': 'y'.repeat(MAX_PREVIEW_BYTES + 5) }), {
      overwrite: true,
      source: 'b',
    });
    const big = skills.readFile('pdf-parse', 'big.txt');
    expect(big.editable).toBe(false);
    expect(big.truncated).toBe(true);

    let caught: unknown;
    try {
      skills.writeFile('pdf-parse', 'big.txt', 'truncate me', big.hash);
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('editable 语义：文本为真，二进制为假（与 writeFile 的判据一致）', () => {
    expect(skills.readFile('pdf-parse', 'SKILL.md').editable).toBe(true);
    expect(skills.readFile('pdf-parse', 'assets/二进制.bin').editable).toBe(false);
    expect(skills.readFile('pdf-parse', 'assets/二进制.bin').hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('保存即覆盖、不产生任何副本：不会再出现 skill-edits 快照目录（2026-09-16 第十次调整）', () => {
    const before = fs.readFileSync(path.join(skillDir(), 'references', '手册.md'), 'utf8');
    const hash = skills.readFile('pdf-parse', 'references/手册.md').hash;
    skills.writeFile('pdf-parse', 'references/手册.md', '第二版\n', hash);

    // 原文被覆盖（没有退路——因此界面 MUST 保存前二次确认）
    expect(fs.readFileSync(path.join(skillDir(), 'references', '手册.md'), 'utf8')).toBe('第二版\n');
    expect(before).toBe('# 手册\n\n正文内容\n');
    // 设计态根目录里既没有快照目录，也没有其它多余产物
    expect(fs.existsSync(path.join(root, 'skill-edits'))).toBe(false);
    // 技能目录内只有原文件（快照若写在技能内会被物化进数字人目录）
    expect(fs.readdirSync(skillDir()).sort()).toEqual(['SKILL.md', 'assets', 'references']);
  });

  it('原子写入：保存后不留临时文件', () => {
    const hash = skills.readFile('pdf-parse', 'references/手册.md').hash;
    skills.writeFile('pdf-parse', 'references/手册.md', 'ok\n', hash);
    const leftovers = fs.readdirSync(path.join(root, 'skills')).filter((n) => n.startsWith('.tmp-'));
    expect(leftovers).toEqual([]);
  });
});

describe('删除', () => {
  it('删除后目录与索引都不再出现', async () => {
    await skills.install(zipFixture({ 'SKILL.md': SKILL_MD }), { overwrite: false, source: 'a' });
    skills.remove('pdf-parse');

    expect(fs.existsSync(skillDir())).toBe(false);
    expect(skills.listAll()).toEqual([]);
    expect(skills.names().size).toBe(0);
  });

  it('不存在 → ADM_SKILL_NOT_FOUND', () => {
    let caught: unknown;
    try {
      skills.remove('ghost');
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_SKILL_NOT_FOUND);
  });
});
