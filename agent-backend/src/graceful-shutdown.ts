/**
 * 优雅关闭编排（T050 / 场景 6.2）：
 *
 * SIGTERM/SIGINT →
 *   1. runManager.beginDrain()：进行中 run 标记 draining，当前消息继续写完落盘
 *   2. app.close()：停止接新请求，关闭 HTTP 服务（SSE 为 hijack 响应，
 *      Fastify 不跟踪在途流，故须另行等待 run 收尾）
 *   3. 宽限到期仍有残留 → runManager.stopAll() 中断，尽力收尾
 *   4. SQLite close / pino flush / scheduler.stopAll 由 app 的 onClose 钩子完成
 *
 * 返回 'drained'（全部自然写完）或 'aborted'（宽限到期被中断）。
 */
import type { Logger } from 'pino';
import type { RunManager } from './domain/run-manager.js';

/** 仅依赖 close()，避免本模块与 Fastify 具体类型耦合 */
export interface ClosableApp {
  close(): Promise<unknown>;
}

export async function gracefulShutdown(
  app: ClosableApp,
  runManager: RunManager,
  graceMs: number,
  logger?: Logger,
): Promise<'drained' | 'aborted'> {
  runManager.beginDrain();
  logger?.info({ event: 'shutdown.begin', grace_ms: graceMs }, '进入优雅关闭：停止接新请求，等待在途 run');

  const closed = app.close().then(() => {
    logger?.info({ event: 'shutdown.closed' }, 'HTTP 服务已关闭');
  });
  const drained = waitUntilDrained(runManager);

  const winner = await Promise.race([
    Promise.all([closed, drained]).then(() => 'drained' as const),
    sleep(graceMs).then(() => 'timeout' as const),
  ]);
  if (winner === 'drained') return 'drained';

  logger?.warn(
    { alert: true, event: 'shutdown.grace.expired', grace_ms: graceMs },
    '宽限到期，中断残留 run',
  );
  runManager.stopAll();
  await Promise.all([closed, drained]);
  return 'aborted';
}

/** 轮询至无活跃 run（run 的 done/abort 收尾在 consume 的 finally 中完成） */
async function waitUntilDrained(runManager: RunManager): Promise<void> {
  while (runManager.activeRunCount() > 0) await sleep(20);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
