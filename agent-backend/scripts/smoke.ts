/**
 * 冒烟脚本（T012 竖切 + T055 全链路，手动运行，不进 CI）：`npm run smoke`
 *
 * 前置：.env 配好 DEEPSEEK_API_KEY，config.yaml 配好 models。
 * 烧真 API（deepseek-v4-flash-vision-exp），覆盖：
 *   1. thinking 开 —— thinking_delta → content_delta → done(usage)，首事件 <5s（SC-001）
 *   2. thinking 关 —— 无 thinking_delta
 *   3. AbortController 中断 —— 产出 aborted 事件而非挂起
 *   4. HTTP 全链路（独立临时 OPT_AGENT_ROOT）——select/建 thread/发消息/stop/
 *      token 落库（usage.db）/ 历史完整
 */
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { createStreamFn, runAgentLoopEvents } from '../src/infra/agent-loop.js';
import { buildServer } from '../src/server.js';
import type { LlmEvent } from '../src/types.js';

// 加载 .env（Node 20.12+ 内置）
try {
  process.loadEnvFile();
} catch {
  /* .env 不存在时依赖外部环境变量 */
}

async function runOnce(label: string, thinking: boolean, abortAfterFirstEvent = false) {
  const config = loadConfig();
  const provider = deepseekProvider();
  const entry = config.defaultModel;
  const model = provider.getModels().find((m) => m.id === entry.model);
  if (!model) throw new Error(`模型目录无 ${entry.model}`);

  const ac = new AbortController();
  const events: LlmEvent[] = [];
  let thinkingChars = 0;
  let contentChars = 0;
  const t0 = performance.now();
  let firstEventMs = -1;

  console.log(`\n=== ${label}（thinking=${thinking}）===`);
  const stream = runAgentLoopEvents({
    model: model as never,
    streamFn: createStreamFn(provider, entry.apiKey),
    systemPrompt: '你是简洁的助手。',
    messages: [{ role: 'user', content: '9.11 和 9.9 哪个大？请推理后回答。' }],
    tools: [],
    thinking,
    signal: ac.signal,
  });

  for await (const e of stream) {
    if (firstEventMs < 0) firstEventMs = performance.now() - t0;
    events.push(e);
    if (e.type === 'thinking_delta') thinkingChars += e.delta.length;
    if (e.type === 'content_delta') contentChars += e.delta.length;
    if (abortAfterFirstEvent) {
      console.log('  → 收到首个事件，触发 abort');
      ac.abort();
      abortAfterFirstEvent = false;
    }
    if (e.type === 'done') console.log(`  usage: input=${e.usage.inputTokens} output=${e.usage.outputTokens}`);
    if (e.type === 'error') console.log(`  error: ${e.code} ${e.message}`);
  }
  console.log(
    `  事件统计: total=${events.length} thinkingChars=${thinkingChars} contentChars=${contentChars} 首事件=${firstEventMs.toFixed(0)}ms`,
  );
  return { events, thinkingChars, contentChars, firstEventMs };
}

const failures: string[] = [];

// 1. thinking 开
const r1 = await runOnce('用例 1：thinking 开', true);
if (r1.thinkingChars === 0) failures.push('thinking 开但无 thinking_delta');
if (r1.contentChars === 0) failures.push('无 content_delta');
if (!r1.events.some((e) => e.type === 'done')) failures.push('无 done 事件（usage 提取失败）');
if (r1.firstEventMs >= 5000) failures.push(`首事件延迟 ${r1.firstEventMs.toFixed(0)}ms ≥5s（SC-001 不达标）`);

// 2. thinking 关
const r2 = await runOnce('用例 2：thinking 关', false);
if (r2.thinkingChars > 0) failures.push('thinking 关但仍收到 thinking_delta');
if (r2.contentChars === 0) failures.push('thinking 关时无 content');

