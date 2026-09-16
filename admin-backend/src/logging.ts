/**
 * 日志模块：pino 按日写 `.platform-data/logs/app-YYYY-MM-DD.log`。
 *
 * 与 `agent-backend/src/logging.ts` 同构（按日切分的写入流 + 规范字段），
 * 落点从 `.opt-agent/logs/` 换成平台自己的 `.platform-data/logs/`——
 * 平台设计态与运行环境数据分离（`data-model.md` §0）。
 *
 * - **操作者绑定**：每行日志默认携带 `user_id`（管理端固定单一操作者 `zyw_admin`）；
 * - **实例标识**：每行携带 `instance_id`（见 `instanceId()`）——容器里 `hostname`
 *   是容器 ID、`pid` 恒为 1，两者都无法回答"这是哪一次运行"；
 * - **写操作留痕**：由 `server.ts` 的 `onResponse` / 错误处理器统一产出
 *   `admin.write`（成功）与 `admin.write.rejected`（被拒），**一处覆盖全部写方法**；
 * - **保留策略**：默认只保留最近 3 天（`LOG_RETENTION_DAYS`），启动时与跨天切换时清理。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino, { type Logger, type LoggerOptions } from 'pino';
import { PLATFORM_OPERATOR } from './domain/error-codes.js';

/** 日志保留天数（任务 2026-09-15） */
export const LOG_RETENTION_DAYS = 3;

export interface AppLoggers {
  /** 应用主日志（app-YYYY-MM-DD.log） */
  logger: Logger;
  /** 关闭底层流（**可等待**：进程退出前必须 await，否则最后几条日志会被截断） */
  close(): Promise<void>;
}

/**
 * 按日切分的日志写入器（**同步追加**）：每次写入检查日期，跨天自动换文件。
 *
 * 与 `agent-backend/src/logging.ts` 同构。用同步追加而不是异步流：
 * 日志低量低频，而异步流在"关闭/退出"时有三个实测坑（`process.exit` 截断、
 * 关闭后再写被静默丢弃、目录被清理时 ENOENT 变成 unhandled error）。
 * 同步写一次消掉：**写完即落盘**，无队列、无 flush 时序、无残留句柄。
 */
class DailyFileWriter {
  private currentName = '';

  constructor(
    private readonly dir: string,
    private readonly prefix: string,
  ) {}

  private fileName(): string {
    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `${this.prefix}-${day}.log`;
  }

  /** pino 的写入入口（同步；失败即丢弃本条） */
  write(line: string): void {
    const name = this.fileName();
    try {
      if (name !== this.currentName) {
        this.currentName = name;
        pruneOldLogs(this.dir, [this.prefix], LOG_RETENTION_DAYS);
      }
      fs.mkdirSync(this.dir, { recursive: true });
      fs.appendFileSync(path.join(this.dir, name), line);
    } catch {
      /* 日志写不进去 MUST NOT 影响主流程（与"清理失败静默"同一口径） */
    }
  }

  /** 同步写入下已无待刷内容；保留该方法以维持关闭流程的形状 */
  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** 只保留最近 `keepDays` 天的日志文件（含当天）；删除失败静默 */
export function pruneOldLogs(dir: string, prefixes: string[], keepDays: number): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const cutoffMs = Date.now() - (keepDays - 1) * 86_400_000;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    for (const prefix of prefixes) {
      const m = entry.name.match(new RegExp(`^${prefix}-(\\d{4}-\\d{2}-\\d{2})\\.log$`));
      if (!m) continue;
      const dayMs = Date.parse(m[1] ?? '');
      if (Number.isFinite(dayMs) && dayMs < cutoffMs) {
        try {
          fs.rmSync(path.join(dir, entry.name), { force: true });
        } catch {
          // 单个文件删除失败：留待下次清理，不抛出
        }
      }
      break;
    }
  }
}

/**
 * 进程实例标识：`主机名-进程号-启动时刻`（与 `agent-backend` 同构）。
 *
 * 容器里 `pid` 恒为 1、`hostname` 是容器 ID 且每次重建都变，
 * 因此补一个"同一进程内恒定、重启必变"的实例串，便于归并与追溯。
 */
export function instanceId(): string {
  return `${os.hostname()}-${process.pid}-${new Date().toISOString()}`;
}

export function createLoggers(platformDataDir: string, options?: LoggerOptions): AppLoggers {
  const logsDir = path.join(platformDataDir, 'logs');
  // 启动即清一次：保证"最近 3 天"在服务启动时就成立
  pruneOldLogs(logsDir, ['app'], LOG_RETENTION_DAYS);
  const writer = new DailyFileWriter(logsDir, 'app');

  // 每行日志都携带操作者 user_id（管理端固定单一操作者）+ 进程实例标识
  const logger = pino({ level: 'info', ...options }, writer).child({
    user_id: PLATFORM_OPERATOR,
    instance_id: instanceId(),
  });

  return {
    logger,
    async close() {
      logger.flush();
      await writer.close();
    },
  };
}
