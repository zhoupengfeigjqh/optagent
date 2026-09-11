/**
 * threads 路由集成测试（T030）：CRUD 全流程 + 分页（limit/offset/total）+
 * running 字段 + 删除连带清理（进行中 run 先 abort）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { buildServer } from '../../src/server';
import type { LlmChatRequest, LlmProvider } from '../../src/infra/llm/llm-provider';
import type { LlmEvent } from '../../src/types';
import { FakeLlmProvider, simpleScript, type FakeStep } from '../helpers/fake-llm-provider';

type AppInstance = Awaited<ReturnType<typeof buildServer>>;

class QueueProvider implements LlmProvider {
  private readonly queue: FakeStep[][] = [];
  readonly instances: FakeLlmProvider[] = [];
  push(s: FakeStep[]): void {
    this.queue.push(s);
  }
  async *streamChat(req: LlmChatRequest): AsyncIterable<LlmEvent> {
    const f = new FakeLlmProvider(this.queue.shift() ?? simpleScript('默认回复'));
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

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitFor 超时');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('threads 路由（US2）', () => {
  let root: string;
  let provider: QueueProvider;
  let app: AppInstance;

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-threads-'));
    writeAgent(root, 'demo');
    writeFileSync(path.join(root, 'config.yaml'), 'models:\n  - model: m1\n');
    const config = loadConfig({
      env: { DEEPSEEK_API_KEY: 'sk-x', OPT_AGENT_ROOT: path.join(root, '.opt-agent') },
      configPath: path.join(root, 'config.yaml'),
    });
    provider = new QueueProvider();
    app = await buildServer({ config, llmProvider: provider });
    await app.inject({ method: 'POST', url: '/api/agents/demo/select' });
  });
  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  async function createThread() {
    const res = await app.inject({ method: 'POST', url: '/api/threads', payload: { agent_name: 'demo' } });
    expect(res.statusCode).toBe(201);
    return res.json().thread_id as string;
  }
  async function send(threadId: string, content: string) {
    const res = await app.inject({ method: 'POST', url: `/api/threads/${threadId}/messages`, payload: { content } });
    expect(res.statusCode).toBe(200);
    return res;
  }

  it('列表：按 updated_at 倒序，title 取首条 user 消息前 20 字，agent_name 过滤', async () => {
    const t1 = await createThread();
    const t2 = await createThread();
    provider.push(simpleScript('答1'));
    await send(t1, '第一条消息内容超过二十个字所以会被截断成标题一部分');
    await waitFor(() => store_of(t1));
    // t2 最新（刚创建），发消息后 t1 应已更新；这里 t2 无消息 → title null
    const list = (await app.inject({ method: 'GET', url: '/api/threads?agent_name=demo' })).json() as Array<{
      thread_id: string;
      title: string | null;
      updated_at: string;
    }>;
    expect(list.length).toBe(2);
    const item1 = list.find((i) => i.thread_id === t1)!;
    expect(item1.title).toBe([...'第一条消息内容超过二十个字所以会被截断成标题一部分'].slice(0, 20).join(''));
    expect(list.find((i) => i.thread_id === t2)!.title).toBeNull();
    // 过滤不存在的 agent → 空
    const empty = await app.inject({ method: 'GET', url: '/api/threads?agent_name=nobody' });
    expect(empty.json()).toEqual([]);

    function store_of(tid: string) {
      return readFileSync(
        path.join(root, '.opt-agent/users/admin/user-data/threads', tid, 'history.jsonl'),
        'utf8',
      ).includes('assistant');
    }
  });

  it('详情分页：total 全量、limit/offset 从最新往前数、时间正序、running=false', async () => {
    const tid = await createThread();
    const historyFile = path.join(root, '.opt-agent/users/admin/user-data/threads', tid, 'history.jsonl');
    for (let i = 1; i <= 3; i++) {
      provider.push(simpleScript(`答${i}`));
      await send(tid, `问${i}`);
      // done 事件广播后 run 收尾（落盘）才释放 active 标记，等收尾再发下一条
      await waitFor(() => existsSync(historyFile) && readFileSync(historyFile, 'utf8').includes(`答${i}`));
    }
    const res = await app.inject({ method: 'GET', url: `/api/threads/${tid}?limit=2&offset=1` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      total: number;
      running: boolean;
      messages: Array<{ role: string; content: string; id: string; ts: string; feedback: string | null }>;
    };
    expect(body.total).toBe(6);
    expect(body.running).toBe(false);
    // 全部 6 条 [问1答1问2答2问3答3]；offset=1 跳过最新 1 条（答3），limit=2 → [答2, 问3]
    expect(body.messages.map((m) => [m.role, m.content])).toEqual([
      ['assistant', '答2'],
      ['user', '问3'],
    ]);
    // 002 契约：每条消息含 id/ts/feedback 字段
    for (const m of body.messages) {
      expect(m.id).toBeTruthy();
      expect(m.ts).toBeTruthy();
      expect(m.feedback).toBeNull();
    }
    expect(body.messages[0]).toMatchObject({ status: 'completed', usage: { input_tokens: 10, output_tokens: 5 } });
    expect(typeof (body.messages[0] as { duration_seconds?: number }).duration_seconds).toBe('number');
  });

  it('详情默认 limit=50；limit>200 → 400；不存在 → 404', async () => {
    const tid = await createThread();
    const ok = await app.inject({ method: 'GET', url: `/api/threads/${tid}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().total).toBe(0);
    expect((await app.inject({ method: 'GET', url: `/api/threads/${tid}?limit=201` })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/threads/nope' })).statusCode).toBe(404);
  });

  it('进行中 run 的详情 running=true，结束后 false', async () => {
    const tid = await createThread();
    provider.push([{ type: 'wait', id: 'w1' }, ...simpleScript('慢答')]);
    void send(tid, '问');
    await waitFor(() => provider.instances.length > 0);
    await provider.instances[0]!.reached('w1');
    const mid = await app.inject({ method: 'GET', url: `/api/threads/${tid}` });
    expect(mid.json().running).toBe(true);
    provider.instances[0]!.resume('w1');
    // 等 run 收尾落盘
    await waitFor(() => {
      const file = path.join(root, '.opt-agent/users/admin/user-data/threads', tid, 'history.jsonl');
      return existsSync(file) && readFileSync(file, 'utf8').includes('慢答');
    });
    // 落盘先于 run 从活跃表移除：轮询详情直到 running=false（消除并发下的时序抖动）
    let running = true;
    for (let i = 0; i < 300 && running; i++) {
      const res = await app.inject({ method: 'GET', url: `/api/threads/${tid}` });
      running = res.json().running as boolean;
      if (running) await new Promise((r) => setTimeout(r, 10));
    }
    expect(running).toBe(false);
  });

  it('重命名：200 返回新标题；>100 字 → 400；不存在 → 404', async () => {
    const tid = await createThread();
    const res = await app.inject({ method: 'PATCH', url: `/api/threads/${tid}`, payload: { title: '排产讨论' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ thread_id: tid, title: '排产讨论' });
    expect((await app.inject({ method: 'GET', url: `/api/threads/${tid}` })).json().title).toBe('排产讨论');
    const tooLong = await app.inject({ method: 'PATCH', url: `/api/threads/${tid}`, payload: { title: 'x'.repeat(101) } });
    expect(tooLong.statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/threads/nope', payload: { title: 'a' } })).statusCode).toBe(404);
  });

  it('删除：204 + 连带清理 thread 目录与 tmp 前缀文件；重复删除 404', async () => {
    const tid = await createThread();
    provider.push(simpleScript('答'));
    await send(tid, '问');
    const threadDirPath = path.join(root, '.opt-agent/users/admin/user-data/threads', tid);
    const tmpDir = path.join(root, '.opt-agent/users/admin/user-data/tmp');
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(path.join(tmpDir, `${tid}_产出.csv`), 'a,b');
    writeFileSync(path.join(tmpDir, 'other_保留.csv'), 'c,d');
    await waitFor(() => existsSync(path.join(threadDirPath, 'history.jsonl')));

    const res = await app.inject({ method: 'DELETE', url: `/api/threads/${tid}` });
    expect(res.statusCode).toBe(204);
    expect(existsSync(threadDirPath)).toBe(false);
    expect(existsSync(path.join(tmpDir, `${tid}_产出.csv`))).toBe(false);
    expect(existsSync(path.join(tmpDir, 'other_保留.csv'))).toBe(true);
    expect((await app.inject({ method: 'DELETE', url: `/api/threads/${tid}` })).statusCode).toBe(404);
  });

  it('删除有进行中 run 的 thread：先 abort 再清理', async () => {
    const tid = await createThread();
    provider.push([{ type: 'wait', id: 'w1' }, ...simpleScript('不会完成')]);
    void send(tid, '问');
    await waitFor(() => provider.instances.length > 0);
    await provider.instances[0]!.reached('w1');

    const res = await app.inject({ method: 'DELETE', url: `/api/threads/${tid}` });
    expect(res.statusCode).toBe(204);
    expect(existsSync(path.join(root, '.opt-agent/users/admin/user-data/threads', tid))).toBe(false);
  });
});
