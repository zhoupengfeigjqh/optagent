/**
 * 集成测试：聊天流（SSE）的首帧与收尾（2026-11-06）。
 *
 * 为什么用**真实监听端口**而不是 `app.inject`：`inject` 的假 Response 不做真实网络写入，
 * 无法验证"响应头与首个字节是否在业务事件之前送达"——而这正是本次改动的目的
 * （此前首个字节要等 MCP 就绪 + 意图聚焦判定 + 首 token，中间设备会按空闲掐连接）。
 *
 * 确定性做法：让假数字人的业务事件停在**闸门**后面，先读首帧；
 * - 读到 `: connected` → 证明首帧已独立冲刷，不依赖任何业务事件；
 * - 读不到 → 2s 超时失败（不是慢，而是压根没写出来）。
 * 之后再放开闸门，断言 `content` / `done` 照常到达、事件集合未变。
 */
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
import type { LlmEvent } from '../../src/types.js';

const USER = 'admin';
const AGENT = 'demo';

/** 闸门：业务事件必须等测试放行后才能产出 */
interface Gate {
  promise: Promise<void>;
  release: () => void;
}

function makeGate(): Gate {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** 假数字人：MCP 视为已就绪；真正的回答等闸门放行 */
function fakeAgent(gateOf: () => Promise<void>): ChatAgent {
  const agent = {
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
    async *run(): AsyncIterable<LlmEvent> {
      await gateOf();
      yield { type: 'content_delta', delta: '你好' };
      yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
  return agent as unknown as ChatAgent;
}

/** 带超时的读取：超时即"没写出来"，给出可读原因而不是 vitest 的笼统 timeout */
async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number,
  hint: string,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(hint)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

describe('POST /api/threads/:id/messages —— SSE 首帧（2026-11-06）', () => {
  let app: FastifyInstance;
  let root: string;
  let threadId: string;
  let gate: Gate;

  function ctx(): AppContext {
    return (app as unknown as { ctx: AppContext }).ctx;
  }

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-chat-sse-'));
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
    // 选中数字人之前就替换实例来源：避免真实工厂去建 MCP 连接
    ctx().getOrCreateAgent = async () => fakeAgent(async () => gate?.promise);
    await app.inject({ method: 'POST', url: `/api/agents/${encodeURIComponent(AGENT)}/select` });
    threadId = ctx().threadStore.create(USER, AGENT).threadId;
  });

  afterAll(async () => {
    gate?.release();
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('建连即写首帧注释；业务事件在其之后；done 照常收尾', async () => {
    gate = makeGate();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    const controller = new AbortController();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ content: '你好' }),
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      // 与既有三处 SSE 对齐：关掉中间层缓冲，心跳与增量才按写出即到
      expect(res.headers.get('x-accel-buffering')).toBe('no');

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      // 业务事件仍被闸门挡住 ⇒ 此刻能读到的只可能是首帧
      const first = await readWithTimeout(
        reader,
        2_000,
        '建连后 2s 未收到首个字节：首帧未冲刷（响应头被攒在缓冲区）',
      );
      expect(decoder.decode(first.value)).toBe(': connected\n\n');

      gate.release();

      let text = '';
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && !text.includes('event: done')) {
        const chunk = await readWithTimeout(reader, 5_000, '5s 内未收到终结事件');
        if (chunk.done) break;
        text += decoder.decode(chunk.value);
      }

      // 事件集合零变化：首帧只是注释，不产生事件；正文与 done 照常到达
      expect(text).toContain('event: content');
      expect(text).toContain('event: done');
      expect(text.startsWith('event:')).toBe(true); // 注释帧不出现在这里（已被上面的首帧断言消费）

      reader.releaseLock();
    } finally {
      controller.abort();
    }
  });
});
