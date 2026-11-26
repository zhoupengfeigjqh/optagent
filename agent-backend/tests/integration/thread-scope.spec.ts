import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config';
import type { AppContext } from '../../src/context.js';
import { agentDir, threadDir } from '../../src/domain/dirs.js';
import { buildServer } from '../../src/server';

const root = mkdtempSync(path.join(tmpdir(), 'optagent-thread-scope-'));
const USER = 'admin';
const AGENT_A = 'agent-a';
const AGENT_B = 'agent-b';

let app: FastifyInstance;

function writeAgent(name: string): void {
  const dir = agentDir(root, USER, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SOUL.md'), '你是助手。\n', 'utf8');
  writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
  writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');
}

function ctx(): AppContext {
  return (app as unknown as { ctx: AppContext }).ctx;
}

function select(name: string) {
  return app.inject({ method: 'POST', url: `/api/agents/${encodeURIComponent(name)}/select` });
}

function createThread(payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/threads', payload });
}

function listThreads() {
  return app.inject({ method: 'GET', url: '/api/threads' });
}

function threadDetail(threadId: string) {
  return app.inject({ method: 'GET', url: `/api/threads/${threadId}` });
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
  expect((await select(AGENT_A)).statusCode).toBe(200);
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('POST /api/threads —— 归属取服务端当前选中（D11）', () => {
  it('body 的 agent_name 与服务端选中不一致：按**服务端**归属，落 warn，接口仍 201', async () => {
    const warn = vi.spyOn(ctx().loggers.logger, 'warn');
    try {
      const res = await createThread({ agent_name: AGENT_B });
      expect(res.statusCode).toBe(201);
      const { thread_id: threadId } = res.json() as { thread_id: string };

      expect(existsSync(threadDir(root, USER, AGENT_A, threadId))).toBe(true);
      expect(existsSync(threadDir(root, USER, AGENT_B, threadId))).toBe(false);

      const hit = warn.mock.calls.find(
        (c) => (c[0] as { event?: string })?.event === 'thread.create.agent_mismatch',
      );
      expect(hit).toBeDefined();
      expect(hit![0]).toMatchObject({
        user_id: USER,
        body_agent: AGENT_B,
        scope_agent: AGENT_A,
      });
    } finally {
      warn.mockRestore();
    }
  });

  it('body 指定的是不存在的数字人 → 404 AGENT_NOT_FOUND（既有口径保留，不静默放过）', async () => {
    const res = await createThread({ agent_name: '不存在的数字人' });

    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('AGENT_NOT_FOUND');
  });

  it('body 与服务端一致：不落 warn，正常创建', async () => {
    const warn = vi.spyOn(ctx().loggers.logger, 'warn');
    try {
      const res = await createThread({ agent_name: AGENT_A });
      expect(res.statusCode).toBe(201);
      expect(
        warn.mock.calls.filter(
          (c) => (c[0] as { event?: string })?.event === 'thread.create.agent_mismatch',
        ),
      ).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('列表与详情 —— 只认当前数字人（§2 / FR-016）', () => {
  it('空对话（尚无任何轮次）不入列表；仍在磁盘上', async () => {
    const created = await createThread({ agent_name: AGENT_A });
    const { thread_id: threadId } = created.json() as { thread_id: string };

    const list = await listThreads();
    expect(list.statusCode).toBe(200);
    expect(
      (list.json() as Array<{ thread_id: string }>).some((m) => m.thread_id === threadId),
    ).toBe(false);

    expect((await threadDetail(threadId)).statusCode).toBe(200);
    expect(existsSync(threadDir(root, USER, AGENT_A, threadId))).toBe(true);
  });

  it('查询参数 agent_name 被忽略：切到 B 后列表里查不到 A 的会话', async () => {
    const created = await createThread({ agent_name: AGENT_A });
    const { thread_id: threadId } = created.json() as { thread_id: string };

    expect((await select(AGENT_B)).statusCode).toBe(200);
    const forced = await app.inject({
      method: 'GET',
      url: `/api/threads?agent_name=${encodeURIComponent(AGENT_A)}`,
    });
    expect((forced.json() as unknown[]).length).toBe(0);
    expect((await threadDetail(threadId)).statusCode).toBe(404);

    expect((await select(AGENT_A)).statusCode).toBe(200);
  });

  it('跨数字人 404 与"根本不存在"同形（不泄露存在性）', async () => {
    const created = await createThread({ agent_name: AGENT_A });
    const { thread_id: threadId } = created.json() as { thread_id: string };

    expect((await select(AGENT_B)).statusCode).toBe(200);
    const cross = await threadDetail(threadId);
    const ghost = await threadDetail('00000000-0000-4000-8000-000000000000');

    expect(cross.statusCode).toBe(404);
    expect(ghost.statusCode).toBe(404);
    const crossBody = cross.json() as { error: { code: string; message: string } };
    const ghostBody = ghost.json() as { error: { code: string; message: string } };
    expect(crossBody.error.code).toBe(ghostBody.error.code);
    expect(crossBody.error.message).toMatch(/^对话不存在：/);
    expect(ghostBody.error.message).toMatch(/^对话不存在：/);
    expect(crossBody.error.message).not.toMatch(/权限|作用域|数字人/);

    expect((await select(AGENT_A)).statusCode).toBe(200);
  });
});

describe('陈旧选中数字人（FR-032）', () => {
  it('选中已被移除的数字人 → 409 AGENT_NOT_AVAILABLE；选中态不被自动清空', async () => {
    writeAgent('to-be-removed');
    expect((await select('to-be-removed')).statusCode).toBe(200);

    rmSync(agentDir(root, USER, 'to-be-removed'), { recursive: true, force: true });

    const list = await listThreads();
    expect(list.statusCode).toBe(409);
    expect((list.json() as { error: { code: string } }).error.code).toBe('AGENT_NOT_AVAILABLE');
    expect(String((list.json() as { error: { message: string } }).error.message)).toContain(
      '请重新选择',
    );

    expect(ctx().currentAgent.current(USER)).toEqual({ userId: USER, agentName: 'to-be-removed' });

    expect((await select(AGENT_A)).statusCode).toBe(200);
    expect((await listThreads()).statusCode).toBe(200);
  });
});
