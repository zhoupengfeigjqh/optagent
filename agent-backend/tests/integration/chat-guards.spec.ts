import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.js';
import type { AppContext } from '../../src/context.js';
import { agentDir } from '../../src/domain/dirs.js';
import type { ChatAgent } from '../../src/infra/agent-factory.js';
import { buildServer } from '../../src/server.js';

const USER = 'admin';
const AGENT = 'demo';
const MAX_CONTENT_CHARS = 32_000;
const MAX_TOOL_TIPS = 5;

function fakeAgent(): ChatAgent {
  return {
    key: { userId: USER, agentName: AGENT },
    activeThreads: 0,
    lastActiveAt: Date.now(),
    config: {
      agentName: AGENT,
      systemPrompt: '你是助手。',
      enabledTools: [],
      mcpServers: [],
      skills: [],
    },
    configFingerprint: 'test-fingerprint',
    unavailableMcp: () => [],
    mcpStatusOf: () => 'connected',
    probeMcp: async () => [],
    mcpReady: async () => true,
    dispose: () => undefined,
    // eslint-disable-next-line require-yield
    async *run(): AsyncIterable<never> {
      throw new Error('本文件不应走到实际执行');
    },
  } as unknown as ChatAgent;
}

describe('POST /api/threads/:id/messages —— 入口护栏', () => {
  let app: FastifyInstance;
  let root: string;
  let threadId: string;

  function ctx(): AppContext {
    return (app as unknown as { ctx: AppContext }).ctx;
  }

  function send(thread: string, payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: `/api/threads/${thread}/messages`,
      payload,
    });
  }

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-chat-guards-'));
    fs.mkdirSync(path.join(root, 'users', USER), { recursive: true });
    const configPath = path.join(root, 'config.yaml');
    fs.writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8');
    const config = loadConfig({
      env: { PUBLIC_BASE_URL: 'http://backend:3000', OPT_AGENT_ROOT: root },
      configPath,
    });

    const dir = agentDir(root, USER, AGENT);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SOUL.md'), '你是助手。\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
    fs.writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');

    app = await buildServer({ config });
    ctx().getOrCreateAgent = async () => fakeAgent();
    await app.inject({ method: 'POST', url: `/api/agents/${encodeURIComponent(AGENT)}/select` });
    threadId = ctx().threadStore.create(USER, AGENT).threadId;
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('正文超过 32k → 400 VALIDATION_FAILED（不再只靠全局 bodyLimit）', async () => {
    const res = await send(threadId, { content: 'a'.repeat(MAX_CONTENT_CHARS + 1) });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('tool_tips 超过 5 条 → 400 VALIDATION_FAILED（与卡片侧上限同源）', async () => {
    const toolTips = Array.from({ length: MAX_TOOL_TIPS + 1 }, (_, i) => ({ name: `t${i}` }));
    const res = await send(threadId, { content: '你好', tool_tips: toolTips });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('编码后的路径穿越 id → 400 THREAD_ID_INVALID（不读也不建目录）', async () => {
    const res = await send('..%2F..%2Fevil', { content: '你好' });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('THREAD_ID_INVALID');
    expect(fs.existsSync(path.join(root, 'users', USER, 'user-data', 'evil'))).toBe(false);
  });

  it('正在关服 → 503 SERVICE_UNAVAILABLE（判定在配额之前）', async () => {
    ctx().runManager.beginDrain();

    const res = await send(threadId, { content: '你好' });

    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('SERVICE_UNAVAILABLE');
  });
});
