/**
 * 日志模块：pino 按日写 `.opt-agent/logs/app-YYYY-MM-DD.log`。
 *
 * - 规范字段（child logger bindings）：user_id / thread_id / agent_name / event / duration_ms
 * - 告警：`logger.warn({ alert: true, ... })`
 * - Token 审计：独立 child logger 写 `usage-YYYY-MM-DD.log`
 */
import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import pino, { type Logger, type LoggerOptions } from 'pino';

export interface AppLoggers {
  /** 应用主日志（app-YYYY-MM-DD.log） */
  logger: Logger;
  /** Token 用量审计日志（usage-YYYY-MM-DD.log） */
  usageLogger: Logger;
  /** 优雅关闭时 flush/关闭底层流 */
  close(): void;
}

/** 按日切分的文件写入流：每次写入检查日期，跨天自动换文件 */
class DailyFileStream extends Writable {
  private stream: fs.WriteStream | null = null;
  private currentName = '';

  constructor(
    private readonly dir: string,
    private readonly prefix: string,
  ) {
    super();
    fs.mkdirSync(dir, { recursive: true });
  }

  private fileName(): string {
    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `${this.prefix}-${day}.log`;
  }

  private ensureStream(): fs.WriteStream | null {
    const name = this.fileName();
    try {
      if (!this.stream || name !== this.currentName) {
        this.stream?.end();
        // 目录可能被外部清理（如测试 teardown）：重建，失败则丢弃本条日志
        fs.mkdirSync(this.dir, { recursive: true });
        this.stream = fs.createWriteStream(path.join(this.dir, name), { flags: 'a' });
        this.stream.on('error', () => {});
        this.currentName = name;
      }
      return this.stream;
    } catch {
      return null;
    }
  }

  override _write(chunk: Buffer | string, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
    const stream = this.ensureStream();
    if (!stream) {
      cb();
      return;
    }
    stream.write(chunk, cb);
  }

  close(): void {
    this.stream?.end();
    this.stream = null;
  }
}

export function createLoggers(optAgentRoot: string, options?: LoggerOptions): AppLoggers {
  const logsDir = path.join(optAgentRoot, 'logs');
  const appStream = new DailyFileStream(logsDir, 'app');
  const usageStream = new DailyFileStream(logsDir, 'usage');

  const logger = pino({ level: 'info', ...options }, appStream);
  const usageLogger = pino({ level: 'info', ...options }, usageStream);

  return {
    logger,
    usageLogger,
    close() {
      logger.flush();
      usageLogger.flush();
      appStream.close();
      usageStream.close();
    },
  };
}

/** 规范字段的 child logger 类型辅助 */
export interface LogContext {
  user_id?: string;
  thread_id?: string;
  agent_name?: string;
  event?: string;
  duration_ms?: number;
  alert?: boolean;
  [key: string]: unknown;
}
