import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import type { AppContext } from '../../src/context.js';
import { SPACE_TMP, agentDir, userDataDir } from '../../src/domain/dirs.js';
import { buildServer } from '../../src/server';

const root = mkdtempSync(path.join(tmpdir(), 'optagent-isolation-'));
const USER = 'admin';
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

function putFile(agentName: string, space: string, filename: string, content: string): string {
  const abs = path.join(userDataDir(root, USER, agentName), space, filename);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  return abs;
}

function ctx(): AppContext {
  return (app as unknown as { ctx: AppContext }).ctx;
}

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
  writeAgent(AGENT_A);
  writeAgent(AGENT_B);
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('作用域来源：只能是服务端当前选中数字人', () => {
  it('未选中 → 会话/文件接口一律 409 AGENT_NOT_SELECTED', async () => {
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
  it('同一用户两个数字人的空间内容互不可见；同名文件内容互不串', async () => {
    expect((await select(AGENT_A)).statusCode).toBe(200);
    const aFile = putFile(AGENT_A, SPACE_TMP, '同名文档.csv', '甲的正文');
    const aTmp = putFile(AGENT_A, SPACE_TMP, 'th_x_产出.json', '甲产出');

    const aList = await listFiles(SPACE_TMP);
    expect(aList.statusCode).toBe(200);
    expect(
      (aList.json() as Array<{ filename: string }>)
        .map((e) => e.filename)
        .slice()
        .sort(),
    ).toEqual(['th_x_产出.json', '同名文档.csv'].sort());

    expect((await select(AGENT_B)).statusCode).toBe(200);
    const bList = await listFiles(SPACE_TMP);
    expect(bList.statusCode).toBe(200);
    expect(bList.json() as unknown[]).toEqual([]);

    const bFile = putFile(AGENT_B, SPACE_TMP, '同名文档.csv', '乙的正文');
    const bDownload = await app.inject({
      method: 'GET',
      url: `/api/files/download?dir=${encodeURIComponent(SPACE_TMP)}&filename=${encodeURIComponent('同名文档.csv')}`,
    });
    expect(bDownload.body).toBe('乙的正文');

    expect((await select(AGENT_A)).statusCode).toBe(200);
    const aDownload = await app.inject({
      method: 'GET',
      url: `/api/files/download?dir=${encodeURIComponent(SPACE_TMP)}&filename=${encodeURIComponent('同名文档.csv')}`,
    });
    expect(aDownload.body).toBe('甲的正文');

    expect(path.dirname(aFile)).not.toBe(path.dirname(bFile));
    expect(aTmp).toContain(path.join('user-data', AGENT_A));
  });

  it('跨数字人路径一律不可达：上跳/绝对路径 → 400，点名对方数字人 → 403（错误码沿用既有映射）', async () => {
    expect((await select(AGENT_B)).statusCode).toBe(200);

    const up = await listFiles(`../${AGENT_A}/${SPACE_TMP}`);
    expect(up.statusCode).toBe(400);
    expect((up.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');

    const abs = await listFiles(path.join(root, 'users', USER, 'user-data', AGENT_A, SPACE_TMP));
    expect(abs.statusCode).toBe(400);

    // 把对方数字人当作一级目录点名：一级必须是两空间之一 → 403（契约 §1 的既有映射）
    const named = await listFiles(`${AGENT_A}/${SPACE_TMP}`);
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
