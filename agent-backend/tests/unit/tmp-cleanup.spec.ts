/**
 * 单元测试：tmp/ 定期清理（R11 补充口径）
 *
 * 既有口径：顶层文件超 30 天未访问即删；`.upload-` 暂存残留按 1 小时清。
 * **本次补的漏洞**：二级目录原先被整目录跳过 ⇒ 后台产出**永不清理**，
 * 契约 §10.4 的"随临时空间既有规则清理"不成立。现在 `后台产出/` 按同一口径处理，
 * 且**只认已登记的子目录**（不递归任意目录，避免误删将来可能出现的其他子目录）。
 *
 * 009 补充：临时空间是**数字人级**的，定时任务改为按（用户 × 数字人）逐一清理
 * （`cleanupAllAgentTmpDirs`）——漏清或越界清都会让"30 天清理"这条契约对部分数字人失效。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRODUCED_SUBDIR, SPACE_TMP, userDataDir } from '../../src/domain/dirs.js';
import { cleanupAllAgentTmpDirs, cleanupTmpDir } from '../../src/domain/tmp-cleanup.js';

/**
 * 删除原语的替身：**默认转发真实实现**，只在个别用例里注入一次失败，
 * 用来覆盖"单个文件删除失败不中断整轮扫描"这条既有容错路径（原则九的降级口径）。
 */
const rmSpy = vi.hoisted(() => vi.fn());
vi.mock('../../src/domain/fs-safe.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/domain/fs-safe.js')>();
  rmSpy.mockImplementation(actual.removeFileSafeAsync);
  return { ...actual, removeFileSafeAsync: rmSpy };
});

const DAY = 24 * 60 * 60 * 1000;
let tmp: string;

