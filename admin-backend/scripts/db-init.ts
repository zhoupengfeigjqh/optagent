/**
 * 建库建表（幂等）：执行 `specs/028-account-mysql-binding/schema.sql` 的表级 DDL。
 * `--reset` 先 DROP 目标库再重建（`npm run db:reset`）。
 *
 * 前置：库已启动（本地 Docker 见仓库根 `docker-compose.yml` 的 mysql 服务，`npm run db:up`）。
 * 连接项取 `.env.local` 的 `MYSQL_*`；未配置时回落到本地开发容器口径（禁止用于生产）。
 * 重复执行不报错（DDL 全为 IF NOT EXISTS，种子为 INSERT IGNORE）。
 */
import mysql from 'mysql2/promise';
import { readSchemaStatements } from './lib/schema-sql.js';

const HOST = process.env.MYSQL_HOST ?? '127.0.0.1';
const PORT = Number(process.env.MYSQL_PORT ?? 3306);
const USER = process.env.MYSQL_USER ?? 'root';
const PASSWORD = process.env.MYSQL_PASSWORD ?? '123456';
const DATABASE = process.env.MYSQL_DATABASE ?? 'optagent';

if (!/^[A-Za-z0-9_]+$/.test(DATABASE)) {
  throw new Error(`MYSQL_DATABASE 只能是字母/数字/下划线：${DATABASE}`);
}

/** `--reset`：先删库再重建（`db:reset` 用；比删数据卷第安全，不会误伤别的库） */
const RESET = process.argv.includes('--reset');

async function main(): Promise<void> {
  const conn = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD });
  try {
    if (RESET) {
      await conn.query(`DROP DATABASE IF EXISTS \`${DATABASE}\``);
      console.log(`db:reset 已删库 ${DATABASE}，按 schema.sql 重建`);
    }
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${DATABASE}\` DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_0900_ai_ci`,
    );
    await conn.query(`USE \`${DATABASE}\``);

    const statements = readSchemaStatements();
    for (const statement of statements) await conn.query(statement);

    const [tables] = await conn.query<mysql.RowDataPacket[]>('SHOW TABLES');
    const names = tables.map((row) => Object.values(row)[0]).join(', ');
    console.log(`db:init 完成 → ${USER}@${HOST}:${PORT}/${DATABASE}`);
    console.log(`已执行 ${statements.length} 条 DDL；表：${names}`);
  } finally {
    await conn.end();
  }
}

main().catch((err: unknown) => {
  console.error(`db:init 失败：${(err as Error).message}`);
  process.exitCode = 1;
});
