/**
 * 集成测试：跨数字人数据隔离（009 FR-021/023/030/033、contracts/api-delta.md §0/§1/§3）
 *
 * 一条主线：**作用域＝服务端当前选中数字人**，客户端指定的作用域一律无效。
 * 用户故事 1 的验收场景逐条钉在这里：
 *
 * - 同一用户的两个数字人各自一份三空间：列表互不可见、同名文件互不串内容；
 * - 甲创建的会话，切到乙后**在列表里查不到**，按 id 取 → `404 THREAD_NOT_FOUND`
 *   （与"不存在"不可区分，不泄露存在性）；
 * - 跨数字人路径（`../{另一个数字人}/...`）→ `403 DIR_VALIDATION`；
 * - 未选中 → `409 AGENT_NOT_SELECTED`；选中已移除的数字人 → `409 AGENT_NOT_AVAILABLE`。
 *
 * 运行方式（本地执行）：npm run test:integration
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import type { AppContext } from '../../src/context.js';
import { SPACE_SHARED, SPACE_TMP, agentDir, userDataDir } from '../../src/domain/dirs.js';
import { buildServer } from '../../src/server';

const root = mkdtempSync(path.join(tmpdir(), 'optagent-isolation-'));
const USER = 'admin';
/** 两个数字人：名称刻意相邻，便于回看"升序第一"的默认归属 */
const AGENT_A = '甲方数字人';
const AGENT_B = '乙方数字人';

let app: FastifyInstance;

