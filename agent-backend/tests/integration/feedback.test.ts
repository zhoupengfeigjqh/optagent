/**
 * 002 US3 消息反馈接口集成测试（T015）：
 * 点赞/点踩互斥切换、同值重复提交=取消、不存在消息 404、非法 value 400、历史返回反馈状态。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { buildServer } from '../../src/server';
import { FakeLlmProvider, simpleScript } from '../helpers/fake-llm-provider';

type AppInstance = Awaited<ReturnType<typeof buildServer>>;

describe('消息反馈接口（002 US3 / T015）', () => {
  let root: string;
  let app: AppInstance;
  let threadId: string;
  let messageId: string;

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-fb-'));
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
    app = await buildServer({ config, llmProvider: new FakeLlmProvider(simpleScript('你好')) });

    await app.inject({ method: 'POST', url: '/api/agents/demo/select' });
    threadId = (
      await app.inject({ method: 'POST', url: '/api/threads', payload: { agent_name: 'demo' } })
    ).json().thread_id as string;
    await app.inject({
      method: 'POST',
      url: `/api/threads/${threadId}/messages`,
      payload: { content: '你好' },
    });
    // 等待落盘完成后取 assistant 消息 id
    const detail = await app.inject({ method: 'GET', url: `/api/threads/${threadId}` });
    const msgs = detail.json().messages as Array<{ role: string; id: string }>;
    messageId = msgs.find((m) => m.role === 'assistant')!.id;
  });
  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  function putFeedback(mid: string, value: 'up' | 'down' | null) {
    return app.inject({
      method: 'PUT',
      url: `/api/threads/${threadId}/messages/${mid}/feedback`,
      payload: { value },
    });
  }

  it('点赞 → 200；历史返回 feedback=up', async () => {
    const res = await putFeedback(messageId, 'up');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ message_id: messageId, feedback: 'up' });

    const detail = await app.inject({ method: 'GET', url: `/api/threads/${threadId}` });
    const msg = (detail.json().messages as Array<{ id: string; feedback: string | null }>).find(
      (m) => m.id === messageId,
    )!;
    expect(msg.feedback).toBe('up');
  });

  it('互斥切换：up → down；同值重复提交 = 取消（null）', async () => {
    expect((await putFeedback(messageId, 'up')).json().feedback).toBe('up');
    expect((await putFeedback(messageId, 'down')).json().feedback).toBe('down');
    expect((await putFeedback(messageId, 'down')).json().feedback).toBeNull();

    const detail = await app.inject({ method: 'GET', url: `/api/threads/${threadId}` });
    const msg = (detail.json().messages as Array<{ id: string; feedback: string | null }>).find(
      (m) => m.id === messageId,
    )!;
    expect(msg.feedback).toBeNull();
  });

  it('消息不存在 → 404 MESSAGE_NOT_FOUND', async () => {
    const res = await putFeedback('m_nonexist_xx', 'up');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('MESSAGE_NOT_FOUND');
  });

  it('非法 value → 400 VALIDATION_FAILED', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/threads/${threadId}/messages/${messageId}/feedback`,
      payload: { value: 'love' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('线程不存在 → 404 THREAD_NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/threads/nope/messages/m1/feedback',
      payload: { value: 'up' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('THREAD_NOT_FOUND');
  });
});
