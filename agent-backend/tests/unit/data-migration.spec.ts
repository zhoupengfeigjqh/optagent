/**
 * 单元测试：存量数据布局迁移（009 FR-040~042，`domain/data-migration.ts`）
 *
 * 守住五件事：
 * 1. **归属判定确定性**：①当前选中（须在可用清单内）→②唯一→③名称升序第一；③ 落审计；
 *    清单为空 ⇒ **不迁移**、原地保留
 * 2. **迁移是逐项原子改名**：源一级条目整体搬进归属数字人目录；目标同名**跳过不覆盖**
 * 3. **幂等**：源目录不存在即返回（重复调用不产生副作用），迁空的源目录被清掉
 * 4. **不误搬**：名字已是某个数字人的一级目录（新布局）原样不动；
 *    **已撤销数字人**的数据域目录（不在 `agents/` 清单内）同样原样不动——撤销只清 `agents/`，
 *    数据保留在 `user-data/{数字人}/`，MUST NOT 被当成旧布局残留搬进别人的数据域（2026-10-23 回归）
 * 5. **失败保持原状**：跨卷（EXDEV）MUST 落 `error`（`alert: true`）并跳过该项，MUST NOT 降级为复制
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MigrationLogger } from '../../src/domain/data-migration.js';
import {
  listUserIds,
  migrateAllUsers,
  migrateUserDataLayout,
  resolveOwnerAgent,
} from '../../src/domain/data-migration.js';
import {
  THREADS_DIR,
  ensureAgentDataDirs,
  userDataDir,
  userDataRoot,
} from '../../src/domain/dirs.js';

const userId = 'admin';
/** 迁移的四类一级条目（改前布局） */
const LEGACY_ENTRIES = ['共享空间', '临时空间', '数据准备', THREADS_DIR];

let root: string;

interface RecordedLog {
  level: 'info' | 'warn' | 'error';
  fields: Record<string, unknown>;
}

function makeLogger(logs: RecordedLog[]): MigrationLogger {
  return {
    info: (fields) => logs.push({ level: 'info', fields }),
    warn: (fields) => logs.push({ level: 'warn', fields }),
    error: (fields) => logs.push({ level: 'error', fields }),
  };
}

/** 建"改前"布局：user-data/ 下直接放四类条目，各带一个可辨认的文件 */
function seedLegacyLayout(): void {
  const base = userDataRoot(root, userId);
  for (const entry of LEGACY_ENTRIES) {
    fs.mkdirSync(path.join(base, entry), { recursive: true });
    fs.writeFileSync(path.join(base, entry, `marker-${entry}.txt`), entry, 'utf8');
  }
}

