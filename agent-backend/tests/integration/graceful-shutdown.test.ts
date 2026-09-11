/**
 * 优雅关闭集成测试（T050 / 场景 6.2）：
 * - 宽限内：进行中 run 继续写完落盘（draining），新请求被拒
 * - 宽限到期：stopAll 中断残留 run，进程可退出（不挂起）
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import type { AppContext } from '../../src/context';
import { gracefulShutdown } from '../../src/graceful-shutdown';
import { buildServer } from '../../src/server';
import { FakeLlmProvider, type FakeStep } from '../helpers/fake-llm-provider';

type AppInstance = Awaited<ReturnType<typeof buildServer>>;

describe('优雅关闭（T050）', () => {
  let root: string;
  let provider: FakeLlmProvider;
  let app: AppInstance;
  let ctx: AppContext;

  async function boot(script: FakeStep[]): Promise<void> {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-shutdown-'));
    const dir = path.join(root, '.opt-agent', 'users', 'admin', 'agents', 'demo');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SOUL.md'), '你是 demo。');
    writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }));
    writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }));
    writeFileSync(path.join(root, 'config.yaml'), 'models:\n  - model: m1\n');
    const config = loadConfig({
      env: { DEEPSEEK_API_KEY: 'sk-x', OPT_AGENT_ROOT: path.join(root, '.opt-agent') },
      configPath: path.join(root, 'config.yaml'),
    });
    provider = new FakeLlmProvider(script);
    app = await buildServer({ config, llmProvider: provider });
    ctx = (app as unknown as { ctx: AppContext }).ctx;
  }

  afterEach(async () => {
    rmSync(root, { recursive: true, force: true });
  });

  async function startMessage(): Promise<{ threadId: string; done: Promise<unknown> }> {
    await app.inject({ method: 'POST', url: '/api/agents/demo/select' });
    const t = (
      await app.inject({ method: 'POST', url: '/api/threads', payload: { agent_name: 'demo' } })
    ).json().thread_id as string;
    const done = app.inject({ method: 'POST', url: `/api/threads/${t}/messages`, payload: { content: 'hi' } });
    return { threadId: t, done };
  }

  it('宽限内 draining：当前消息写完落盘；新请求被拒', async () => {
    await boot([
      { type: 'content_delta', delta: '前半段' },
      { type: 'wait', id: 'hold' },
      { type: 'content_delta', delta: '后半段' },
      { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
    ]);

    const { threadId, done } = await startMessage();
    await provider.reached('hold'); // 推到一半停住

    const shutdown = gracefulShutdown(app, ctx.runManager, 5000, ctx.loggers.logger);
    // 已进入 draining（不再接新对话请求由 main() 的信号路径保证，此处验证状态机）
    expect(ctx.runManager.isDraining()).toBe(true);

    // 放行让当前消息写完
    provider.resume('hold');
    await done;
    const outcome = await shutdown;
    expect(outcome).toBe('drained');
    expect(ctx.history.readRecent('admin', threadId, 20).map((m) => m.content)).toEqual([
      'hi',
      '前半段后半段',
    ]);
    // （shutdown 完成后 onClose 已关闭 SQLite/pino，不再查询用量——落库由 usage-db 测试覆盖）
  });

  it('宽限到期：中断残留 run，close 不挂起', async () => {
    await boot([
      { type: 'content_delta', delta: '写到一半' },
      { type: 'wait', id: 'never' }, // 永不放行
    ]);

    const { done } = await startMessage();
    await provider.reached('never');

    const outcome = await gracefulShutdown(app, ctx.runManager, 150, ctx.loggers.logger);
    expect(outcome).toBe('aborted');
    await done; // SSE 响应以 error/abort 收尾
  }, 10000);
});
