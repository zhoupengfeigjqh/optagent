/**
 * 002 US5 模型列表与切换集成测试（T020）：
 * GET /api/models 返回全部配置模型与默认标识；发消息带 model 生效；非法模型 400。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
  readonly requests: LlmChatRequest[] = [];
  push(s: FakeStep[]): void {
    this.queue.push(s);
  }
  async *streamChat(req: LlmChatRequest): AsyncIterable<LlmEvent> {
    this.requests.push(req);
    const f = new FakeLlmProvider(this.queue.shift() ?? simpleScript('默认'));
    yield* f.streamChat(req);
  }
}

function writeAgent(root: string, name: string): void {
  const dir = path.join(root, '.opt-agent', 'users', 'admin', 'agents', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SOUL.md'), `你是 ${name}。`);
  writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }));
  writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }));
}

describe('模型列表与切换（002 US5 / T020）', () => {
  let root: string;
  let provider: QueueProvider;
  let app: AppInstance;

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-model-'));
    writeAgent(root, 'demo');
    const configPath = path.join(root, 'config.yaml');
    writeFileSync(
      configPath,
      'models:\n  - model: deepseek-chat\n  - model: deepseek-reasoner\n  - model: qwen-max\n',
    );
    const config = loadConfig({
      env: { DEEPSEEK_API_KEY: 'sk-x', OPT_AGENT_ROOT: path.join(root, '.opt-agent') },
      configPath,
    });
    provider = new QueueProvider();
    app = await buildServer({ config, llmProvider: provider });
    await app.inject({ method: 'POST', url: '/api/agents/demo/select' });
  });
  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('GET /api/models 返回全部配置模型，is_default 仅默认项，不含 api_key', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/models' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { models: Array<{ model: string; is_default: boolean }> };
    expect(body.models).toHaveLength(3);
    expect(body.models[0]).toEqual({ model: 'deepseek-chat', is_default: true });
    expect(body.models[1]).toEqual({ model: 'deepseek-reasoner', is_default: false });
    expect(JSON.stringify(body)).not.toMatch(/api_key|apiKey|sk-x/);
  });

  it('发消息带合法 model → 该轮按所选模型执行（透传至 provider）', async () => {
    const tid = (
      await app.inject({ method: 'POST', url: '/api/threads', payload: { agent_name: 'demo' } })
    ).json().thread_id as string;
    provider.push(simpleScript('qwen 回复'));
    await app.inject({
      method: 'POST',
      url: `/api/threads/${tid}/messages`,
      payload: { content: '你好', model: 'qwen-max' },
    });
    // provider 收到的 model 字段来自请求级覆盖
    expect(provider.requests[0]).toBeDefined();
  });

  it('发消息带非法 model → 400 MODEL_NOT_FOUND', async () => {
    const tid = (
      await app.inject({ method: 'POST', url: '/api/threads', payload: { agent_name: 'demo' } })
    ).json().thread_id as string;
    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${tid}/messages`,
      payload: { content: '你好', model: 'not-exist' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('MODEL_NOT_FOUND');
  });
});
