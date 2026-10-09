/**
 * 单元测试：`SkillLibraryService.installFromDirectory`（2026-10-02，本体市场导入的落库半程）
 *
 * 守住三条口径：
 * 1. 与 ZIP 安装同一套落库机制（原子入驻、整包落盘、索引同步、版本递增），并记录 `origin`；
 * 2. **重名直接拒绝**（产品决定：市场导入不提供覆盖），库中既有内容不变；
 * 3. 缺 `SKILL.md` → `VALIDATION_FAILED`。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import { SkillLibraryService } from '../../src/domain/skill-library/install.js';
import { PlatformStore } from '../../src/infra/platform-store.js';
import { zipFixture } from '../helpers/zip-fixture.js';

let root: string;
let store: PlatformStore;
let skills: SkillLibraryService;

const SKILL_MD = '---\nname: raw-material-inventory\ndescription: 原材料与库存本体技能\n---\n\n正文\n';
const ORIGIN = {
  kind: 'onto_market',
  scenario: '生产调度',
  ontology: '原材料采购和库存',
  hash: 'abc123',
} as const;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-library-'));
  store = new PlatformStore(root);
  store.ensureLayout();
  skills = new SkillLibraryService(store);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function skillDir(name = 'raw-material-inventory'): string {
  return path.join(root, 'skills', name);
}

describe('installFromDirectory（本体市场导入落库）', () => {
  it('入驻成功：整包落盘（含附件）、记录含 origin 与溯源 source、索引可见', () => {
    const result = skills.installFromDirectory(
      new Map([
        ['SKILL.md', Buffer.from(SKILL_MD, 'utf8')],
        ['references/a.md', Buffer.from('附件', 'utf8')],
      ]),
      { source: 'onto_market:生产调度/原材料采购和库存', origin: ORIGIN },
    );

    expect(result).toMatchObject({ name: 'raw-material-inventory', overwritten: false });
    expect(fs.readFileSync(path.join(skillDir(), 'SKILL.md'), 'utf8')).toBe(SKILL_MD);
    expect(fs.existsSync(path.join(skillDir(), 'references', 'a.md'))).toBe(true);

    const record = skills.listAll().find((item) => item.name === 'raw-material-inventory')!;
    expect(record.source).toBe('onto_market:生产调度/原材料采购和库存');
    expect(record.origin).toMatchObject({ kind: 'onto_market', hash: 'abc123' });
    expect(skills.read('raw-material-inventory').description).toBe('原材料与库存本体技能');
  });

  it('重名直接拒绝（市场导入不提供覆盖）：ADM_SKILL_NAME_TAKEN，库中内容不变', async () => {
    await skills.install(zipFixture({ 'SKILL.md': SKILL_MD }), { overwrite: false, source: 'a' });

    let caught: unknown;
    try {
      skills.installFromDirectory(
        new Map([['SKILL.md', Buffer.from(SKILL_MD.replace('正文', '正文 v2'), 'utf8')]]),
        { source: 'onto_market:x/y', origin: { ...ORIGIN, scenario: 'x', ontology: 'y' } },
      );
    } catch (err) {
      caught = err;
    }

    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_SKILL_NAME_TAKEN);
    expect(skills.read('raw-material-inventory').description).toBe('原材料与库存本体技能');
  });

  it('缺 SKILL.md → VALIDATION_FAILED', () => {
    let caught: unknown;
    try {
      skills.installFromDirectory(new Map([['readme.md', Buffer.from('x')]]), {
        source: 's',
        origin: ORIGIN,
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});
