/**
 * 002 US6 @ 文件引用集成测试（T026）：
 * 合法引用发送成功、历史消息保留结构化 attachments 且 content 不含引用文本、
 * LLM 收到 [引用文件] 附加文本；引用不存在 → 400 FILE_REF_NOT_FOUND；
 * 超过 10 个 → 400；非法目录 → 400/403。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { buildServer } from '../../src/server';
import { userDataDir } from '../../src/domain/dirs';
import type { LlmChatRequest, LlmProvider } from '../../src/infra/llm/llm-provider';
import type { LlmEvent } from '../../src/types';
import { FakeLlmProvider, simpleScript } from '../helpers/fake-llm-provider';

type AppInstance = Awaited<ReturnType<typeof buildServer>>;

class RecordingProvider implements LlmProvider {
  readonly requests: LlmChatRequest[] = [];
  async *streamChat(req: LlmChatRequest): AsyncIterable<LlmEvent> {
    this.requests.push(req);
    const f = new FakeLlmProvider(simpleScript('收到'));
    yield* f.streamChat(req);
  }
}

describe('@ 文件引用（002 US6 / T026）', () => {
  let root: string;
  let provider: RecordingProvider;
  let app: AppInstance;
  let threadId: string;

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-attach-'));
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
    provider = new RecordingProvider();
    app = await buildServer({ config, llmProvider: provider });
    const dataDir = userDataDir(config.optAgentRoot, 'admin');
    mkdirSync(path.join(dataDir, '生产计划'), { recursive: true });
    mkdirSync(path.join(dataDir, 'tmp'), { recursive: true });
    writeFileSync(path.join(dataDir, '生产计划', 'plan.csv'), 'a,b');
    writeFileSync(path.join(dataDir, 'tmp', 'note.txt'), '临时');
    await app.inject({ method: 'POST', url: '/api/agents/demo/select' });
    threadId = (
      await app.inject({ method: 'POST', url: '/api/threads', payload: { agent_name: 'demo' } })
    ).json().thread_id as string;
  });
  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('合法引用：发送成功；LLM 内容含 [引用文件]；历史保留结构化 attachments、content 干净', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${threadId}/messages`,
      payload: {
        content: '分析这份计划',
        attachments: [
          { dir: '生产计划', filename: 'plan.csv' },
          { dir: 'tmp', filename: 'note.txt' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    // LLM 收到的 content 追加了引用标注
    const llmReq = provider.requests[0]!;
    const lastUser = [...llmReq.messages].reverse().find((m) => m.role === 'user')!;
    expect(lastUser.content).toBe('分析这份计划\n[引用文件] 生产计划/plan.csv；tmp/note.txt');

    // 历史：结构化 attachments 保留，content 不含引用文本
    const detail = await app.inject({ method: 'GET', url: `/api/threads/${threadId}` });
    const userMsg = (detail.json().messages as Array<Record<string, unknown>>).find(
      (m) => m.role === 'user',
    )!;
    expect(userMsg.content).toBe('分析这份计划');
    expect(userMsg.attachments).toEqual([
      { dir: '生产计划', filename: 'plan.csv' },
      { dir: 'tmp', filename: 'note.txt' },
    ]);
  });

  it('引用文件不存在 → 400 FILE_REF_NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${threadId}/messages`,
      payload: {
        content: '看这个',
        attachments: [{ dir: '生产计划', filename: 'nope.csv' }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('FILE_REF_NOT_FOUND');
  });

  it('引用超过 10 个 → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${threadId}/messages`,
      payload: {
        content: '太多',
        attachments: Array.from({ length: 11 }, () => ({
          dir: '生产计划',
          filename: 'plan.csv',
        })),
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('引用非白名单目录 → 400/403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${threadId}/messages`,
      payload: {
        content: '越权',
        attachments: [{ dir: 'threads', filename: 'x.jsonl' }],
      },
    });
    expect([400, 403]).toContain(res.statusCode);
  });

  it('引用含路径穿越 → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${threadId}/messages`,
      payload: {
        content: '穿越',
        attachments: [{ dir: '../', filename: 'a.txt' }],
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
