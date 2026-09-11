/**
 * 性能核验脚本（T053，手动运行）：`npx tsx scripts/perf.ts`
 *
 * 非 LLM 接口 P95 ≤200ms（SC 指标）：threads 列表 / files 列表 / usage 汇总。
 * 用 app.inject 在进程内压测（排除网络抖动，测量的是服务端处理耗时）。
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { buildServer } from '../src/server.js';

const ROUNDS = 200;

const root = mkdtempSync(path.join(tmpdir(), 'optagent-perf-'));
try {
  const agentDir = path.join(root, '.opt-agent', 'users', 'admin', 'agents', 'demo');
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(path.join(agentDir, 'SOUL.md'), '你是 demo。');
  writeFileSync(path.join(agentDir, 'TOOL.json'), JSON.stringify({ enabled: [] }));
  writeFileSync(path.join(agentDir, 'MCP.json'), JSON.stringify({ servers: [] }));
  writeFileSync(path.join(root, 'config.yaml'), 'models:\n  - model: m1\n');

  const config = loadConfig({
    env: { DEEPSEEK_API_KEY: 'sk-x', OPT_AGENT_ROOT: path.join(root, '.opt-agent') },
    configPath: path.join(root, 'config.yaml'),
  });
  const app = await buildServer({ config });
  const ctx = (app as unknown as { ctx: AppContext }).ctx;

  // 灌数据：30 个 thread + 100 条 usage + tmp 下 10 个文件
  for (let i = 0; i < 30; i++) {
    await app.inject({ method: 'POST', url: '/api/agents/demo/select' });
    await app.inject({ method: 'POST', url: '/api/threads', payload: { agent_name: 'demo' } });
  }
  for (let i = 0; i < 100; i++) {
    ctx.usage.record({
      userId: 'admin', threadId: `t${i % 30}`, agentName: 'demo',
      inputTokens: 10, outputTokens: 5, createdAt: new Date().toISOString(),
    });
  }
  const tmpDir = path.join(root, '.opt-agent', 'users', 'admin', 'user-data', 'tmp');
  mkdirSync(tmpDir, { recursive: true });
  for (let i = 0; i < 10; i++) writeFileSync(path.join(tmpDir, `t1_out${i}.txt`), 'x'.repeat(1024));

  const targets = [
    ['GET /api/threads', '/api/threads'],
    ['GET /api/files/list?dir=tmp', '/api/files/list?dir=tmp'],
    ['GET /api/usage/summary', '/api/usage/summary'],
    ['GET /api/agents', '/api/agents'],
  ] as const;

  let failed = false;
  for (const [label, url] of targets) {
    const samples: number[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      const t0 = performance.now();
      const res = await app.inject({ method: 'GET', url });
      samples.push(performance.now() - t0);
      if (res.statusCode !== 200) throw new Error(`${label} → ${res.statusCode}`);
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(ROUNDS * 0.5)]!;
    const p95 = samples[Math.floor(ROUNDS * 0.95)]!;
    const p99 = samples[Math.floor(ROUNDS * 0.99)]!;
    const ok = p95 <= 200;
    if (!ok) failed = true;
    console.log(`${ok ? '✅' : '❌'} ${label}  P50=${p50.toFixed(1)}ms  P95=${p95.toFixed(1)}ms  P99=${p99.toFixed(1)}ms`);
  }

  await app.close();
  if (failed) {
    console.error('\n存在 P95 >200ms 的接口');
    process.exit(1);
  }
  console.log('\n✅ 全部接口 P95 ≤200ms');
} finally {
  rmSync(root, { recursive: true, force: true });
}
