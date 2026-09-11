/**
 * 对话链路集成测试（T019）：app.inject + FakeLlmProvider 覆盖
 * SSE 四类事件序列、断连续跑落盘、stop、THREAD_RUN_ACTIVE / POOL_EXHAUSTED /
 * THREAD_BUSY_LIMIT 三条 409、select 校验、崩溃恢复（T027）。
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { buildServer } from '../../src/server';
import type { LlmChatRequest, LlmProvider } from '../../src/infra/llm/llm-provider';
import type { LlmEvent } from '../../src/types';
import { FakeLlmProvider, simpleScript, type FakeStep } from '../helpers/fake-llm-provider';

type AppInstance = Awaited<ReturnType<typeof buildServer>>;

type Script = FakeStep[] | 'THROW';

/** 每次 streamChat 取一个脚本的队列 provider（THROW 模拟未知异常崩溃） */
class QueueProvider implements LlmProvider {
  private readonly queue: Script[] = [];
  readonly instances: FakeLlmProvider[] = [];
  push(s: Script): void {
    this.queue.push(s);
  }
  last(): FakeLlmProvider {
    const f = this.instances.at(-1);
    if (!f) throw new Error('尚无活跃 provider 实例');
    return f;
  }
  async *streamChat(req: LlmChatRequest): AsyncIterable<LlmEvent> {
    const s = this.queue.shift() ?? simpleScript('默认回复');
    if (s === 'THROW') throw new Error('pi loop 未知异常');
    const f = new FakeLlmProvider(s);
    this.instances.push(f);
    yield* f.streamChat(req);
  }
}

function writeAgent(root: string, name: string): void {
  const dir = path.join(root, '.opt-agent', 'users', 'admin', 'agents', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SOUL.md'), `你是 ${name} 数字人。`);
  writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }));
  writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }));
}

