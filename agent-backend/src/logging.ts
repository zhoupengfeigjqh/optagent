/**
 * 日志模块：pino 按日写 `.opt-agent/logs/app-YYYY-MM-DD.log`。
 *
 * - **身份字段**：`instance_id`（进程级，见 `createLoggers`）；run 相关事件另带
 *   `user_id` / `thread_id` / `agent_name`。**进程级事件（关停、实例回收、配置无效）
 *   天然不属于任何用户，用 `scope: 'system'` 明确标记**——而不是硬塞一个 user_id，
 *   否则按 `user_id` 过滤时会把它们静默漏掉；
 * - **时长**：`duration_ms`（run 结束、慢操作）；
 * - 告警：`logger.warn({ alert: true, ... })`
 * - Token 审计**不在这里**：用量落在 `.opt-agent/usage.db`（SQLite）。早先声明过
 *   一条 `usage-*.log` 通道但从未接线，2026-09-16 已删除，避免"看着在记、其实没记"；
 * - **保留策略**：默认只保留最近 3 天（`LOG_RETENTION_DAYS`），启动时与跨天切换时清理过期文件。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino, { type Logger, type LoggerOptions } from 'pino';

/** 日志保留天数（任务 2026-09-15） */
export const LOG_RETENTION_DAYS = 3;

export interface AppLoggers {
  /** 应用主日志（app-YYYY-MM-DD.log） */
  logger: Logger;
  /**
   * 关闭日志通道（可等待，便于放在 `process.exit` 之前）。
   *
   * 写入是同步的（见 `DailyFileWriter`），因此这里**没有待刷内容**：
   * 任何时刻 `logger.info()` 返回时该行已经在磁盘上，不需要再依赖关闭时序。
   */
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

/**
 * 按日切分的日志写入器（**同步追加**）：每次写入检查日期，跨天自动换文件。
 *
 * 为什么不用 `fs.createWriteStream` + `Writable`：日志是低量低频（每分钟几行）的，
 * 而异步流在"进程退出/关闭"这个场景上有一串互相纠缠的坑，实测踩到过三种：
 *   ① `process.exit` 截断尚未落盘的写（`shutdown.exit` 直接丢）；
 *   ② 关闭后再写会被静默丢弃（`shutdown.closed` 之后的收尾日志）；
 *   ③ 目录被外部清理时 `ENOENT` 变成 unhandled error。
 * 同步追加一次消掉这三件事：**写完即落盘**，无队列、无 flush 时序、无残留句柄，
 * 关闭与否都不影响后续写入。跨天切文件与保留策略不变。
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
        // 跨天切换（启动时首次进入同样触发）：顺手清理过期日志
        this.currentName = name;
        pruneOldLogs(this.dir, [this.prefix], LOG_RETENTION_DAYS);
      }
      // 目录可能被外部清理（如测试 teardown）：重建；写不进去不影响主流程
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
  // 保留窗口：含今天在内的 keepDays 天，更早的删除
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

export function createLoggers(optAgentRoot: string, options?: LoggerOptions): AppLoggers {
  const logsDir = path.join(optAgentRoot, 'logs');
  // 启动即清一次：保证"最近 3 天"在服务启动时就成立
  pruneOldLogs(logsDir, ['app'], LOG_RETENTION_DAYS);
  const writer = new DailyFileWriter(logsDir, 'app');

  // 进程级实例标识：每行日志都带，用来把日志归到"哪一次运行"
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

/** 规范字段的 child logger 类型辅助 */
export interface LogContext {
  user_id?: string;
  thread_id?: string;
  agent_name?: string;
  event?: string;
  duration_ms?: number;
  alert?: boolean;
  /** `system` = 进程级事件（不属于任何用户/会话），与 run 事件区分开 */
  scope?: 'system' | 'run';
  [key: string]: unknown;
}

/** 同类告警的合并窗口（默认 5 分钟） */
export const WARN_MERGE_WINDOW_MS = 5 * 60 * 1000;

/**
 * **同一条消息在窗口内只告警一次**（带被合并的次数）。
 *
 * 为什么需要：数字人目录是"每次请求现扫现解析"（配置修复后无需重启即可生效），
 * 于是某个数字人配置一旦损坏，**每个请求都会告警一次**——实测同一句话在几秒内
 * 重复 10 次，把真正需要看的事件淹没。
 *
 * 与 `catalog.tools.unavailable` 的去重同一口径，区别是这里无法感知"扫描结束"，
 * 因此用**时间窗**而不是"状态变化"：持续故障每窗口最多一条，恢复后再次出现仍能看见。
 *
 * @param logger 目标 logger
 * @param event 事件名
 * @param windowMs 合并窗口；同一消息在该窗口内的重复只计入 `suppressed`
 */
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
