import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino, { type Logger, type LoggerOptions } from 'pino';

export const LOG_RETENTION_DAYS = 3;

export interface AppLoggers {
  logger: Logger;
  close(): Promise<void>;
}

/**
 * 进程实例标识：`主机名-进程号-启动时刻`。
 *
 * 为什么需要它：容器里 `pid` 恒为 1、`hostname` 是容器 ID（每次重建都变），
 * 这两个字段合起来仍然回答不了"这条日志属于哪一次运行"。`instance_id`
 * 在同一进程内恒定、重启必变，便于把一批日志归到同一次运行、并与容器重建对上。
 */
export function instanceId(): string {
  return `${os.hostname()}-${process.pid}-${new Date().toISOString()}`;
}

class DailyFileWriter {
  private currentName = '';

  constructor(
    private readonly dir: string,
    private readonly prefix: string,
  ) {}

  private fileName(): string {
    const day = new Date().toISOString().slice(0, 10);
    return `${this.prefix}-${day}.log`;
  }

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

  close(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * 只保留最近 `keepDays` 天的日志文件（含当天）；删除失败静默——日志清理
 * 不致命，MUST NOT 因清理失败影响写日志本身。
 */
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
          // 删除失败留待下次清理
        }
      }
      break;
    }
  }
}

export function createLoggers(optAgentRoot: string, options?: LoggerOptions): AppLoggers {
  const logsDir = path.join(optAgentRoot, 'logs');
  pruneOldLogs(logsDir, ['app'], LOG_RETENTION_DAYS);
  const writer = new DailyFileWriter(logsDir, 'app');

  const logger = pino({ level: 'info', ...options }, writer).child({
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

export interface LogContext {
  user_id?: string;
  thread_id?: string;
  agent_name?: string;
  event?: string;
  duration_ms?: number;
  alert?: boolean;
  scope?: 'system' | 'run';
  [key: string]: unknown;
}

export const WARN_MERGE_WINDOW_MS = 5 * 60 * 1000;

export function createThrottledWarn(
  logger: Logger,
  event: string,
  windowMs: number = WARN_MERGE_WINDOW_MS,
): { warn(msg: string): void } {
  const last = new Map<string, { at: number; suppressed: number }>();
  return {
    warn(msg: string): void {
      const now = Date.now();
      const previous = last.get(msg);
      if (previous && now - previous.at < windowMs) {
        previous.suppressed += 1;
        return;
      }
      const suppressed = previous?.suppressed ?? 0;
      last.set(msg, { at: now, suppressed: 0 });
      logger.warn(
        { alert: true, event, scope: 'system', ...(suppressed > 0 ? { suppressed } : {}) },
        suppressed > 0 ? `${msg}（窗口内另有 ${suppressed} 次相同告警已合并）` : msg,
      );
    },
  };
}