/** 写一份完整可加载的数字人配置（缺 TOOL/MCP 会被判不可用） */
function writeAgent(name: string): void {
  const dir = agentDir(root, USER, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SOUL.md'), '你是助手。\n', 'utf8');
  writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
  writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');
}

/** 直接在磁盘上放文件（绕过上传接口：本文件只关心"读得到/读不到"） */
function putFile(agentName: string, space: string, filename: string, content: string): string {
  const abs = path.join(userDataDir(root, USER, agentName), space, filename);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  return abs;
}

function ctx(): AppContext {
  return (app as unknown as { ctx: AppContext }).ctx;
}

/** 选中某数字人（走真实接口，端到端覆盖 404/200 语义） */
function select(name: string) {
  return app.inject({ method: 'POST', url: `/api/agents/${encodeURIComponent(name)}/select` });
}

function createThread(agentName: string) {
  return app.inject({
    method: 'POST',
    url: '/api/threads',
    payload: { agent_name: agentName },
  });
}

function listThreads(query = '') {
  return app.inject({ method: 'GET', url: `/api/threads${query}` });
}

function threadDetail(threadId: string) {
  return app.inject({ method: 'GET', url: `/api/threads/${threadId}` });
}

function listFiles(dir: string) {
  return app.inject({ method: 'GET', url: `/api/files/list?dir=${encodeURIComponent(dir)}` });
}

beforeAll(async () => {
  mkdirSync(path.join(root, 'users', USER), { recursive: true });
  const configPath = path.join(root, 'config.yaml');
  writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8');
  const config = loadConfig({
    env: { PUBLIC_BASE_URL: 'http://backend:3000', OPT_AGENT_ROOT: root },
    configPath,
  });
  app = await buildServer({ config });
  // 启动期迁移已跑过（此时无数字人 ⇒ 无源目录也不受影响）；随后建两个数字人
  writeAgent(AGENT_A);
  writeAgent(AGENT_B);
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('作用域来源：只能是服务端当前选中数字人', () => {
  it('未选中 → 会话/文件接口一律 409 AGENT_NOT_SELECTED', async () => {
    // 全新用户（从未选中）看接口的行为
    expect(ctx().currentAgent.current(USER)).toBeUndefined();

    const threads = await listThreads();
    expect(threads.statusCode).toBe(409);
    expect((threads.json() as { error: { code: string } }).error.code).toBe('AGENT_NOT_SELECTED');

    const files = await listFiles(SPACE_TMP);
    expect(files.statusCode).toBe(409);
    expect((files.json() as { error: { code: string } }).error.code).toBe('AGENT_NOT_SELECTED');

    const created = await createThread(AGENT_A);
    expect(created.statusCode).toBe(409);
  });

  it('选中不存在的数字人 → 404 AGENT_NOT_FOUND（select 自身不兜底创建）', async () => {
    const res = await select('从未存在的数字人');
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('AGENT_NOT_FOUND');
  });
});

describe('文件空间：两数字人各自一份，互不可见', () => {
  it('同一用户两个数字人的三空间内容互不可见；同名文件内容互不串', async () => {
    expect((await select(AGENT_A)).statusCode).toBe(200);
    const aFile = putFile(AGENT_A, SPACE_SHARED, '同名文档.csv', '甲的正文');
    const aTmp = putFile(AGENT_A, SPACE_TMP, 'th_x_产出.json', '甲产出');

    // 甲看得见自己的（list 返回数组：[{ filename, size, updated_at }]）
    const aList = await listFiles(SPACE_SHARED);
    expect(aList.statusCode).toBe(200);
    expect((aList.json() as Array<{ filename: string }>).map((e) => e.filename)).toEqual([
      '同名文档.csv',
    ]);

    // 切到乙：乙的空间是空的（甲的目录压根不在作用域内）
    expect((await select(AGENT_B)).statusCode).toBe(200);
    const bList = await listFiles(SPACE_SHARED);
    expect(bList.statusCode).toBe(200);
    expect(bList.json() as unknown[]).toEqual([]);
    const bTmp = await listFiles(SPACE_TMP);
    expect(bTmp.json() as unknown[]).toEqual([]);

    // 乙放同名文件：两边内容互不污染
    const bFile = putFile(AGENT_B, SPACE_SHARED, '同名文档.csv', '乙的正文');
    const bDownload = await app.inject({
      method: 'GET',
      url: `/api/files/download?dir=${encodeURIComponent(SPACE_SHARED)}&filename=${encodeURIComponent('同名文档.csv')}`,
    });
    expect(bDownload.body).toBe('乙的正文');

    expect((await select(AGENT_A)).statusCode).toBe(200);
    const aDownload = await app.inject({
      method: 'GET',
      url: `/api/files/download?dir=${encodeURIComponent(SPACE_SHARED)}&filename=${encodeURIComponent('同名文档.csv')}`,
    });
    expect(aDownload.body).toBe('甲的正文');

    // 磁盘上确实是两份独立文件
    expect(path.dirname(aFile)).not.toBe(path.dirname(bFile));
    expect(aTmp).toContain(path.join('user-data', AGENT_A));
  });

  it('跨数字人路径一律不可达：上跳/绝对路径 → 400，点名对方数字人 → 403（错误码沿用既有映射）', async () => {
    expect((await select(AGENT_B)).statusCode).toBe(200);

    // `..` 上跳：连目录参数本身都不合法（400 VALIDATION_FAILED）
    const up = await listFiles(`../${AGENT_A}/${SPACE_SHARED}`);
    expect(up.statusCode).toBe(400);
    expect((up.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');

    // 绝对路径：同样非法（400）
    const abs = await listFiles(path.join(root, 'users', USER, 'user-data', AGENT_A, SPACE_SHARED));
    expect(abs.statusCode).toBe(400);

    // 把对方数字人当作一级目录点名：一级必须是三空间之一 → 403（契约 §1 的既有映射）
    const named = await listFiles(`${AGENT_A}/${SPACE_SHARED}`);
    expect(named.statusCode).toBe(403);
    expect((named.json() as { error: { code: string } }).error.code).toBe('UPLOAD_DIR_FORBIDDEN');
  });
});

describe('会话归属：跨数字人一律 404（与"不存在"不可区分）', () => {
  it('甲创建的会话，切到乙后不在列表里、按 id 取 → 404', async () => {
    expect((await select(AGENT_A)).statusCode).toBe(200);
    const created = await createThread(AGENT_A);
    expect(created.statusCode).toBe(201);
    const { thread_id: threadId } = created.json() as { thread_id: string };

    expect((await select(AGENT_B)).statusCode).toBe(200);
    const bThreads = await listThreads();
    expect((bThreads.json() as unknown[]).length).toBe(0);

    const detail = await threadDetail(threadId);
    expect(detail.statusCode).toBe(404);
    expect((detail.json() as { error: { code: string } }).error.code).toBe('THREAD_NOT_FOUND');

    // 查询参数不能把作用域拉回去：仍只有乙的会话
    const forced = await listThreads(`?agent_name=${encodeURIComponent(AGENT_A)}`);
    expect((forced.json() as unknown[]).length).toBe(0);

    // 回到甲：会话还在，且**空对话不入列表**（尚未发过消息）
    expect((await select(AGENT_A)).statusCode).toBe(200);
    const aThreads = await listThreads();
    expect((aThreads.json() as unknown[]).length).toBe(0);
    expect((await threadDetail(threadId)).statusCode).toBe(200);
  });

  it('跨数字人改标题/删除 → 404（不误改对方数据）', async () => {
    expect((await select(AGENT_A)).statusCode).toBe(200);
    const created = await createThread(AGENT_A);
    const { thread_id: threadId } = created.json() as { thread_id: string };

    expect((await select(AGENT_B)).statusCode).toBe(200);
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/threads/${threadId}`,
      payload: { title: '越权改名' },
    });
    expect(patch.statusCode).toBe(404);

    const del = await app.inject({ method: 'DELETE', url: `/api/threads/${threadId}` });
    expect(del.statusCode).toBe(404);

    // 甲这边完好无损
    expect((await select(AGENT_A)).statusCode).toBe(200);
    expect((await threadDetail(threadId)).statusCode).toBe(200);
  });

  it('跨数字人发消息 → 404（在并发配额判定之前就拒绝）', async () => {
    expect((await select(AGENT_A)).statusCode).toBe(200);
    const created = await createThread(AGENT_A);
    const { thread_id: threadId } = created.json() as { thread_id: string };

    expect((await select(AGENT_B)).statusCode).toBe(200);
    const send = await app.inject({
      method: 'POST',
      url: `/api/threads/${threadId}/messages`,
      payload: { content: '你好' },
    });
    expect(send.statusCode).toBe(404);
    expect((send.json() as { error: { code: string } }).error.code).toBe('THREAD_NOT_FOUND');
  });
});
