/**
 * 002 US2 历史元数据集成测试（T011）：
 * 历史消息含 id/ts/usage/duration_seconds/status；思考内容与工具信息零落盘；
 * 失败轮留痕（status='failed' + error）。
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  push(s: FakeStep[]): void {
    this.queue.push(s);
  }
  async *streamChat(req: LlmChatRequest): AsyncIterable<LlmEvent> {
    const f = new FakeLlmProvider(this.queue.shift() ?? simpleScript('默认'));
    yield* f.streamChat(req);
  }
}

interface HistoryMessageJson {
  id: string;
  role: string;
  content: string;
  ts: string;
  status?: string;
  usage?: { input_tokens: number; output_tokens: number };
  duration_seconds?: number;
  feedback: string | null;
  error?: { code: string; message: string };
}

describe('历史消息元数据（002 US2）', () => {
  let root: string;
  let provider: QueueProvider;
  let app: AppInstance;
  let threadId: string;

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-meta-'));
    const agentDir = path.join(root, '.opt-agent', 'users', 'admin', 'agents', 'demo');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(path.join(agentDir, 'SOUL.md'), '你是 demo。');
    writeFileSync(path.join(agentDir, 'TOOL.json'), JSON.stringify({ enabled: [] }));
    writeFileSync(path.join(agentDir, 'MCP.json'), JSON.stringify({ servers: [] }));
    const configPath = path.join(root, 'config.yaml');
    writeFileSync(configPath, 'models:\n  - model: m1\n');
    const config = loadConfig({
      env: { DEEPSEEK_API_KEY: 'sk-x', OPT_AGENT_ROOT: path.join(root, '.opt-agent') },
      configPath,
    });
    provider = new QueueProvider();
    app = await buildServer({ config, llmProvider: provider });
    await app.inject({ method: 'POST', url: '/api/agents/demo/select' });
    threadId = (
      await app.inject({ method: 'POST', url: '/api/threads', payload: { agent_name: 'demo' } })
    ).json().thread_id as string;
  });
  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('完成轮：历史消息含 id/ts/usage/duration_seconds/status/feedback 字段', async () => {
    provider.push(simpleScript('回答', '思考内容不应落盘'));
    await app.inject({
      method: 'POST',
      url: `/api/threads/${threadId}/messages`,
      payload: { content: '问题', thinking: true },
    });

    const res = await app.inject({ method: 'GET', url: `/api/threads/${threadId}` });
    const messages = res.json().messages as HistoryMessageJson[];
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'user', content: '问题' });
    expect(messages[0]!.id).toBeTruthy();
    expect(messages[0]!.ts).toBeTruthy();
    expect(messages[0]!.feedback).toBeNull();
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: '回答',
      status: 'completed',
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    expect(typeof messages[1]!.duration_seconds).toBe('number');

    // 思考内容零落盘（FR-009 / SC-003）
    const raw = readFileSync(
      path.join(root, '.opt-agent/users/admin/user-data/threads', threadId, 'history.jsonl'),
      'utf8',
    );
    expect(raw).not.toContain('思考内容不应落盘');
    expect(raw).not.toMatch(/tool_call|tool_name/);
  });

  it('含工具调用的一轮：历史中无任何工具调用信息', async () => {
    provider.push([
      { type: 'tool_call_start', callId: 'c1', name: 'read_file' },
      { type: 'tool_call_end', callId: 'c1', status: 'success' },
      ...simpleScript('好'),
    ]);
    await app.inject({
      method: 'POST',
      url: `/api/threads/${threadId}/messages`,
      payload: { content: '查一下' },
    });
    const res = await app.inject({ method: 'GET', url: `/api/threads/${threadId}` });
    const body = JSON.stringify(res.json().messages);
    expect(body).not.toContain('read_file');
    expect(body).not.toMatch(/tool_call/);
  });

  it('失败轮：历史留痕 status=failed 与 error 信息（FR-011）', async () => {
    provider.push([{ type: 'error', code: 'LLM_ERROR', message: '模型超时', usage: { inputTokens: 5, outputTokens: 1 } }]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${threadId}/messages`,
      payload: { content: '会失败的问题' },
    });
    expect(res.statusCode).toBe(200); // SSE 正常结束，错误在事件流内

    const detail = await app.inject({ method: 'GET', url: `/api/threads/${threadId}` });
    const messages = detail.json().messages as HistoryMessageJson[];
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      status: 'failed',
      error: { code: 'LLM_ERROR', message: '模型超时' },
      usage: { input_tokens: 5, output_tokens: 1 },
    });
    expect(typeof messages[1]!.duration_seconds).toBe('number');
  });

  it('旧格式历史行（仅 role/content）兼容读取：合成 id、ts 回填线程创建时间', async () => {
    const historyFile = path.join(root, '.opt-agent/users/admin/user-data/threads', threadId, 'history.jsonl');
    writeFileSync(historyFile, '{"role":"user","content":"旧问题"}\n{"role":"assistant","content":"旧回答"}\n');

    const res = await app.inject({ method: 'GET', url: `/api/threads/${threadId}` });
    const body = res.json();
    const messages = body.messages as HistoryMessageJson[];
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ['user', '旧问题'],
      ['assistant', '旧回答'],
    ]);
    expect(messages[0]!.id).toBe(`${threadId}-1`);
    expect(messages[1]!.id).toBe(`${threadId}-2`);
    expect(messages[0]!.ts).toBe(body.created_at);
    expect(messages[1]!.usage).toBeUndefined();
    expect(messages[1]!.feedback).toBeNull();
  });
});
