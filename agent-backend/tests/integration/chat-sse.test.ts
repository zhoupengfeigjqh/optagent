/**
 * 002 US1 SSE 全事件序列集成测试（T008）：
 * 工具调用事件成对出现（仅工具名）、done 含 duration_seconds 与 message_id。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { buildServer } from '../../src/server';
import type { LlmChatRequest, LlmProvider } from '../../src/infra/llm/llm-provider';
import type { LlmEvent } from '../../src/types';
import { FakeLlmProvider, type FakeStep } from '../helpers/fake-llm-provider';

type AppInstance = Awaited<ReturnType<typeof buildServer>>;

class QueueProvider implements LlmProvider {
  private readonly queue: FakeStep[][] = [];
  push(s: FakeStep[]): void {
    this.queue.push(s);
  }
  async *streamChat(req: LlmChatRequest): AsyncIterable<LlmEvent> {
    const f = new FakeLlmProvider(this.queue.shift() ?? []);
    yield* f.streamChat(req);
  }
}

function parseSse(body: string): Array<{ event: string; data: Record<string, unknown> }> {
  return body
    .split('\n\n')
    .filter((b) => b.trim())
    .map((block) => ({
      event: /event: (\w+)/.exec(block)![1]!,
      data: JSON.parse(/data: (.*)/.exec(block)![1]!) as Record<string, unknown>,
    }));
}

describe('SSE 工具调用事件（002 US1）', () => {
  let root: string;
  let provider: QueueProvider;
  let app: AppInstance;

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-sse-'));
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
  });
  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('含工具调用的一轮：tool_call/tool_call_end 成对、无入参结果，done 含耗时与 message_id', async () => {
    await app.inject({ method: 'POST', url: '/api/agents/demo/select' });
    const threadId = (
      await app.inject({ method: 'POST', url: '/api/threads', payload: { agent_name: 'demo' } })
    ).json().thread_id as string;

    provider.push([
      { type: 'thinking_delta', delta: '先查文件' },
      { type: 'tool_call_start', callId: 'c1', name: 'read_file' },
      { type: 'tool_call_end', callId: 'c1', status: 'success' },
      { type: 'tool_call_start', callId: 'c2', name: 'list_dir' },
      { type: 'tool_call_end', callId: 'c2', status: 'error' },
      { type: 'content_delta', delta: '结论' },
      { type: 'done', usage: { inputTokens: 100, outputTokens: 20 } },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${threadId}/messages`,
      payload: { content: '看看目录', thinking: true },
    });
    expect(res.statusCode).toBe(200);

    const events = parseSse(res.body);
    expect(events.map((e) => e.event)).toEqual([
      'thinking',
      'tool_call',
      'tool_call_end',
      'tool_call',
      'tool_call_end',
      'content',
      'done',
    ]);
    // 仅工具名与标识；任何事件负载不含 args/result
    expect(events[1]!.data).toEqual({ call_id: 'c1', name: 'read_file', status: 'running' });
    expect(events[2]!.data).toEqual({ call_id: 'c1', status: 'success' });
    expect(events[4]!.data).toEqual({ call_id: 'c2', status: 'error' });
    for (const e of events.filter((e) => e.event.startsWith('tool'))) {
      expect(JSON.stringify(e.data)).not.toMatch(/args|result/);
    }
    // done：token + 耗时 + message_id
    const done = events.at(-1)!.data;
    expect(done.usage).toEqual({ input_tokens: 100, output_tokens: 20 });
    expect(typeof done.duration_seconds).toBe('number');
    expect(done.message_id).toMatch(/^m_/);
  });
});