/** 建一个可用数字人的配置目录（`agents/{name}/`） */
function seedAgent(name: string): void {
  const dir = path.join(root, 'users', userId, 'agents', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SOUL.md'), '你是助手。\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
  fs.writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'data-migration-'));
  fs.mkdirSync(path.join(root, 'users', userId), { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('归属判定 resolveOwnerAgent', () => {
  it('①当前选中且**在可用清单内** → 取当前选中（reason=current）', () => {
    seedAgent('a-数字人');
    seedAgent('b-数字人');

    expect(resolveOwnerAgent(root, userId, { currentAgentName: 'b-数字人' })).toMatchObject({
      agentName: 'b-数字人',
      reason: 'current',
    });
  });

  it('①当前选中**不在**清单内（已被移除）→ 降级到清单判定', () => {
    seedAgent('a-数字人');
    seedAgent('b-数字人');

    expect(resolveOwnerAgent(root, userId, { currentAgentName: 'ghost' })).toMatchObject({
      agentName: 'a-数字人', // 清单升序第一（②③ 同解）
    });
  });

  it('②清单唯一 → 取它（reason=single）', () => {
    seedAgent('only-数字人');

    expect(resolveOwnerAgent(root, userId)).toMatchObject({
      agentName: 'only-数字人',
      reason: 'single',
    });
  });

  it('③清单多个且无选中态 → 名称升序第一，并带上候选清单备查（reason=first）', () => {
    seedAgent('b-数字人');
    seedAgent('a-数字人');

    const decision = resolveOwnerAgent(root, userId);
    expect(decision).toMatchObject({ agentName: 'a-数字人', reason: 'first' });
    expect(decision?.candidates).toEqual(['a-数字人', 'b-数字人']);
  });

  it('清单为空 → undefined（不迁移）', () => {
    expect(resolveOwnerAgent(root, userId)).toBeUndefined();
  });
});

describe('migrateUserDataLayout —— 正常迁移', () => {
  it('四类条目整体搬进归属数字人目录，源目录被清掉', () => {
    seedLegacyLayout();
    seedAgent('only-数字人');
    const logs: RecordedLog[] = [];

    const result = migrateUserDataLayout(root, userId, { logger: makeLogger(logs) });

    expect(result).toMatchObject({
      status: 'migrated',
      ownerAgent: 'only-数字人',
      ownerReason: 'single',
      movedCount: LEGACY_ENTRIES.length,
      skipped: [],
      failed: [],
    });

    const dst = userDataDir(root, userId, 'only-数字人');
    for (const entry of LEGACY_ENTRIES) {
      expect(fs.existsSync(path.join(dst, entry, `marker-${entry}.txt`))).toBe(true);
    }
    // 用户级落点的直接子项此后**只有数字人目录**（FR-002：用户级不再是数据域）
    expect(fs.readdirSync(userDataRoot(root, userId))).toEqual(['only-数字人']);

    // 审计事件：start → owner → moved×4 → done
    const events = logs.map((l) => l.fields.event);
    expect(events[0]).toBe('data.migration.start');
    expect(events[1]).toBe('data.migration.owner');
    expect(events.filter((e) => e === 'data.migration.moved')).toHaveLength(LEGACY_ENTRIES.length);
    expect(events.at(-1)).toBe('data.migration.done');
    expect(logs.find((l) => l.fields.event === 'data.migration.done')?.fields).toMatchObject({
      uid: userId,
      owner_agent: 'only-数字人',
      moved_count: LEGACY_ENTRIES.length,
    });
  });

  it('③ 名称升序第一被采用时，审计里留下 reason 与 candidates（可复核）', () => {
    seedLegacyLayout();
    seedAgent('b-数字人');
    seedAgent('a-数字人');
    const logs: RecordedLog[] = [];

    const result = migrateUserDataLayout(root, userId, { logger: makeLogger(logs) });

    expect(result.ownerAgent).toBe('a-数字人');
    expect(logs.find((l) => l.fields.event === 'data.migration.owner')?.fields).toMatchObject({
      owner_agent: 'a-数字人',
      reason: 'first',
      candidates: ['a-数字人', 'b-数字人'],
    });
  });

  it('迁移同时在**该数字人**下建齐三空间 + threads（与迁移内容合并，不覆盖）', () => {
    seedLegacyLayout();
    seedAgent('only-数字人');

    migrateUserDataLayout(root, userId);

    const dst = userDataDir(root, userId, 'only-数字人');
    expect(fs.existsSync(path.join(dst, '数据准备'))).toBe(true);
    expect(fs.existsSync(path.join(dst, '临时空间'))).toBe(true);
    expect(fs.existsSync(path.join(dst, '共享空间'))).toBe(true);
    expect(fs.existsSync(path.join(dst, THREADS_DIR))).toBe(true);
  });
});

describe('migrateUserDataLayout —— 幂等与冲突', () => {
  it('源目录不存在 → no-source（不建任何东西，重复调用无副作用）', () => {
    seedAgent('only-数字人');
    const first = migrateUserDataLayout(root, userId);
    const second = migrateUserDataLayout(root, userId);

    expect(first.status).toBe('no-source');
    expect(second.status).toBe('no-source');
    expect(fs.existsSync(userDataDir(root, userId, 'only-数字人'))).toBe(false);
  });

  it('迁移完成后再调用 → 仍为 no-source（源已不存在）', () => {
    seedLegacyLayout();
    seedAgent('only-数字人');

    expect(migrateUserDataLayout(root, userId).status).toBe('migrated');
    expect(migrateUserDataLayout(root, userId).status).toBe('no-source');
  });

  it('源目录存在但为空 → 清掉空壳并按 no-source 返回', () => {
    fs.mkdirSync(userDataRoot(root, userId), { recursive: true });
    seedAgent('only-数字人');

    const logs: RecordedLog[] = [];
    const result = migrateUserDataLayout(root, userId, { logger: makeLogger(logs) });

    expect(result.status).toBe('no-source');
    expect(fs.existsSync(userDataRoot(root, userId))).toBe(false);
    expect(logs).toHaveLength(0); // 无可迁移内容：不产生噪音审计
  });

  it('目标已存在同名条目 → **跳过且不覆盖**，审计留痕，源保留待人工处理', () => {
    seedLegacyLayout();
    seedAgent('only-数字人');
    const dst = userDataDir(root, userId, 'only-数字人');
    fs.mkdirSync(path.join(dst, '共享空间'), { recursive: true });
    fs.writeFileSync(path.join(dst, '共享空间', 'existing.txt'), 'existing', 'utf8');

    const logs: RecordedLog[] = [];
    const result = migrateUserDataLayout(root, userId, { logger: makeLogger(logs) });

    expect(result.skipped).toEqual(['共享空间']);
    expect(result.movedCount).toBe(LEGACY_ENTRIES.length - 1);
    // 目标内容原样保留（不合并、不覆盖）
    expect(fs.readFileSync(path.join(dst, '共享空间', 'existing.txt'), 'utf8')).toBe('existing');
    expect(fs.existsSync(path.join(dst, '共享空间', 'marker-共享空间.txt'))).toBe(false);
    // 源目录仍有跳过项 → 不清掉（下次触发继续尝试）
    expect(fs.existsSync(path.join(userDataRoot(root, userId), '共享空间'))).toBe(true);
    expect(logs.find((l) => l.fields.event === 'data.migration.skipped')?.fields).toMatchObject({
      entry: '共享空间',
      reason: 'target_exists',
    });
  });

  it('名单内的数字人数据目录（含归属者自己）原样不动 —— 不把新布局搬进另一个数字人', () => {
    seedLegacyLayout();
    seedAgent('a-数字人');
    seedAgent('z-数字人');
    // z 已有数据域（新布局），且里面有内容
    const zDir = userDataDir(root, userId, 'z-数字人');
    fs.mkdirSync(path.join(zDir, '共享空间'), { recursive: true });
    fs.writeFileSync(path.join(zDir, '共享空间', 'z.txt'), 'z', 'utf8');

    const result = migrateUserDataLayout(root, userId); // ③ → a-数字人

    expect(result.ownerAgent).toBe('a-数字人');
    expect(result.skipped).toEqual([]);
    expect(fs.readFileSync(path.join(zDir, '共享空间', 'z.txt'), 'utf8')).toBe('z');
    expect(fs.existsSync(path.join(userDataDir(root, userId, 'a-数字人'), 'z-数字人'))).toBe(false);
  });

  it('目标同名项是**空目录**（骨架先被建出来 / 上次中断的空壳）→ 搬进去，不把数据留在旧位', async () => {
    seedLegacyLayout();
    seedAgent('only-数字人');
    // 模拟"半成品"：骨架（三空间 + threads）先被建出来，但里面什么都没有
    ensureAgentDataDirs(root, userId, 'only-数字人');
    const logs: RecordedLog[] = [];

    const result = migrateUserDataLayout(root, userId, { logger: makeLogger(logs) });

    expect(result.movedCount).toBe(LEGACY_ENTRIES.length);
    expect(result.skipped).toEqual([]); // 空目标不是冲突：让位即可
    const dst = userDataDir(root, userId, 'only-数字人');
    for (const entry of LEGACY_ENTRIES) {
      expect(fs.existsSync(path.join(dst, entry, `marker-${entry}.txt`))).toBe(true);
    }
    // 用户级落点只剩数字人目录
    expect(fs.readdirSync(userDataRoot(root, userId))).toEqual(['only-数字人']);
    expect(logs.some((l) => l.fields.event === 'data.migration.rescued_empty_target')).toBe(true);
  });

  it('目标同名项**非空**才是硬冲突：该项跳过，其余项照常迁（已迁内容不被覆盖）', () => {
    seedLegacyLayout();
    seedAgent('only-数字人');
    const dst = userDataDir(root, userId, 'only-数字人');
    fs.mkdirSync(path.join(dst, '共享空间'), { recursive: true });
    fs.writeFileSync(path.join(dst, '共享空间', 'existing.txt'), 'existing', 'utf8');

    const result = migrateUserDataLayout(root, userId);

    expect(result.skipped).toEqual(['共享空间']);
    expect(result.movedCount).toBe(LEGACY_ENTRIES.length - 1);
    // 冲突项原样留在旧位，等人工处理；目标里的既有内容一字未改
    expect(
      fs.existsSync(path.join(userDataRoot(root, userId), '共享空间', 'marker-共享空间.txt')),
    ).toBe(true);
    expect(fs.readFileSync(path.join(dst, '共享空间', 'existing.txt'), 'utf8')).toBe('existing');
  });

  it('清单为空 → blocked：数据原地保留、不建目录、落 warn', () => {
    seedLegacyLayout();
    const logs: RecordedLog[] = [];

    const result = migrateUserDataLayout(root, userId, { logger: makeLogger(logs) });

    expect(result).toMatchObject({ status: 'blocked', ownerAgent: null, movedCount: 0 });
    expect(
      fs.readFileSync(
        path.join(userDataRoot(root, userId), '数据准备', 'marker-数据准备.txt'),
        'utf8',
      ),
    ).toBe('数据准备');
    expect(logs.at(-1)).toMatchObject({
      level: 'warn',
      fields: { event: 'data.migration.blocked', uid: userId, reason: 'no_available_agent' },
    });
  });

  it('配置损坏的数字人不进清单（与 listAgents 同口径）', () => {
    seedLegacyLayout();
    const brokenDir = path.join(root, 'users', userId, 'agents', 'broken');
    fs.mkdirSync(brokenDir, { recursive: true });
    fs.writeFileSync(path.join(brokenDir, 'SOUL.md'), '你是助手。\n', 'utf8');

    expect(migrateUserDataLayout(root, userId).status).toBe('blocked');
  });
});

describe('migrateUserDataLayout —— 已撤销数字人的数据域不参与迁移（2026-10-23 回归）', () => {
  /**
   * 造一个"已撤销数字人"的数据域：`user-data/{name}/` 下三空间 + threads + 一个可辨认文件。
   * 关键是它**不在** `agents/` 清单里（撤销后 `agents/` 已被整目录清掉）。
   */
  function seedRevokedAgentData(name: string): string {
    const dir = userDataDir(root, userId, name);
    ensureAgentDataDirs(root, userId, name);
    fs.writeFileSync(path.join(dir, THREADS_DIR, 'history.jsonl'), 'revoked', 'utf8');
    return dir;
  }

  it('只有已撤销数字人的数据域 → no-source：不搬、不建骨架、无审计噪音', () => {
    const revoked = seedRevokedAgentData('柯昆BOM数字人');
    seedAgent('BOM数字人');
    const logs: RecordedLog[] = [];

    const result = migrateUserDataLayout(root, userId, {
      currentAgentName: 'BOM数字人',
      logger: makeLogger(logs),
    });

    expect(result).toMatchObject({ status: 'no-source', ownerAgent: null, movedCount: 0 });
    // 数据留在自己的数据域里（撤销不撤数据）
    expect(fs.readFileSync(path.join(revoked, THREADS_DIR, 'history.jsonl'), 'utf8')).toBe('revoked');
    // MUST NOT 出现在当前选中的数字人目录下
    expect(fs.existsSync(path.join(userDataDir(root, userId, 'BOM数字人'), '柯昆BOM数字人'))).toBe(
      false,
    );
    expect(logs).toHaveLength(0);
  });

  it('旧布局四项 + 已撤销数字人数据域并存 → 只搬四个固定名，撤销目录原地保留', () => {
    seedLegacyLayout();
    const revoked = seedRevokedAgentData('柯昆BOM数字人');
    seedAgent('BOM数字人');

    const result = migrateUserDataLayout(root, userId, { currentAgentName: 'BOM数字人' });

    expect(result).toMatchObject({
      status: 'migrated',
      ownerAgent: 'BOM数字人',
      ownerReason: 'current',
      movedCount: LEGACY_ENTRIES.length,
      skipped: [],
      failed: [],
    });
    // 撤销目录未被搬动，也没被当成"目标冲突"参与判定
    expect(fs.readFileSync(path.join(revoked, THREADS_DIR, 'history.jsonl'), 'utf8')).toBe('revoked');
    expect(fs.existsSync(path.join(userDataDir(root, userId, 'BOM数字人'), '柯昆BOM数字人'))).toBe(
      false,
    );
    // 旧布局四项已搬入当前数字人
    const dst = userDataDir(root, userId, 'BOM数字人');
    for (const entry of LEGACY_ENTRIES) {
      expect(fs.existsSync(path.join(dst, entry, `marker-${entry}.txt`))).toBe(true);
    }
    // 源目录仍有"非旧布局条目" → 保留（等它自己的数字人回来，幂等）
    expect(fs.readdirSync(userDataRoot(root, userId)).sort()).toEqual(
      ['BOM数字人', '柯昆BOM数字人'].sort(),
    );
  });

  it('撤销后重新部署同一数字人 → 迁移不再把它的数据域搬给当前选中者', () => {
    const revoked = seedRevokedAgentData('z-已撤销');
    seedLegacyLayout();
    seedAgent('a-数字人');

    // ③ 名称升序第一 → a-数字人；z-已撤销 不属于旧布局，不得被搬
    const result = migrateUserDataLayout(root, userId);

    expect(result.ownerAgent).toBe('a-数字人');
    expect(fs.existsSync(path.join(userDataDir(root, userId, 'a-数字人'), 'z-已撤销'))).toBe(false);
    expect(fs.existsSync(path.join(revoked, THREADS_DIR, 'history.jsonl'))).toBe(true);
  });
});

describe('migrateUserDataLayout —— 失败保持原状（EXDEV）', () => {
  it('改名抛 EXDEV → 该项保持原状、记入 failed、落 error（alert），其余项照常迁移', () => {
    seedLegacyLayout();
    seedAgent('only-数字人');
    const logs: RecordedLog[] = [];

    const realRename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (String(from).endsWith('共享空间')) {
        const err = new Error('EXDEV: cross-device link not permitted') as NodeJS.ErrnoException;
        err.code = 'EXDEV';
        throw err;
      }
      return realRename(from, to);
    }) as typeof fs.renameSync);

    const result = migrateUserDataLayout(root, userId, { logger: makeLogger(logs) });

    expect(result.failed).toEqual(['共享空间']);
    expect(result.movedCount).toBe(LEGACY_ENTRIES.length - 1);
    // 保持原状：源里的内容没被动过，也没有被"复制"到目标
    expect(
      fs.existsSync(path.join(userDataRoot(root, userId), '共享空间', 'marker-共享空间.txt')),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(userDataDir(root, userId, 'only-数字人'), '共享空间', 'marker-共享空间.txt'),
      ),
    ).toBe(false);

    const errorLog = logs.find((l) => l.level === 'error');
    expect(errorLog?.fields).toMatchObject({
      alert: true,
      event: 'data.migration.error',
      uid: userId,
      entry: '共享空间',
      reason: 'EXDEV',
    });
  });
});

