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
  logger?.info(
    { event: 'shutdown.begin', scope: 'system', grace_ms: graceMs },
    '进入优雅关闭：停止接新请求，等待在途 run',
  );

  // `app.close()` 抛错**不能吞掉整个关闭流程**：否则在途 run 无人等待、
  // 注意 `shutdown.closed` 由 agent-backend 的 onClose 钩子记录（日志流关闭必须在其后）。
  const closed = app.close().catch((err: unknown) => {
    logger?.warn(
      { err, event: 'shutdown.close.failed', scope: 'system' },
      'HTTP 服务关闭时报错（仍继续等待在途 run 收尾）',
    );
  });
  const drained = waitUntilDrained(runManager);

  const winner = await Promise.race([
    Promise.all([closed, drained]).then(() => 'drained' as const),
    sleep(graceMs).then(() => 'timeout' as const),
  ]);
  if (winner === 'drained') return 'drained';

  logger?.warn(
    { alert: true, event: 'shutdown.grace.expired', scope: 'system', grace_ms: graceMs },
    '宽限到期，中断残留 run',
  );
  runManager.stopAll();
  await Promise.all([closed, drained]);
  return 'aborted';
}

async function waitUntilDrained(runManager: RunManager): Promise<void> {
  while (runManager.inFlightCount() > 0) await sleep(20);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
