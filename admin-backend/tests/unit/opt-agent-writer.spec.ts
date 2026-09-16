/**
 * 单元测试：`.opt-agent` 物化写入与撤回（T063）
 *
 * 覆盖 `FR-008`（原子）、`FR-029`（失败零残留）、`FR-028`（只动 `agents/`）
 * 与 `research.md` D8 的 **`EXDEV` 降级路径**。
 *
 * 2026-09-16 起 `agents/` 为**整体覆盖**：本次不在列的一切条目都被移除
 * （原先"只移除部署清单内的"会让旧目录在清单对不上时永远留下）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import { OptAgentWriter, type MaterializeFile } from '../../src/infra/opt-agent-writer.js';

let root: string;

function file(relPath: string, content: string): MaterializeFile {
  return { relPath, content };
}

function artifact(name: string, soul: string) {
  return { name, files: [file('SOUL.md', soul), file('TOOL.json', '{"enabled":[]}\n')] };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'opt-agent-writer-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('OptAgentWriter', () => {
  it('首次物化：创建数字人目录与全部文件', () => {
    const writer = new OptAgentWriter({ optAgentRoot: root });
    const result = writer.commitUser('admin', [artifact('demo', '你好')]);

    expect(result.written).toEqual(['demo']);
    expect(fs.readFileSync(writer.agentDir('admin', 'demo') + '/SOUL.md', 'utf8')).toBe('你好');
  });

  it('整体覆盖：上一版存在而本版未搭配的文件 MUST NOT 残留（FR-026）', () => {
    const writer = new OptAgentWriter({ optAgentRoot: root });
    writer.commitUser('admin', [
      { name: 'demo', files: [file('SOUL.md', 'v1'), file('legacy.json', '{}')] },
    ]);
    writer.commitUser('admin', [artifact('demo', 'v2')]);

    const dir = writer.agentDir('admin', 'demo');
    expect(fs.readdirSync(dir).sort()).toEqual(['SOUL.md', 'TOOL.json']);
    expect(fs.readFileSync(path.join(dir, 'SOUL.md'), 'utf8')).toBe('v2');
  });

  it('幂等：相同内容重复部署结果稳定（FR-030）', () => {
    const writer = new OptAgentWriter({ optAgentRoot: root });
    writer.commitUser('admin', [artifact('demo', 'same')]);
    const first = fs.readFileSync(writer.agentDir('admin', 'demo') + '/SOUL.md', 'utf8');
    writer.commitUser('admin', [artifact('demo', 'same')]);
    expect(fs.readFileSync(writer.agentDir('admin', 'demo') + '/SOUL.md', 'utf8')).toBe(first);
  });

  it('清理临时与备份目录：不留 .deploy-* 残留', () => {
    const writer = new OptAgentWriter({ optAgentRoot: root });
    writer.commitUser('admin', [artifact('demo', 'x')]);
    writer.commitUser('admin', [artifact('demo', 'y')]);
    const leftovers = fs
      .readdirSync(path.join(root, 'users', 'admin'))
      .filter((name) => name.startsWith('.deploy-'));
    expect(leftovers).toEqual([]);
  });

  it('整体覆盖：本次不在列的数字人目录会被移除（"去掉关联再部署"必定下架）', () => {
    const writer = new OptAgentWriter({ optAgentRoot: root });
    writer.commitUser('admin', [artifact('a', '1'), artifact('b', '2')]);

    const result = writer.commitUser('admin', [artifact('a', '1')]);
    expect(result.removed).toEqual(['b']);
    expect(fs.existsSync(writer.agentDir('admin', 'b'))).toBe(false);
    expect(fs.existsSync(writer.agentDir('admin', 'a'))).toBe(true);
  });

  it('整体覆盖同样清掉手工放进 agents/ 的目录（该目录由平台独占管理）', () => {
    const writer = new OptAgentWriter({ optAgentRoot: root });
    const foreign = writer.agentDir('admin', 'manual-agent');
    fs.mkdirSync(foreign, { recursive: true });
    fs.writeFileSync(path.join(foreign, 'SOUL.md'), '手工创建', 'utf8');

    const result = writer.commitUser('admin', [artifact('demo', 'x')]);

    expect(result.removed).toEqual(['manual-agent']);
    expect(fs.existsSync(foreign)).toBe(false);
  });

  it('撤回：清空全部数字人目录，用户文件空间与其余内容原样保留', () => {
    const writer = new OptAgentWriter({ optAgentRoot: root });
    writer.commitUser('admin', [artifact('a', '1'), artifact('b', '2')]);
    const shared = path.join(root, 'users', 'admin', 'user-data', '共享空间');
    fs.mkdirSync(shared, { recursive: true });
    fs.writeFileSync(path.join(shared, 'keep.txt'), 'keep', 'utf8');

    const withdrawn = writer.withdrawUser('admin');

    expect(withdrawn).toEqual(['a', 'b']);
    expect(fs.existsSync(path.join(root, 'users', 'admin', 'agents'))).toBe(false);
    expect(fs.readFileSync(path.join(shared, 'keep.txt'), 'utf8')).toBe('keep');
    // 不留 .withdraw-* 备份残留
    const leftovers = fs
      .readdirSync(path.join(root, 'users', 'admin'))
      .filter((name) => name.startsWith('.withdraw-'));
    expect(leftovers).toEqual([]);
  });

  it('撤回：从未部署过的用户是幂等的空操作（不抛错、不建目录）', () => {
    const writer = new OptAgentWriter({ optAgentRoot: root });
    expect(writer.withdrawUser('never-deployed')).toEqual([]);
    expect(fs.existsSync(path.join(root, 'users', 'never-deployed'))).toBe(false);
  });

  it('撤回后再部署可恢复，且不带回旧内容', () => {
    const writer = new OptAgentWriter({ optAgentRoot: root });
    writer.commitUser('admin', [artifact('demo', 'v1'), artifact('old', 'x')]);
    writer.withdrawUser('admin');
    writer.commitUser('admin', [artifact('demo', 'v2')]);

    const dir = writer.agentDir('admin', 'demo');
    expect(fs.readFileSync(path.join(dir, 'SOUL.md'), 'utf8')).toBe('v2');
    expect(fs.existsSync(writer.agentDir('admin', 'old'))).toBe(false);
  });

  it('作用域：只写 users/{uid}/agents/，文件空间内容 100% 不变（FR-028）', () => {
    const writer = new OptAgentWriter({ optAgentRoot: root });
    const prep = path.join(root, 'users', 'admin', 'user-data', '数据准备', '生产计划');
    fs.mkdirSync(prep, { recursive: true });
    fs.writeFileSync(path.join(prep, 'a.csv'), 'x,y\n1,2\n', 'utf8');

    writer.commitUser('admin', [artifact('demo', 'x')]);

    expect(fs.readFileSync(path.join(prep, 'a.csv'), 'utf8')).toBe('x,y\n1,2\n');
  });

  it('失败零残留：目标父路径被文件占据时抛错、回滚、且不留备份目录', () => {
    const writer = new OptAgentWriter({ optAgentRoot: root });
    // 用一个文件占住 users/{uid}/agents，使 mkdir/rename 必然失败
    fs.mkdirSync(path.join(root, 'users', 'blocked'), { recursive: true });
    fs.writeFileSync(path.join(root, 'users', 'blocked', 'agents'), 'not-a-dir', 'utf8');

    expect(() => writer.commitUser('blocked', [artifact('demo', 'x')])).toThrow(ApiError);
    const leftovers = fs
      .readdirSync(path.join(root, 'users', 'blocked'))
      .filter((name) => name.startsWith('.deploy-'));
    expect(leftovers).toEqual([]);
  });

  it('EXDEV 降级路径被覆盖：rename 不可用时改为逐文件替换且结果正确', () => {
    const renameCalls: Array<[string, string]> = [];
    const writer = new OptAgentWriter({
      optAgentRoot: root,
      renameImpl: (from, to) => {
        renameCalls.push([from, to]);
        const err = new Error('cross-device link not permitted') as NodeJS.ErrnoException;
        err.code = 'EXDEV';
        throw err;
      },
    });

    const result = writer.commitUser('admin', [artifact('demo', '降级内容')]);

    expect(renameCalls.length).toBeGreaterThan(0);
    expect(result.written).toEqual(['demo']);
    expect(fs.readFileSync(writer.agentDir('admin', 'demo') + '/SOUL.md', 'utf8')).toBe('降级内容');
    // 降级后不得残留临时目录
    const leftovers = fs
      .readdirSync(path.join(root, 'users', 'admin'))
      .filter((name) => name.startsWith('.deploy-'));
    expect(leftovers).toEqual([]);
  });

  it('EXDEV 降级同样支持覆盖已存在目录', () => {
    const writer = new OptAgentWriter({ optAgentRoot: root });
    writer.commitUser('admin', [{ name: 'demo', files: [file('SOUL.md', 'v1'), file('old.json', '{}')] }]);

    const downgrade = new OptAgentWriter({
      optAgentRoot: root,
      renameImpl: (_from, _to) => {
        const err = new Error('EXDEV') as NodeJS.ErrnoException;
        err.code = 'EXDEV';
        throw err;
      },
    });
    downgrade.commitUser('admin', [artifact('demo', 'v2')]);

    const dir = downgrade.agentDir('admin', 'demo');
    expect(fs.readdirSync(dir).sort()).toEqual(['SOUL.md', 'TOOL.json']);
    expect(fs.readFileSync(path.join(dir, 'SOUL.md'), 'utf8')).toBe('v2');
  });

  it('拒绝越界的物化相对路径与非法目录名', () => {
    const writer = new OptAgentWriter({ optAgentRoot: root });
    expect(() =>
      writer.commitUser('admin', [{ name: 'demo', files: [file('../escape.md', 'x')] }]),
    ).toThrow(ApiError);
    expect(() => writer.commitUser('../admin', [artifact('demo', 'x')])).toThrow(ApiError);
    expect(() => writer.commitUser('admin', [artifact('a/b', 'x')])).toThrow(ApiError);
  });
});
