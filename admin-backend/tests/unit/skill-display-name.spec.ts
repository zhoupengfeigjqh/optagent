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
    const index = readIndex();
    delete index.items[0]!.display_name;
    fs.writeFileSync(indexFile(), JSON.stringify(index));

    const listed = skills.listAll();
    expect(listed[0]!.name).toBe('pdf-parse');
    expect(listed[0]!.display_name).toBe('文档解析');

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
