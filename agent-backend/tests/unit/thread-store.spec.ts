/**
 * 单元测试：会话存储的删除路径（FR-010）。
 *
 * 守两条：
 * 1. **连带清理到位**：thread 目录 + 临时空间下 `{threadId}_` 前缀文件都删掉，
 *    且**不误伤**其它会话的目录与文件；
 * 2. **删除是异步接口**（返回 Promise）——它是「多文件 × 单次系统调用」的长耗时操作，
 *    同步实现会独占事件循环，把用户紧接着发出的"切换会话"请求一起拖慢
 *    （见 `src/domain/fs-safe.ts` 头部的实测说明）。
 *
 * 009：会话与临时空间都按**数字人**隔离，故所有调用都带数字人（`AGENT`）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SPACE_TMP, threadDir, userDataDir } from '../../src/domain/dirs.js';
import { ThreadNotFoundError, ThreadStore } from '../../src/domain/thread-store.js';

/** 本用例使用的数字人（数据域一级目录名） */
const AGENT = 'agent-a';

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
function putTmpFile(userId: string, agentName: string, name: string): string {
  const dir = path.join(userDataDir(root, userId, agentName), SPACE_TMP);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, '{}');
  return file;
}

describe('ThreadStore.delete', () => {
  it('删掉 thread 目录，并连带清掉临时空间里 `{threadId}_` 前缀文件', async () => {
    const meta = store.create('u1', AGENT);
    const ownTmp = putTmpFile('u1', AGENT, `${meta.threadId}_j_1.json`);

    await store.delete('u1', AGENT, meta.threadId);

    expect(fs.existsSync(threadDir(root, 'u1', AGENT, meta.threadId))).toBe(false);
    expect(fs.existsSync(ownTmp)).toBe(false);
  });

  it('**不误伤**其它会话的目录与 tmp 文件', async () => {
    const target = store.create('u1', AGENT);
    const neighbour = store.create('u1', AGENT);
    const neighbourTmp = putTmpFile('u1', AGENT, `${neighbour.threadId}_j_9.json`);
    const unrelated = putTmpFile('u1', AGENT, 'unrelated.json');

    await store.delete('u1', AGENT, target.threadId);

    expect(fs.existsSync(threadDir(root, 'u1', AGENT, neighbour.threadId))).toBe(true);
    expect(fs.existsSync(neighbourTmp)).toBe(true);
    expect(fs.existsSync(unrelated)).toBe(true);
  });

  it('临时空间不存在时也不报错（无可清理 ≠ 失败）', async () => {
    const meta = store.create('u1', AGENT);
    expect(fs.existsSync(path.join(userDataDir(root, 'u1', AGENT), SPACE_TMP))).toBe(false);

    await store.delete('u1', AGENT, meta.threadId);

    expect(fs.existsSync(threadDir(root, 'u1', AGENT, meta.threadId))).toBe(false);
  });

  it('会话不存在 → 抛 ThreadNotFoundError（与 get 同口径）', async () => {
    await expect(store.delete('u1', AGENT, 'ghost')).rejects.toBeInstanceOf(ThreadNotFoundError);
  });

  it('是**异步**接口（返回 Promise）——回归护栏：改回同步实现会在这里失败', async () => {
    const meta = store.create('u1', AGENT);

    const pending = store.delete('u1', AGENT, meta.threadId);
    expect(pending).toBeInstanceOf(Promise);

    await pending;
    expect(fs.existsSync(threadDir(root, 'u1', AGENT, meta.threadId))).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 009：会话归属与列表判据
 * ------------------------------------------------------------------ */

describe('ThreadStore —— 归属（009 FR-020/022）', () => {
  it('create 把归属写进 meta，且数据落在该数字人目录下', () => {
    const meta = store.create('u1', AGENT);

    expect(meta.agentName).toBe(AGENT);
    const file = threadDir(root, 'u1', AGENT, meta.threadId) + path.sep + 'meta.json';
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ agent_name: AGENT });
  });

  it('跨数字人取会话 → ThreadNotFoundError（与"不存在"不可区分，不泄露存在性）', () => {
    const meta = store.create('u1', AGENT);

    expect(() => store.get('u1', 'other-agent', meta.threadId)).toThrowError(ThreadNotFoundError);
    // 归属数字人自己仍取得到
    expect(store.get('u1', AGENT, meta.threadId).threadId).toBe(meta.threadId);
  });

  it('touch 只刷新 updated_at，**不改写归属**（回到旧语义会在这里失败）', async () => {
    const meta = store.create('u1', AGENT);
    const before = store.get('u1', AGENT, meta.threadId).updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));

    store.touch('u1', AGENT, meta.threadId);

    const after = store.get('u1', AGENT, meta.threadId);
    expect(after.updatedAt >= before).toBe(true);
    expect(after.agentName).toBe(AGENT);
  });

  it('会话 meta 里残留旧语义的 agent_name 时，一律以**目录作用域**为准', () => {
    const meta = store.create('u1', AGENT);
    const file = threadDir(root, 'u1', AGENT, meta.threadId) + path.sep + 'meta.json';
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    raw.agent_name = 'stale-agent';
    fs.writeFileSync(file, JSON.stringify(raw), 'utf8');

    expect(store.get('u1', AGENT, meta.threadId).agentName).toBe(AGENT);
  });

  it('list 与 countByAgent 都只统计本数字人的会话', () => {
    store.create('u1', AGENT);
    store.create('u1', 'other-agent');

    expect(store.countByAgent('u1', AGENT)).toBe(1);
    expect(store.countByAgent('u1', 'other-agent')).toBe(1);
    expect(store.countByAgent('u1', 'never-used')).toBe(0);
  });
});

describe('ThreadStore —— 列表判据：只看有消息的会话（009 FR-016）', () => {
  it('新建但尚无任何轮次的会话**不列出**（空对话是视图态，不落盘）', () => {
    store.create('u1', AGENT);

    expect(store.list('u1', AGENT)).toEqual([]);
  });

  it('一轮对话之后（updated_at 被刷新）即出现在列表里', () => {
    const meta = store.create('u1', AGENT);
    store.touch('u1', AGENT, meta.threadId);

    expect(store.list('u1', AGENT).map((m) => m.threadId)).toEqual([meta.threadId]);
  });

  it('updated_at 倒序：最新一条在前', async () => {
    const older = store.create('u1', AGENT);
    store.touch('u1', AGENT, older.threadId);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = store.create('u1', AGENT);
    store.touch('u1', AGENT, newer.threadId);

    expect(store.list('u1', AGENT).map((m) => m.threadId)).toEqual([
      newer.threadId,
      older.threadId,
    ]);
  });

  it('空对话留在磁盘上（只有不列出，不悄悄删）——用户仍可显式删除', async () => {
    const empty = store.create('u1', AGENT);
    expect(store.list('u1', AGENT)).toEqual([]);
    // 仍存在于磁盘
    expect(fs.existsSync(threadDir(root, 'u1', AGENT, empty.threadId))).toBe(true);

    await store.delete('u1', AGENT, empty.threadId);
    expect(fs.existsSync(threadDir(root, 'u1', AGENT, empty.threadId))).toBe(false);
  });
});