// 3. 中断
const r3 = await runOnce('用例 3：AbortController 中断', true, true);
if (!r3.events.some((e) => e.type === 'error' && e.code === 'ABORTED')) {
  failures.push('abort 后未收到 ABORTED error 事件');
}

// 4. HTTP 全链路（真实 provider + 临时数据根）：select/发消息/stop/token 落库
async function runHttpCase(): Promise<void> {
  console.log('\n=== 用例 4：HTTP 全链路（首字延迟 / stop / token 落库）===');
  const root = mkdtempSync(path.join(tmpdir(), 'optagent-smoke-'));
  try {
    const agentDir = path.join(root, '.opt-agent', 'users', 'admin', 'agents', 'smoke');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(path.join(agentDir, 'SOUL.md'), '你是冒烟测试数字人，回答简洁。');
    writeFileSync(path.join(agentDir, 'TOOL.json'), JSON.stringify({ enabled: [] }));
    writeFileSync(path.join(agentDir, 'MCP.json'), JSON.stringify({ servers: [] }));

    const config = loadConfig({
      env: { ...process.env, OPT_AGENT_ROOT: path.join(root, '.opt-agent') } as NodeJS.ProcessEnv,
    });
    const app = await buildServer({ config }); // 不注入 provider → 真实 PiAiLlmProvider
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

    const post = (url: string, body?: unknown) =>
      fetch(`${base}${url}`, {
        method: 'POST',
        ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });

    const sel = await post('/api/agents/smoke/select');
    if (!sel.ok) throw new Error(`select 失败：${sel.status} ${await sel.text()}`);
    const t = await (await post('/api/threads', { agent_name: 'smoke' })).json();
    const threadId = t.thread_id as string;

    // 发一条会产生较长输出的消息，首 content 事件后立即 stop
    const t0 = performance.now();
    const res = await post(`/api/threads/${threadId}/messages`, {
      content: '从 1 数到 50，每个数字单独一行，不要解释。',
    });
    if (!res.ok || !res.body) throw new Error(`消息请求失败：${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let sse = '';
    let firstTokenMs = -1;
    let stopSent = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sse += decoder.decode(value, { stream: true });
      if (firstTokenMs < 0 && sse.includes('event:')) {
        firstTokenMs = performance.now() - t0;
      }
      if (!stopSent && sse.includes('event: content')) {
        stopSent = true;
        const stopRes = await post(`/api/threads/${threadId}/stop`);
        const stopBody = await stopRes.json();
        console.log(`  stop → ${stopRes.status} ${JSON.stringify(stopBody)}`);
        if (!stopBody.stopped) failures.push('stop 返回 stopped:false（run 进行中应为 true）');
      }
    }
    console.log(`  首字延迟=${firstTokenMs.toFixed(0)}ms`);
    if (firstTokenMs < 0) failures.push('HTTP 链路未收到任何 SSE 事件');
    else if (firstTokenMs >= 5000) failures.push(`HTTP 首字延迟 ${firstTokenMs.toFixed(0)}ms ≥5s`);
    if (!/event: done/.test(sse)) failures.push('HTTP 链路未收到 done 终结事件');

    // token 落库：stop 轮也应记录用量
    const usage = await (await fetch(`${base}/api/usage/summary?agent_name=smoke`)).json();
    console.log(`  usage: records=${usage.records} in=${usage.total_input_tokens} out=${usage.total_output_tokens}`);
    if (usage.records < 1) failures.push('usage.db 无记录（token 落库失败）');

    await app.close();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ ${msg}`);
    failures.push(`HTTP 全链路异常：${msg}`);
  } finally {
    // Windows 上 SQLite/WAL 句柄释放有延迟，重试清理；清理失败不掩盖用例结果
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch {
      console.warn(`  （临时目录清理失败，可手动删除：${root}）`);
    }
  }
}

await runHttpCase();

console.log('\n=== 冒烟结果 ===');
if (failures.length === 0) {
  console.log('✅ 全部通过：事件粒度与中断语义符合预期');
} else {
  console.error('❌ 失败项：');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