/** 写一个"最后访问于 ageMs 之前"的文件（atime 与 mtime 同时设，判据取 max） */
function writeWithAge(rel: string, ageMs: number, content = 'x'): string {
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  const at = new Date(Date.now() - ageMs);
  fs.utimesSync(abs, at, at);
  return abs;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-cleanup-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('cleanupTmpDir —— 顶层（既有行为，MUST NOT 变化）', () => {
  it('超过 30 天未访问即删；未过期保留', async () => {
    const stale = writeWithAge('old.txt', 31 * DAY);
    const fresh = writeWithAge('fresh.txt', 1 * DAY);

    const result = await cleanupTmpDir(tmp);

    expect(result.deleted).toBe(1);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });

  it('上传暂存残留（.upload-）按 1 小时清理', async () => {
    const stale = writeWithAge('.upload-123', 2 * 60 * 60 * 1000);

    await cleanupTmpDir(tmp);

    expect(fs.existsSync(stale)).toBe(false);
  });
});

describe('cleanupTmpDir —— 后台产出子目录（R11 补的漏洞）', () => {
  it('子目录内的过期产出与 sidecar 一起被清理（原先整目录被跳过）', async () => {
    const body = writeWithAge(`${PRODUCED_SUBDIR}/p_j1.json`, 31 * DAY);
    const meta = writeWithAge(`${PRODUCED_SUBDIR}/p_j1.meta.json`, 31 * DAY);

    const result = await cleanupTmpDir(tmp);

    expect(result.deleted).toBe(2);
    expect(fs.existsSync(body)).toBe(false);
    expect(fs.existsSync(meta)).toBe(false);
  });

  it('未过期的产出保留（30 天窗口内）', async () => {
    const fresh = writeWithAge(`${PRODUCED_SUBDIR}/p_j2.json`, 1 * DAY);

    await cleanupTmpDir(tmp);

    expect(fs.existsSync(fresh)).toBe(true);
  });

  it('只认已登记的子目录：其他子目录不受影响', async () => {
    const other = writeWithAge('other-sub/x.txt', 31 * DAY);

    await cleanupTmpDir(tmp);

    expect(fs.existsSync(other)).toBe(true);
  });

  it('顶层与子目录在同一轮扫描里各自生效', async () => {
    const top = writeWithAge('old.txt', 31 * DAY);
    const produced = writeWithAge(`${PRODUCED_SUBDIR}/p_j3.json`, 31 * DAY);

    const result = await cleanupTmpDir(tmp);

    expect(result.deleted).toBe(2);
    expect(fs.existsSync(top)).toBe(false);
    expect(fs.existsSync(produced)).toBe(false);
  });

  it('清理动作有日志留痕（顶层与产出子目录各自可读）', async () => {
    const infos: string[] = [];
    writeWithAge('old.txt', 31 * DAY);
    writeWithAge(`${PRODUCED_SUBDIR}/p_j9.json`, 31 * DAY);

    await cleanupTmpDir(tmp, {
      logger: {
        warn: (msg) => infos.push(`warn:${msg}`),
        info: (msg) => infos.push(`info:${msg}`),
      },
    });

    const joined = infos.join('\n');
    expect(joined).toContain('old.txt');
    expect(joined).toContain(PRODUCED_SUBDIR);
  });

  it('目录不存在：视为无可清理，不抛错', async () => {
    const result = await cleanupTmpDir(path.join(tmp, 'not-exists'));
    expect(result).toEqual({ deleted: 0, failed: 0 });
  });

  it('条目在扫描间隙消失（stat 失败）：跳过即可，不抛错也不虚报', async () => {
    writeWithAge('gone.txt', 31 * DAY);
    writeWithAge(`${PRODUCED_SUBDIR}/gone2.txt`, 31 * DAY);
    const statSpy = vi.spyOn(fs.promises, 'stat').mockRejectedValue(new Error('ENOENT'));

    try {
      expect(await cleanupTmpDir(tmp)).toEqual({ deleted: 0, failed: 0 });
    } finally {
      statSpy.mockRestore();
    }
  });

  it('上传暂存残留的 stat 失败：跳过不抛错（与 30 天规则各自容错）', async () => {
    writeWithAge('.upload-ghost', 2 * 60 * 60 * 1000);
    const statSpy = vi.spyOn(fs.promises, 'stat').mockRejectedValue(new Error('ENOENT'));

    try {
      expect(await cleanupTmpDir(tmp)).toEqual({ deleted: 0, failed: 0 });
    } finally {
      statSpy.mockRestore();
    }
  });

  it('上传暂存残留删除失败：同样只计数不中断（与 30 天规则那条各走各的容错）', async () => {
    writeWithAge('.upload-stale', 2 * 60 * 60 * 1000);
    rmSpy.mockRejectedValueOnce(new Error('EPERM: 拒绝访问'));

    const result = await cleanupTmpDir(tmp);
    expect(result).toEqual({ deleted: 0, failed: 1 });
  });

  it('产出子目录不可读：视为无可清理（不抛错，也不影响顶层）', async () => {
    writeWithAge('top-old.txt', 31 * DAY);
    writeWithAge(`${PRODUCED_SUBDIR}/p_j7.json`, 31 * DAY);
    // 顶层 readdir 走真实实现，子目录那次注入失败
    const realReaddir = fs.promises.readdir.bind(fs.promises);
    const readdirSpy = vi
      .spyOn(fs.promises, 'readdir')
      .mockImplementationOnce(realReaddir)
      .mockRejectedValueOnce(new Error('EACCES: 权限不足'));

    try {
      const result = await cleanupTmpDir(tmp);
      expect(result).toEqual({ deleted: 1, failed: 0 }); // 顶层那个照常删
    } finally {
      readdirSpy.mockRestore();
    }
  });

  it('产出子目录内删除失败：只计数不中断', async () => {
    writeWithAge(`${PRODUCED_SUBDIR}/p_j8.json`, 31 * DAY);
    rmSpy.mockRejectedValueOnce(new Error('EPERM: 拒绝访问'));

    const warns: string[] = [];
    const result = await cleanupTmpDir(tmp, {
      logger: { warn: (msg) => warns.push(msg), info: () => {} },
    });

    expect(result).toEqual({ deleted: 0, failed: 1 });
    expect(warns.join('\n')).toContain(PRODUCED_SUBDIR);
  });

  it('单个条目删除失败：只计数不中断，其余照常清理', async () => {
    const first = writeWithAge('a.txt', 31 * DAY);
    const second = writeWithAge('b.txt', 31 * DAY);
    rmSpy.mockRejectedValueOnce(new Error('EPERM: 拒绝访问'));

    const warns: string[] = [];
    const result = await cleanupTmpDir(tmp, {
      logger: { warn: (msg) => warns.push(msg), info: () => {} },
    });

    expect(result.failed).toBe(1);
    expect(result.deleted).toBe(1);
    expect(warns.join('\n')).toContain('失败');
    // 失败的那个仍在（不因一个失败就"假装删掉了"）
    expect([fs.existsSync(first), fs.existsSync(second)].filter(Boolean)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * 009：按（用户 × 数字人）逐一清理
 * ------------------------------------------------------------------ */

describe('cleanupAllAgentTmpDirs —— 数字人级临时空间遍历（009）', () => {
  /** 建某用户的某数字人数据域，并放一个过期文件；返回该文件的绝对路径 */
  function seedAgentTmp(
    userId: string,
    agentName: string,
    fileName: string,
    ageMs = 31 * DAY,
  ): string {
    const abs = path.join(userDataDir(tmp, userId, agentName), SPACE_TMP, fileName);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x', 'utf8');
    const at = new Date(Date.now() - ageMs);
    fs.utimesSync(abs, at, at);
    return abs;
  }

  it('逐一清理每个数字人：同一用户多个数字人都不漏', async () => {
    const a = seedAgentTmp('admin', 'agent-a', 'a_j1.json');
    const b = seedAgentTmp('admin', 'agent-b', 'b_j1.json');
    const c = seedAgentTmp('bob', 'agent-c', 'c_j1.json');

    const result = await cleanupAllAgentTmpDirs(tmp, ['admin', 'bob'], () => [
      'agent-a',
      'agent-b',
      'agent-c',
    ]);

    expect(result.deleted).toBe(3);
    expect(result.dirs).toBe(6); // 2 用户 × 3 数字人（不存在的目录按 0 计账）
    for (const abs of [a, b, c]) expect(fs.existsSync(abs)).toBe(false);
  });

  it('某数字人临时空间不存在 → 跳过，不抛错', async () => {
    seedAgentTmp('admin', 'agent-a', 'a_j1.json');

    const result = await cleanupAllAgentTmpDirs(tmp, ['admin'], () => ['agent-a', 'never-used']);

    expect(result).toMatchObject({ deleted: 1, failed: 0, dirs: 2 });
  });

  it('**不越界**：只清清单内数字人的临时空间，他人/未列出的数字人一律不碰', async () => {
    const inside = seedAgentTmp('admin', 'agent-a', 'a_j1.json');
    const outsider = seedAgentTmp('admin', 'agent-other', 'other_j1.json');
    const otherUser = seedAgentTmp('bob', 'agent-a', 'bob_j1.json');

    const result = await cleanupAllAgentTmpDirs(tmp, ['admin'], () => ['agent-a']);

    expect(result.deleted).toBe(1);
    expect(fs.existsSync(inside)).toBe(false);
    expect(fs.existsSync(outsider)).toBe(true); // 不在清单内：保留（已移除数字人的数据也不清）
    expect(fs.existsSync(otherUser)).toBe(true); // 别人的同名数字人：保留
  });

  it('某个数字人清理失败不中断其余（逐个独立计账）', async () => {
    seedAgentTmp('admin', 'agent-a', 'a_j1.json');
    seedAgentTmp('admin', 'agent-b', 'b_j1.json');
    rmSpy.mockRejectedValueOnce(new Error('EPERM: 拒绝访问'));

    const result = await cleanupAllAgentTmpDirs(tmp, ['admin'], () => ['agent-a', 'agent-b']);

    expect(result.failed).toBe(1);
    expect(result.deleted).toBe(1);
  });

  it('有删除动作时落一行汇总日志（便于运维核对"跑没跑、清了多少"）', async () => {
    seedAgentTmp('admin', 'agent-a', 'a_j1.json');
    const infos: string[] = [];

    await cleanupAllAgentTmpDirs(tmp, ['admin'], () => ['agent-a'], {
      logger: { warn: () => {}, info: (msg) => infos.push(msg) },
    });

    expect(infos.join('\n')).toContain('1');
  });

  it('无可清理内容时不产生噪音日志', async () => {
    const infos: string[] = [];

    await cleanupAllAgentTmpDirs(tmp, ['admin'], () => ['never-used'], {
      logger: { warn: () => {}, info: (msg) => infos.push(msg) },
    });

    expect(infos).toEqual([]);
  });
});