describe('listUserIds / migrateAllUsers', () => {
  it('listUserIds 列出 users/ 下的目录（缺失返回空数组）', () => {
    fs.mkdirSync(path.join(root, 'users', 'u1'), { recursive: true });
    fs.mkdirSync(path.join(root, 'users', 'u2'), { recursive: true });

    // beforeEach 已建出 users/admin（本用例自己的用户）
    expect(listUserIds(root)).toEqual(['admin', 'u1', 'u2']);
    expect(listUserIds(path.join(root, 'nowhere'))).toEqual([]);
  });

  it('migrateAllUsers 逐用户独立迁移，结果逐条返回（无数据的用户为 no-source）', () => {
    for (const uid of ['u1', 'u2']) {
      fs.mkdirSync(path.join(root, 'users', uid, 'user-data', '共享空间'), { recursive: true });
      const agentDir = path.join(root, 'users', uid, 'agents', 'only');
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, 'SOUL.md'), '你是助手。\n', 'utf8');
      fs.writeFileSync(path.join(agentDir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
      fs.writeFileSync(path.join(agentDir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');
    }

    const results = migrateAllUsers(root);

    const migrated = results.filter((r) => r.status === 'migrated');
    expect(migrated.map((r) => r.userId)).toEqual(['u1', 'u2']);
    expect(migrated.every((r) => r.ownerAgent === 'only')).toBe(true);
    // 没有存量数据的用户不迁移、也不报错
    expect(results.find((r) => r.userId === 'admin')?.status).toBe('no-source');
  });
});