/** 解析 SSE 文本为事件数组 */
function parseSse(body: string): Array<{ event: string; data: Record<string, unknown> }> {
  return body
    .split('\n\n')
    .filter((b) => b.trim())
    .map((block) => {
      const event = /event: (\w+)/.exec(block)![1]!;
      const data = JSON.parse(/data: (.*)/.exec(block)![1]!) as Record<string, unknown>;
      return { event, data };
    });
}

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitFor 超时');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('对话链路（US1）', () => {
  let root: string;
  let provider: QueueProvider;
  let app: AppInstance;

  async function setup(env: Record<string, string> = {}): Promise<void> {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-chat-'));
    writeAgent(root, 'demo');
    const configPath = path.join(root, 'config.yaml');
    writeFileSync(configPath, 'models:\n  - model: m1\n');
    const config = loadConfig({
      env: { DEEPSEEK_API_KEY: 'sk-x', OPT_AGENT_ROOT: path.join(root, '.opt-agent'), ...env },
      configPath,
    });
    provider = new QueueProvider();
    app = await buildServer({ config, llmProvider: provider });
  }

  beforeEach(() => setup());
  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  async function select(name = 'demo') {
    return app.inject({ method: 'POST', url: `/api/agents/${name}/select` });
  }
  async function createThread(agentName = 'demo') {
    return app.inject({ method: 'POST', url: '/api/threads', payload: { agent_name: agentName } });
  }

  it('完整链路：select → 建 thread → SSE thinking/content/done，history 落盘', async () => {
    expect((await select()).statusCode).toBe(200);
    const created = await createThread();
    expect(created.statusCode).toBe(201);
    const threadId = created.json().thread_id as string;

    provider.push(simpleScript('你好，我是 demo', '先想想'));
    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${threadId}/messages`,
      payload: { content: '你好', thinking: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    const events = parseSse(res.body);
    expect(events.map((e) => e.event)).toEqual(['thinking', 'content', 'done']);
    expect(events[0]!.data).toEqual({ delta: '先想想' });
    expect(events[1]!.data).toEqual({ delta: '你好，我是 demo' });
    // 002：done 增加 duration_seconds 与 message_id
    expect(events[2]!.data).toMatchObject({ finish_reason: 'completed', usage: { input_tokens: 10, output_tokens: 5 } });
    expect(typeof events[2]!.data.duration_seconds).toBe('number');
    expect(events[2]!.data.message_id).toMatch(/^m_/);

    const historyFile = path.join(root, '.opt-agent/users/admin/user-data/threads', threadId, 'history.jsonl');
    // FR-019：落盘异步于 done 事件，轮询等待写盘完成
    await waitFor(() => existsSync(historyFile) && readFileSync(historyFile, 'utf8').includes('assistant'));
    const history = JSON.parse(
      `[${readFileSync(historyFile, 'utf8').trim().split('\n').join(',')}]`,
    ) as Array<Record<string, unknown>>;
    // 002：落盘行带元数据；正文与角色不变
    expect(history.map((m) => [m.role, m.content])).toEqual([
      ['user', '你好'],
      ['assistant', '你好，我是 demo'],
    ]);
    expect(history[1]).toMatchObject({ status: 'completed', usage: { input_tokens: 10, output_tokens: 5 } });
  });

  it('未 select → 建 thread 409 AGENT_NOT_SELECTED', async () => {
    const res = await createThread();
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('AGENT_NOT_SELECTED');
  });

  it('会话不绑定数字人：同一 thread 内切换数字人，下一轮由新数字人回答', async () => {
    writeAgent(root, 'other');
    await select('demo');
    const threadId = (await createThread()).json().thread_id as string;

    // 第一轮：demo 回答
    provider.push(simpleScript('我是 demo 的回答'));
    const r1 = await app.inject({
      method: 'POST',
      url: `/api/threads/${threadId}/messages`,
      payload: { content: '你好' },
    });
    expect(parseSse(r1.body).at(-1)).toMatchObject({ event: 'done', data: { agent_name: 'demo' } });

    // 覆盖式切换（无需先 exit）：下一轮由 other 回答
    const sw = await app.inject({ method: 'POST', url: '/api/agents/other/select' });
    expect(sw.statusCode).toBe(200);
    provider.push(simpleScript('我是 other 的回答'));
    const r2 = await app.inject({
      method: 'POST',
      url: `/api/threads/${threadId}/messages`,
      payload: { content: '再问' },
    });
    expect(r2.statusCode).toBe(200);
    expect(parseSse(r2.body).at(-1)).toMatchObject({ event: 'done', data: { agent_name: 'other' } });

    // 落盘：user/assistant 成对带当轮数字人
    const historyFile = path.join(root, '.opt-agent/users/admin/user-data/threads', threadId, 'history.jsonl');
    await waitFor(() => readFileSync(historyFile, 'utf8').includes('我是 other 的回答'));
    const history = JSON.parse(
      `[${readFileSync(historyFile, 'utf8').trim().split('\n').join(',')}]`,
    ) as Array<Record<string, unknown>>;
    expect(history.map((m) => [m.role, m.agent_name])).toEqual([
      ['user', 'demo'],
      ['assistant', 'demo'],
      ['user', 'other'],
      ['assistant', 'other'],
    ]);

    // 会话 meta 的 agent_name = 最近一轮使用者；详情逐条消息带当轮数字人
    const metaPath = path.join(root, '.opt-agent/users/admin/user-data/threads', threadId, 'meta.json');
    await waitFor(() => {
      try {
        return (JSON.parse(readFileSync(metaPath, 'utf8')) as { agent_name?: string }).agent_name === 'other';
      } catch {
        return false;
      }
    });
    const detail = await app.inject({ method: 'GET', url: `/api/threads/${threadId}` });
    expect(detail.json().agent_name).toBe('other');
    expect(
      (detail.json().messages as Array<{ agent_name?: string }>).map((m) => m.agent_name),
    ).toEqual(['demo', 'demo', 'other', 'other']);
  });

  it('exit 后未选中 → 发消息 409 AGENT_NOT_SELECTED', async () => {
    await select('demo');
    const threadId = (await createThread()).json().thread_id as string;
    await app.inject({ method: 'POST', url: '/api/agents/current/exit' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${threadId}/messages`,
      payload: { content: 'hi' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('AGENT_NOT_SELECTED');
  });

  it('THREAD_RUN_ACTIVE：进行中再发 → 409', async () => {
    await select();
    const threadId = (await createThread()).json().thread_id as string;
    provider.push([{ type: 'wait', id: 'hold' }, ...simpleScript('完成')] as FakeStep[]);
    const p1 = app.inject({ method: 'POST', url: `/api/threads/${threadId}/messages`, payload: { content: '第一条' } });
    await providerLastReached(provider, 'hold');

    const res2 = await app.inject({ method: 'POST', url: `/api/threads/${threadId}/messages`, payload: { content: '第二条' } });
    expect(res2.statusCode).toBe(409);
    expect(res2.json().error.code).toBe('THREAD_RUN_ACTIVE');

    provider.last().resume('hold');
    const r1 = await p1;
    expect(r1.statusCode).toBe(200);
  });

  it('创建不受会话总数限制：连续建到第 5 个 thread 仍 201（总数不再设限）', async () => {
    await select();
    for (let i = 0; i < 5; i++) expect((await createThread()).statusCode).toBe(201);
  });

  it('THREAD_BUSY_LIMIT：同一用户已有 3 个回复进行中 → 第 4 个 thread 发消息 409', async () => {
    await select();
    const threadIds: string[] = [];
    for (let i = 0; i < 3; i++) threadIds.push((await createThread()).json().thread_id as string);

    // 三个 thread 同时开跑并挂住（队列 provider 每轮取一个脚本，按开跑顺序进入 instances）
    const running: Array<Promise<{ statusCode: number }>> = [];
    for (let i = 0; i < threadIds.length; i++) {
      const hold = `hold${i}`;
      provider.push([{ type: 'wait', id: hold }, ...simpleScript('完成')] as FakeStep[]);
      running.push(
        app.inject({
          method: 'POST',
          url: `/api/threads/${threadIds[i]}/messages`,
          payload: { content: `第 ${i + 1} 条` },
        }),
      );
      await waitFor(() => provider.instances.length > i);
      await provider.instances[i]!.reached(hold);
    }

    // 第 4 个 thread 自身无进行中 run，但该用户活跃 run 已达 3 → 409
    const fourth = (await createThread()).json().thread_id as string;
    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${fourth}/messages`,
      payload: { content: '超限' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('THREAD_BUSY_LIMIT');

    // 收尾：放行三个进行中的 run
    for (let i = 0; i < threadIds.length; i++) provider.instances[i]!.resume(`hold${i}`);
    const results = await Promise.all(running);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
  });

  it('THREAD_BUSY_LIMIT 按 userId 累计：数字人 A 挂 3 个 → 切到 B 第 4 条仍 409', async () => {
    writeAgent(root, 'demo2');
    expect((await select('demo')).statusCode).toBe(200);
    const threadIds: string[] = [];
    for (let i = 0; i < 3; i++) threadIds.push((await createThread()).json().thread_id as string);

    const running: Array<Promise<{ statusCode: number }>> = [];
    for (let i = 0; i < threadIds.length; i++) {
      const hold = `a${i}`;
      provider.push([{ type: 'wait', id: hold }, ...simpleScript('完成')] as FakeStep[]);
      running.push(
        app.inject({
          method: 'POST',
          url: `/api/threads/${threadIds[i]}/messages`,
          payload: { content: `第 ${i + 1} 条` },
        }),
      );
      await waitFor(() => provider.instances.length > i);
      await provider.instances[i]!.reached(hold);
    }

    // 直接切到另一个数字人（覆盖式，无需 exit）：A 的 3 个 run 仍在跑，额度按用户累计
    expect((await select('demo2')).statusCode).toBe(200);
    const other = (await createThread('demo2')).json().thread_id as string;
    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${other}/messages`,
      payload: { content: '跨数字人超限' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('THREAD_BUSY_LIMIT');

    for (let i = 0; i < threadIds.length; i++) provider.instances[i]!.resume(`a${i}`);
    const results = await Promise.all(running);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
  });

  it('THREAD_BUSY_LIMIT 不变量：同一 tick 并发发 4 个 thread，最多 3 个回复启动', async () => {
    await select();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await createThread()).json().thread_id as string);
    for (let i = 0; i < 4; i++) {
      provider.push([{ type: 'wait', id: `h${i}` }, ...simpleScript(`ok${i}`)] as FakeStep[]);
    }

    // 同一 tick 内同时发起：不给「先判定、后注册」留下被插队的窗口
    const injects = ids.map((id, i) =>
      app.inject({
        method: 'POST',
        url: `/api/threads/${id}/messages`,
        payload: { content: `并发 ${i}` },
      }),
    );

    await waitFor(() => provider.instances.length >= 3, 2000);
    // 再等一拍，若上限失效第 4 个 run 会在此间启动
    await new Promise((r) => setTimeout(r, 200));
    const started = provider.instances.length;

    for (let i = 0; i < started; i++) provider.instances[i]!.resume(`h${i}`);
    const codes = (await Promise.all(injects)).map((r) => r.statusCode);

    // 无论事件循环如何交错，启动的 run 与 200 响应都不可能超过 3
    expect(started).toBe(3);
    expect(codes.filter((c) => c === 200)).toHaveLength(3);
    expect(codes.filter((c) => c === 409)).toHaveLength(1);
  });

  it('stop：幂等中断，本轮丢弃', async () => {
    await select();
    const threadId = (await createThread()).json().thread_id as string;
    provider.push([
      { type: 'content_delta', delta: '没说完' },
      { type: 'wait', id: 'mid' },
      { type: 'content_delta', delta: '后半' },
      { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } },
    ]);
    const p1 = app.inject({ method: 'POST', url: `/api/threads/${threadId}/messages`, payload: { content: '说点什么' } });
    await providerLastReached(provider, 'mid');

    const stop1 = await app.inject({ method: 'POST', url: `/api/threads/${threadId}/stop` });
    expect(stop1.json()).toEqual({ stopped: true });
    const r1 = await p1;
    const events = parseSse(r1.body);
    expect(events.at(-1)).toMatchObject({
      event: 'done',
      data: { finish_reason: 'stop', usage: { input_tokens: 3, output_tokens: 2 }, message_id: null },
    });
    const historyFile = path.join(root, '.opt-agent/users/admin/user-data/threads', threadId, 'history.jsonl');
    expect(existsSync(historyFile) ? readFileSync(historyFile, 'utf8') : '').toBe('');

    const stop2 = await app.inject({ method: 'POST', url: `/api/threads/${threadId}/stop` });
    expect(stop2.json()).toEqual({ stopped: false });
  });

  it('断连后续跑落盘（真实 HTTP 断开）', async () => {
    await select();
    const threadId = (await createThread()).json().thread_id as string;
    provider.push([
      { type: 'content_delta', delta: '前半' },
      { type: 'wait', id: 'mid' },
      { type: 'content_delta', delta: '后半' },
      { type: 'done', usage: { inputTokens: 8, outputTokens: 4 } },
    ]);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const controller = new AbortController();
    const req = fetch(`http://127.0.0.1:${port}/api/threads/${threadId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '长问题' }),
      signal: controller.signal,
    });
    req.catch(() => {}); // abort 产生的 rejection 忽略
    await providerLastReached(provider, 'mid');
    controller.abort(); // 客户端断开
    provider.last().resume('mid'); // 服务端继续跑完

    const historyFile = path.join(root, '.opt-agent/users/admin/user-data/threads', threadId, 'history.jsonl');
    await waitFor(() => existsSync(historyFile) && readFileSync(historyFile, 'utf8').includes('后半'));
    const lines = readFileSync(historyFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { role: string; content: string });
    expect(lines.map((m) => [m.role, m.content])).toEqual([
      ['user', '长问题'],
      ['assistant', '前半后半'],
    ]);
  });

  it('崩溃恢复：run 未知异常 → SSE error + 实例销毁，下一条消息自动重建', async () => {
    await select();
    const threadId = (await createThread()).json().thread_id as string;
    provider.push('THROW');
    const r1 = await app.inject({ method: 'POST', url: `/api/threads/${threadId}/messages`, payload: { content: '崩溃吧' } });
    expect(r1.statusCode).toBe(200);
    const events = parseSse(r1.body);
    expect(events.at(-1)!.event).toBe('error');

    // 实例已被移出池；下一条消息触发重建并成功
    provider.push(simpleScript('重建成功'));
    const r2 = await app.inject({ method: 'POST', url: `/api/threads/${threadId}/messages`, payload: { content: '再来' } });
    expect(parseSse(r2.body).at(-1)).toMatchObject({
      event: 'done',
      data: { finish_reason: 'completed', usage: { input_tokens: 10, output_tokens: 5 } },
    });
  });

  it('POOL_EXHAUSTED：池满且无空闲可淘汰 → 409', async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
    await setup({ POOL_SIZE: '1' });

    await select('demo');
    const t1 = (await createThread('demo')).json().thread_id as string;
    provider.push([{ type: 'wait', id: 'busy' }, ...simpleScript('done')] as FakeStep[]);
    const p1 = app.inject({ method: 'POST', url: `/api/threads/${t1}/messages`, payload: { content: '占住实例' } });
    await providerLastReached(provider, 'busy');

    // 直接切到另一个数字人（切换不销毁实例，demo 实例仍忙碌占池）
    writeAgent(root, 'demo2');
    await select('demo2');
    const t2 = (await createThread('demo2')).json().thread_id as string;
    const res = await app.inject({ method: 'POST', url: `/api/threads/${t2}/messages`, payload: { content: '挤不进池' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('POOL_EXHAUSTED');

    await app.inject({ method: 'POST', url: `/api/threads/${t1}/stop` });
    await p1;
  });
});

async function providerLastReached(provider: QueueProvider, id: string): Promise<void> {
  await waitFor(() => provider.instances.length > 0, 1000);
  await provider.last().reached(id);
}
