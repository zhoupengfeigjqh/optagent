/**
 * 单元测试：存量索引的展示名回填（2026-11-04，`display-name.ts`）
 *
 * 守住两条口径：
 * 1. 升级前的索引没有 `display_name`，而市场 `SKILL.md` 已带 `metadata`——
 *    列表 MUST 回读磁盘补齐**并写回索引**，否则卡片一直显示英文 `name`；
 * 2. 坏 SKILL.md（缺 frontmatter 等）回落 `name`，**不拖垮列表**。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SkillLibraryService } from '../../src/domain/skill-library/install.js';
import { PlatformStore } from '../../src/infra/platform-store.js';
import { zipFixture } from '../helpers/zip-fixture.js';

let root: string;
let skills: SkillLibraryService;

const SKILL_MD =
  '---\nname: pdf-parse\ndescription: 解析 PDF\n' + 'metadata:\n  ontology_name: 文档解析\n---\n\n正文\n';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-display-name-'));
  const store = new PlatformStore(root);
  store.ensureLayout();
  skills = new SkillLibraryService(store);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function indexFile(): string {
  return path.join(root, 'skills', 'index.json');
}

function readIndex(): { items: Array<Record<string, unknown>> } {
  return JSON.parse(fs.readFileSync(indexFile(), 'utf8')) as {
    items: Array<Record<string, unknown>>;
  };
}

describe('存量索引展示名回填', () => {
  it('缺 display_name → 回读 SKILL.md 补展示名并写回索引', async () => {
    await skills.install(zipFixture({ 'SKILL.md': SKILL_MD }), {
      overwrite: false,
      source: 'a',
    });
    // 模拟升级前的索引：抹掉 display_name（旧版本没有这个字段）
    const index = readIndex();
    delete index.items[0]!.display_name;
    fs.writeFileSync(indexFile(), JSON.stringify(index));

    const listed = skills.listAll();
    expect(listed[0]!.name).toBe('pdf-parse');
    expect(listed[0]!.display_name).toBe('文档解析');

    // 补完即写回：后续读取不再依赖磁盘解析
    expect(readIndex().items[0]!.display_name).toBe('文档解析');
  });

  it('SKILL.md 已损坏 → 回落 name，不拖垮列表', () => {
    fs.mkdirSync(path.join(root, 'skills', 'broken'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'broken', 'SKILL.md'), '没有 frontmatter');
    fs.writeFileSync(
      indexFile(),
      JSON.stringify({
        items: [
          {
            name: 'broken',
            description: '坏的',
            files: [],
            source: 'a',
            installed_at: 't',
            updated_at: 't',
          },
        ],
      }),
    );

    expect(skills.listAll()[0]).toMatchObject({ name: 'broken', display_name: 'broken' });
  });
});
