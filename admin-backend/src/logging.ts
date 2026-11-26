import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino, { type Logger, type LoggerOptions } from 'pino';
import { PLATFORM_OPERATOR } from './domain/error-codes.js';
import { removeTree } from './infra/fs-remove.js';

export const LOG_RETENTION_DAYS = 3;

export interface AppLoggers {
  logger: Logger;
  /** 关闭底层流（**可等待**：进程退出前必须 await，否则最后几条日志会被截断） */
  close(): Promise<void>;
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
          // 日志目录路径可能含中文（工作区目录名），删除不能走 `fs.rmSync`（见 fs-remove.ts）
          removeTree(path.join(dir, entry.name));
        } catch {
          // 单个文件删除失败：留待下次清理，不抛出
        }
      }
      break;
    }
  }
}

export function instanceId(): string {
  return `${os.hostname()}-${process.pid}-${new Date().toISOString()}`;
}

export function createLoggers(platformDataDir: string, options?: LoggerOptions): AppLoggers {
  const logsDir = path.join(platformDataDir, 'logs');
  pruneOldLogs(logsDir, ['app'], LOG_RETENTION_DAYS);
  const writer = new DailyFileWriter(logsDir, 'app');

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
