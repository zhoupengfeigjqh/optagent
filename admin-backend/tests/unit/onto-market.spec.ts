/**
 * 单元测试：本体市场扫描与读取（2026-10-02）
 *
 * 重点：目录形态识别（`{场景}/{本体}/skills/{技能}/SKILL.md`）、**整包内容指纹**
 * （"市场文件是否变化"的判据）、与库内的差异状态、路径安全（越界 / 缺 SKILL.md）。
 * 导入落库部分见 `skill-install-directory.spec.ts`，端到端见 `skills-onto-market.spec.ts`。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';
import type { SkillLibraryService } from '../../src/domain/skill-library/install.js';
import {
  listOntoMarket,
  readMarketSkillPackage,
  updateOntoMarketSkill,
} from '../../src/domain/skill-library/onto-market.js';

let root: string;
const SKILL_MD = '---\nname: raw-material-inventory\ndescription: 原材料与库存本体技能\n---\n\n正文\n';

function writeSkill(
  scenario: string,
  ontology: string,
  skill: string,
  files: Record<string, string>,
): void {
  const dir = path.join(root, scenario, ontology, 'skills', skill);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

/** 库内记录桩：状态比对只用到 `listAll`（不触碰存储） */
function libraryOf(
  records: Array<{ name: string; origin?: { kind: string; hash: string } }>,
): SkillLibraryService {
  return { listAll: () => records } as unknown as SkillLibraryService;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-market-'));
  writeSkill('生产调度', '原材料采购和库存', 'raw-material-inventory', {
    'SKILL.md': SKILL_MD,
    'references/概念.md': '概念附件',
  });
  // 无 skills/ 的本体：不产生条目
  fs.mkdirSync(path.join(root, '生产调度', '订单排程'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('扫描市场目录', () => {
  it('识别 {场景}/{本体}/skills/{技能}/SKILL.md（含附件）；无 skills/ 的本体不产生条目', () => {
    const listing = listOntoMarket(root, libraryOf([]));

    expect(listing.configured).toBe(true);
    expect(listing.reason).toBeNull();
    expect(listing.items).toHaveLength(1);
    const item = listing.items[0]!;
    expect(item).toMatchObject({
      scenario: '生产调度',
      ontology: '原材料采购和库存',
      skill_dir: 'raw-material-inventory',
      name: 'raw-material-inventory',
      description: '原材料与库存本体技能',
      status: 'new',
      invalid_reason: null,
    });
    // 排序口径与库内一致（localeCompare：references 排在 SKILL.md 之前）
    expect(item.files.map((file) => file.path)).toEqual(['references/概念.md', 'SKILL.md']);
    expect(item.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('市场文件变化 → 整包哈希随之变化（"是否变化"检查的判据）', () => {
    const before = listOntoMarket(root, libraryOf([])).items[0]!.hash;

    writeSkill('生产调度', '原材料采购和库存', 'raw-material-inventory', {
      'SKILL.md': SKILL_MD.replace('正文', '正文（更新）'),
    });

    expect(listOntoMarket(root, libraryOf([])).items[0]!.hash).not.toBe(before);
  });

  it('缺 SKILL.md 的技能目录 → invalid（单技能失效不拖垮整个列表）', () => {
    writeSkill('生产调度', '原材料采购和库存', 'broken', { 'readme.md': 'x' });

    const listing = listOntoMarket(root, libraryOf([]));
    const broken = listing.items.find((item) => item.skill_dir === 'broken')!;
    expect(broken.status).toBe('invalid');
    expect(broken.invalid_reason).toContain('SKILL.md');
    expect(listing.items.find((item) => item.skill_dir === 'raw-material-inventory')!.status).toBe(
      'new',
    );
  });
});

describe('与库内的差异状态', () => {
  it('库内无同名 → new', () => {
    expect(listOntoMarket(root, libraryOf([])).items[0]!.status).toBe('new');
  });

  it('库内同名且来自市场、哈希一致 → unchanged', () => {
    const hash = listOntoMarket(root, libraryOf([])).items[0]!.hash;
    const records = [
      { name: 'raw-material-inventory', origin: { kind: 'onto_market', hash } },
    ];
    expect(listOntoMarket(root, libraryOf(records)).items[0]!.status).toBe('unchanged');
  });

  it('库内同名且来自市场、哈希不同 → changed', () => {
    const records = [
      { name: 'raw-material-inventory', origin: { kind: 'onto_market', hash: 'stale-hash' } },
    ];
    expect(listOntoMarket(root, libraryOf(records)).items[0]!.status).toBe('changed');
  });

  it('库内同名但并非来自市场 → conflict', () => {
    const records = [{ name: 'raw-material-inventory' }];
    expect(listOntoMarket(root, libraryOf(records)).items[0]!.status).toBe('conflict');
  });
});

describe('目录未配置 / 不可用', () => {
  it('未配置 → configured=false、原因可读、不报错', () => {
    const listing = listOntoMarket(null, libraryOf([]));

    expect(listing.configured).toBe(false);
    expect(listing.reason).toContain('ONTO_MARKET_DIR');
    expect(listing.items).toEqual([]);
  });

  it('目录不存在 → configured=true、原因可读、空清单', () => {
    const listing = listOntoMarket(path.join(root, '不存在'), libraryOf([]));

    expect(listing.configured).toBe(true);
    expect(listing.reason).toContain('不存在');
    expect(listing.items).toEqual([]);
  });
});

describe('读取技能包（导入前置）', () => {
  it('返回文件内容、元数据、排序的 entries 与整包哈希', () => {
    const pkg = readMarketSkillPackage(root, {
      scenario: '生产调度',
      ontology: '原材料采购和库存',
      skill: 'raw-material-inventory',
    });

    expect(pkg.name).toBe('raw-material-inventory');
    expect(pkg.files.get('SKILL.md')?.toString('utf8')).toBe(SKILL_MD);
    expect(pkg.entries.map((entry) => entry.path)).toEqual(['references/概念.md', 'SKILL.md']);
    expect(pkg.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('路径穿越（..）→ VALIDATION_FAILED', () => {
    let caught: unknown;
    try {
      readMarketSkillPackage(root, { scenario: '..', ontology: 'x', skill: 'y' });
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('技能不存在（缺 SKILL.md）→ VALIDATION_FAILED', () => {
    let caught: unknown;
    try {
      readMarketSkillPackage(root, {
        scenario: '生产调度',
        ontology: '订单排程',
        skill: 'nope',
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});

describe('市场更新（§4.8 updateOntoMarketSkill）', () => {
  const REF = { scenario: '生产调度', ontology: '原材料采购和库存', skill: 'raw-material-inventory' };
  /** 市场当前整包（与 beforeEach 铺设一致） */
  const MARKET_FILES: Record<string, string> = {
    'SKILL.md': SKILL_MD,
    'references/概念.md': '概念附件',
  };

  /** 可更新的库桩：listAll + readFiles（按库内现内容算哈希）+ updateFromDirectory 侦记 */
  function updatableLibrary(
    record: Record<string, unknown> | null,
    libraryFiles: Record<string, string>,
    updated: Array<{ originHash: string | null }>,
  ): SkillLibraryService {
    return {
      listAll: () => (record ? [record] : []),
      readFiles: (name: string) => {
        void name;
        return Object.entries(libraryFiles)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([p, c]) => ({ path: p, content: Buffer.from(c, 'utf8') }));
      },
      updateFromDirectory: (
        _files: Map<string, Buffer>,
        options: { origin: { hash: string } },
      ) => {
        updated.push({ originHash: options.origin.hash });
        return {
          name: 'raw-material-inventory',
          description: 'x',
          files: [],
          installed_at: 'T0',
          overwritten: true,
        };
      },
    } as unknown as SkillLibraryService;
  }

  function marketHash(): string {
    return readMarketSkillPackage(root, REF).hash;
  }

  it('库内不存在同名 → VALIDATION_FAILED（更新不凭空创建，MUST 走导入）', () => {
    const updated: Array<{ originHash: string | null }> = [];
    let caught: unknown;
    try {
      updateOntoMarketSkill(root, updatableLibrary(null, MARKET_FILES, updated), REF, {
        confirmModified: false,
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(updated).toHaveLength(0);
  });

  it('库内同名技能并非来自市场 → ADM_SKILL_NAME_TAKEN（其他来源永不接受市场覆盖）', () => {
    const updated: Array<{ originHash: string | null }> = [];
    let caught: unknown;
    try {
      updateOntoMarketSkill(root, updatableLibrary({ name: 'raw-material-inventory' }, MARKET_FILES, updated), REF, {
        confirmModified: false,
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_SKILL_NAME_TAKEN);
    expect(updated).toHaveLength(0);
  });

  it('市场里挪了位置（scenario/ontology 不符）→ VALIDATION_FAILED', () => {
    const updated: Array<{ originHash: string | null }> = [];
    const record = {
      name: 'raw-material-inventory',
      origin: { kind: 'onto_market', scenario: '其他场景', ontology: '其他本体', hash: marketHash() },
    };
    let caught: unknown;
    try {
      updateOntoMarketSkill(root, updatableLibrary(record, MARKET_FILES, updated), REF, {
        confirmModified: false,
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(updated).toHaveLength(0);
  });

  it('库内未被人工修改 → 无需确认即更新；origin.hash 换为市场现哈希', () => {
    const updated: Array<{ originHash: string | null }> = [];
    const record = {
      name: 'raw-material-inventory',
      origin: { kind: 'onto_market', scenario: '生产调度', ontology: '原材料采购和库存', hash: marketHash() },
    };
    const result = updateOntoMarketSkill(root, updatableLibrary(record, MARKET_FILES, updated), REF, {
      confirmModified: false,
    });

    expect(result.locally_modified).toBe(false);
    expect(result.overwritten).toBe(true);
    expect(updated).toHaveLength(1);
    expect(updated[0]!.originHash).toBe(marketHash());
  });

  it('库内被人工修改过 + 未确认 → ADM_SKILL_MODIFIED 且不执行更新', () => {
    const updated: Array<{ originHash: string | null }> = [];
    const record = {
      name: 'raw-material-inventory',
      origin: { kind: 'onto_market', scenario: '生产调度', ontology: '原材料采购和库存', hash: marketHash() },
    };
    const modified = { ...MARKET_FILES, 'SKILL.md': SKILL_MD.replace('正文', '正文（人工改）') };
    let caught: unknown;
    try {
      updateOntoMarketSkill(root, updatableLibrary(record, modified, updated), REF, {
        confirmModified: false,
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.ADM_SKILL_MODIFIED);
    expect(updated).toHaveLength(0);
  });

  it('库内被人工修改过 + confirm=true → 更新成功且 locally_modified=true', () => {
    const updated: Array<{ originHash: string | null }> = [];
    const record = {
      name: 'raw-material-inventory',
      origin: { kind: 'onto_market', scenario: '生产调度', ontology: '原材料采购和库存', hash: marketHash() },
    };
    const modified = { ...MARKET_FILES, 'SKILL.md': SKILL_MD.replace('正文', '正文（人工改）') };
    const result = updateOntoMarketSkill(root, updatableLibrary(record, modified, updated), REF, {
      confirmModified: true,
    });

    expect(result.locally_modified).toBe(true);
    expect(updated).toHaveLength(1);
    expect(updated[0]!.originHash).toBe(marketHash());
  });

  it('未配置 ONTO_MARKET_DIR → VALIDATION_FAILED', () => {
    let caught: unknown;
    try {
      updateOntoMarketSkill(null, updatableLibrary(null, MARKET_FILES, []), REF, {
        confirmModified: false,
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});
