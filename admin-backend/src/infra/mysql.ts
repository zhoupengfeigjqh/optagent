/**
 * 账号域 MySQL 连接（028 特性，阶段 1）。
 *
 * 仅承载 `STORAGE_DRIVER=mysql` 时的账号域五表（见 specs/028/…/schema.sql）；
 * 设计态（agents/skills/MCP/本体）**不经过本模块**——`PlatformStore` 仍是设计态
 * 唯一权威源（D4：只迁账号域，避免双权威源）。
 *
 * 错误语义：任何数据库故障都转为**可读的 `ApiError`**（宪章：按 `STORAGE_DRIVER`
 * 明确报错，不静默回退文件存储）。
 * - 连不上 / 拒绝访问 / 库不存在 → 启动期即失败（wiring 时 `ping()`）；
 * - 运行期失败 → `ADM_STORAGE_UNAVAILABLE`（与 `PlatformStore` 同码，health 端点可观测）。
 */
import mysql from 'mysql2/promise';
import type { Logger } from 'pino';
import { ApiError } from '../domain/api-error.js';
import { ERROR_CODES } from '../domain/error-codes.js';

export interface MysqlOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** 连接池上限（`MYSQL_POOL_SIZE`） */
  poolSize: number;
  logger: Logger | undefined;
}

/** `dateStrings: true`：DATETIME 以字符串返回，避免时区换算歧义（仅审计展示用） */
export type MysqlRow = Record<string, unknown>;

export class MysqlConnection {
  private pool: mysql.Pool | undefined;

  constructor(private readonly options: MysqlOptions) {}

  private ensurePool(): mysql.Pool {
    if (!this.pool) {
      this.pool = mysql.createPool({
        host: this.options.host,
        port: this.options.port,
        user: this.options.user,
        password: this.options.password,
        database: this.options.database,
        connectionLimit: this.options.poolSize,
        waitForConnections: true,
        dateStrings: true,
      });
    }
    return this.pool;
  }

  /** 启动期连通性验证：不可达即抛可读错误（不做静默回退） */
  async ping(): Promise<void> {
    await this.select('SELECT 1 AS ok');
  }

  /** SELECT：返回行数组（行结构由调用方断言） */
  async select<T = MysqlRow>(sql: string, params?: unknown[]): Promise<T[]> {
    try {
      const [rows] = await this.ensurePool().query<mysql.RowDataPacket[]>(sql, params);
      return rows as unknown as T[];
    } catch (err) {
      // 唯一键冲突原样透传：仓储层据 isDuplicateEntry() 转 ADM_USER_ID_TAKEN 等业务码
      if (isDuplicateEntry(err)) throw err;
      throw translateMysqlError(err, this.options);
    }
  }

  /** INSERT/UPDATE/DELETE：返回受影响行数 */
  async modify(sql: string, params?: unknown[]): Promise<{ affectedRows: number }> {
    try {
      const [result] = await this.ensurePool().query<mysql.ResultSetHeader>(sql, params);
      return { affectedRows: result.affectedRows };
    } catch (err) {
      if (isDuplicateEntry(err)) throw err;
      throw translateMysqlError(err, this.options);
    }
  }

  async close(): Promise<void> {
    const pool = this.pool;
    this.pool = undefined;
    if (pool) await pool.end().catch((err: unknown) => {
      this.options.logger?.warn({ event: 'mysql.close.failed', err: String(err) }, '关闭 MySQL 连接池失败');
    });
  }
}

/** MySQL 原生错误 → 可读 `ApiError`（唯一键冲突不经此处，见 select/modify） */
export function translateMysqlError(err: unknown, options: Pick<MysqlOptions, 'database' | 'user'>): ApiError {
  if (err instanceof ApiError) return err;
  const code = (err as { code?: string }).code ?? '';
  if (code === 'ER_ACCESS_DENIED_ERROR') {
    return new ApiError(
      ERROR_CODES.ADM_STORAGE_UNAVAILABLE,
      `MySQL 拒绝访问（检查 MYSQL_USER/MYSQL_PASSWORD，当前用户 ${options.user}）`,
    );
  }
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
    return new ApiError(ERROR_CODES.ADM_STORAGE_UNAVAILABLE, `账号库不可达（检查 MySQL 是否运行）`);
  }
  if (code === 'ER_BAD_DB_ERROR') {
    return new ApiError(
      ERROR_CODES.ADM_STORAGE_UNAVAILABLE,
      `数据库不存在：${options.database}（请先执行 specs/028-account-mysql-binding/schema.sql）`,
    );
  }
  return new ApiError(
    ERROR_CODES.ADM_STORAGE_UNAVAILABLE,
    `账号库（MySQL）访问失败：${(err as Error).message}`,
  );
}

/** 判断底层错误是否为唯一键冲突（仓储层用它转 `ADM_USER_ID_TAKEN` 等业务码） */
export function isDuplicateEntry(err: unknown): boolean {
  return (err as { code?: string }).code === 'ER_DUP_ENTRY';
}
