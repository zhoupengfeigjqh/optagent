/**
 * 单元测试：会话存储的删除路径（FR-010）。
 *
 * 守两条：
 * 1. **连带清理到位**：thread 目录 + 临时空间下 `{threadId}_` 前缀文件都删掉，
 *    且**不误伤**其它会话的目录与文件；
 * 2. **删除是异步接口**（返回 Promise）——它是「多文件 × 单次系统调用」的长耗时操作，
 *    同步实现会独占事件循环，把用户紧接着发出的"切换会话"请求一起拖慢
 *    （见 `src/domain/fs-safe.ts` 头部的实测说明）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SPACE_TMP, threadDir, userDataDir } from '../../src/domain/dirs.js';
import { ThreadNotFoundError, ThreadStore } from '../../src/domain/thread-store.js';

let root: string;
let store: ThreadStore;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-thread-store-'));
  store = new ThreadStore(root);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** 在临时空间放一个文件（模拟该会话的 tmp 产出），返回其绝对路径 */
function putTmpFile(userId: string, name: string): string {
  const dir = path.join(userDataDir(root, userId), SPACE_TMP);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, '{}');
  return file;
}

describe('ThreadStore.delete', () => {
  it('删掉 thread 目录，并连带清掉临时空间里 `{threadId}_` 前缀文件', async () => {
    const meta = store.create('u1', 'agent-a');
    const ownTmp = putTmpFile('u1', `${meta.threadId}_j_1.json`);

    await store.delete('u1', meta.threadId);

    expect(fs.existsSync(threadDir(root, 'u1', meta.threadId))).toBe(false);
    expect(fs.existsSync(ownTmp)).toBe(false);
  });

  it('**不误伤**其它会话的目录与 tmp 文件', async () => {
    const target = store.create('u1', 'agent-a');
    const neighbour = store.create('u1', 'agent-a');
    const neighbourTmp = putTmpFile('u1', `${neighbour.threadId}_j_9.json`);
    const unrelated = putTmpFile('u1', 'unrelated.json');

    await store.delete('u1', target.threadId);

    expect(fs.existsSync(threadDir(root, 'u1', neighbour.threadId))).toBe(true);
    expect(fs.existsSync(neighbourTmp)).toBe(true);
    expect(fs.existsSync(unrelated)).toBe(true);
  });

  it('临时空间不存在时也不报错（无可清理 ≠ 失败）', async () => {
    const meta = store.create('u1', 'agent-a');
    expect(fs.existsSync(path.join(userDataDir(root, 'u1'), SPACE_TMP))).toBe(false);

    await store.delete('u1', meta.threadId);

    expect(fs.existsSync(threadDir(root, 'u1', meta.threadId))).toBe(false);
  });

  it('会话不存在 → 抛 ThreadNotFoundError（与 get 同口径）', async () => {
    await expect(store.delete('u1', 'ghost')).rejects.toBeInstanceOf(ThreadNotFoundError);
  });

  it('是**异步**接口（返回 Promise）——回归护栏：改回同步实现会在这里失败', async () => {
    const meta = store.create('u1', 'agent-a');

    const pending = store.delete('u1', meta.threadId);
    expect(pending).toBeInstanceOf(Promise);

    await pending;
    expect(fs.existsSync(threadDir(root, 'u1', meta.threadId))).toBe(false);
  });
});
