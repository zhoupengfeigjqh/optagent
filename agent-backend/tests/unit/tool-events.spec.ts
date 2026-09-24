/**
 * 单元测试：工具调用记录存储（002 特性）
 *
 * 守住四件事：
 * 1. **体积分流** —— 小结果内联进行、大结果外置成临时空间文件（且不双写）
 * 2. **合并语义** —— start(running) + end(终态) 按 call_id 合并，后者覆盖前者
 * 3. **降级不丢记录** —— 外置写入失败 / 未装配外置能力 → 退化为截断内联
 * 4. **路径不信任数据** —— 正文路径按 `{threadId, callId}` 重算，恶意 call_id 不越权
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SPACE_TMP, userDataDir } from '../../src/domain/dirs.js';
import { FileAccess } from '../../src/domain/file-access.js';
import { removeFileSafe } from '../../src/domain/fs-safe.js';
import { ToolEventStore } from '../../src/domain/tool-events.js';
import {
  TOOL_ARTIFACT_MAX_BYTES,
  TOOL_INLINE_MAX_BYTES,
  artifactFileName,
} from '../../src/domain/tool-result.js';

let root: string;

function makeStore(withArtifacts = true): ToolEventStore {
  return new ToolEventStore({
    root,
    ...(withArtifacts
      ? { artifacts: (userId: string) => new FileAccess({ optAgentRoot: root, userId }) }
      : {}),
  });
}

function appendEnd(
  store: ToolEventStore,
  input: { callId: string; resultText: string; status?: 'success' | 'error' },
): Promise<void> {
  return store.appendEnd('admin', 'th1', {
    callId: input.callId,
    messageId: 'm_a1',
    name: 'read_file',
    startedAt: '2026-09-23T00:00:00.000Z',
    status: input.status ?? 'success',
    durationMs: 12,
    resultText: input.resultText,
  });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-events-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('tool-events —— 体积分流', () => {
  it('小结果内联进 JSONL，且不产生临时空间文件', async () => {
    const store = makeStore();
    await appendEnd(store, { callId: 'call_a', resultText: '车间,计划量\n冲压,1200' });

    const records = store.readAll('admin', 'th1');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      callId: 'call_a',
      messageId: 'm_a1',
      name: 'read_file',
      status: 'success',
      content: '车间,计划量\n冲压,1200',
    });
    expect(records[0]!.artifactSize).toBeUndefined();

    const tmpDir = path.join(userDataDir(root, 'admin'), SPACE_TMP);
    const files = fs.existsSync(tmpDir) ? fs.readdirSync(tmpDir) : [];
    expect(files).toHaveLength(0);
  });

  it('大结果外置到临时空间：事件行只留体积与摘要，正文可全量读回', async () => {
    const store = makeStore();
    const big = '车间,计划量\n冲压,1200\n'.repeat(1500); // ~33KB（UTF-8 三字节/字）
    await appendEnd(store, { callId: 'call_big', resultText: big });

    const records = store.readAll('admin', 'th1');
    const record = records[0]!;
    expect(record.content).toBeUndefined();
    expect(record.artifactSize).toBeGreaterThan(TOOL_INLINE_MAX_BYTES);
    expect(record.summary).toContain('共');
    expect(record.truncated).toBe(false);

    const abs = path.join(userDataDir(root, 'admin'), SPACE_TMP, artifactFileName('th1', 'call_big'));
    expect(fs.existsSync(abs)).toBe(true);
    expect(fs.readFileSync(abs, 'utf8')).toBe(big);

    const artifact = await store.readArtifact('admin', 'th1', 'call_big');
    expect(artifact?.content).toBe(big);
  });

  it('超过单条落盘上限：截断并标记 truncated', async () => {
    const store = makeStore();
    const huge = 'x'.repeat(TOOL_ARTIFACT_MAX_BYTES + 1024); // 略超 2MB 上限
    await appendEnd(store, { callId: 'call_huge', resultText: huge });

    const record = store.readAll('admin', 'th1')[0]!;
    expect(record.truncated).toBe(true);
    expect(record.artifactSize).toBe(TOOL_ARTIFACT_MAX_BYTES);
  });

  it('未装配外置能力：超阈值结果退化为截断内联（不丢记录）', async () => {
    const store = makeStore(false);
    const big = 'y'.repeat(20 * 1024);
    await appendEnd(store, { callId: 'call_c', resultText: big });

    const record = store.readAll('admin', 'th1')[0]!;
    expect(record.artifactSize).toBeUndefined();
    expect(record.truncated).toBe(true);
    expect(Buffer.byteLength(record.content ?? '', 'utf8')).toBeLessThanOrEqual(TOOL_INLINE_MAX_BYTES);
  });
});

describe('tool-events —— 合并与容错', () => {
  it('start(running) + end：按 call_id 合并为终态（后者覆盖前者）', async () => {
    const store = makeStore();
    store.appendStart('admin', 'th1', {
      callId: 'call_d',
      messageId: 'm_a1',
      name: 'grep',
      startedAt: '2026-09-23T00:00:00.000Z',
      argsDigest: { pattern: '车间' },
    });
    await appendEnd(store, { callId: 'call_d', resultText: '命中 3 行' });

    const records = store.readAll('admin', 'th1');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: 'success', content: '命中 3 行', argsDigest: { pattern: '车间' } });
  });

  it('只有 running 行（进程中途崩溃）：读到"未完成"而不是丢记录', async () => {
    const store = makeStore();
    store.appendStart('admin', 'th1', {
      callId: 'call_e',
      messageId: 'm_a1',
      name: 'ocr',
      startedAt: '2026-09-23T00:00:00.000Z',
    });
    // appendStart 是 fire-and-forget：显式等落盘链，而不是猜一个 sleep 时长
    await store.flush('admin', 'th1');

    const records = store.readAll('admin', 'th1');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ callId: 'call_e', status: 'running' });
    expect(records[0]!.content).toBeUndefined();
  });

  it('坏行跳过，其余记录照读', async () => {
    const store = makeStore();
    await appendEnd(store, { callId: 'call_ok', resultText: 'ok' });
    const file = path.join(userDataDir(root, 'admin'), 'threads', 'th1', 'tool-events.jsonl');
    fs.appendFileSync(file, '{坏行不是JSON\n', 'utf8');

    const records = store.readAll('admin', 'th1');
    expect(records).toHaveLength(1);
    expect(records[0]!.callId).toBe('call_ok');
  });

  it('外置正文被清理后：readArtifact 返回 undefined（路由据此回 410）', async () => {
    const store = makeStore();
    await appendEnd(store, { callId: 'call_gone', resultText: 'z'.repeat(20 * 1024) });
    const abs = path.join(userDataDir(root, 'admin'), SPACE_TMP, artifactFileName('th1', 'call_gone'));
    // 必须走安全删除原语：Windows 下 fs.rmSync 对含中文的路径静默失效（见 fs-safe）
    removeFileSafe(abs);

    // 元数据仍在（卡片不消失），只是正文取不到
    expect(store.readAll('admin', 'th1')[0]!.artifactSize).toBeGreaterThan(0);
    expect(await store.readArtifact('admin', 'th1', 'call_gone')).toBeUndefined();
  });
});

describe('tool-events —— 路径与归属', () => {
  it('恶意 call_id 不会把写入带出临时空间（文件名安全化）', async () => {
    const store = makeStore();
    await appendEnd(store, { callId: '../../evil', resultText: 'w'.repeat(20 * 1024) });

    const record = store.readAll('admin', 'th1')[0]!;
    expect(record.artifactSize).toBeGreaterThan(0);
    // 文件仍落在本会话的临时空间内，且文件名已被安全化
    const tmpDir = path.join(userDataDir(root, 'admin'), SPACE_TMP);
    const files = fs.readdirSync(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain('/');
    expect(files[0]).not.toContain('..');
  });

  it('按 assistant 消息分组：同一轮多个工具挂在同一 message_id 下', async () => {
    const store = makeStore();
    await appendEnd(store, { callId: 'call_1', resultText: 'a' });
    await appendEnd(store, { callId: 'call_2', resultText: 'b' });

    const grouped = store.readByMessage('admin', 'th1');
    expect(grouped.get('m_a1')?.map((r) => r.callId)).toEqual(['call_1', 'call_2']);
  });
});
