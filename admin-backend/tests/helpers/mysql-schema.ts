/**
 * 真库用例共用：按 `specs/028-account-mysql-binding/schema.sql` 重建测试库。
 *
 * 测试库用后即删，不触碰生产口径的 `optagent`。
 */
import type mysql from 'mysql2/promise';
import { readSchemaStatements } from '../../scripts/lib/schema-sql.js';

/** 建库 → 切库 → 逐条执行表级 DDL（剥离函数与 `npm run db:init` 共用同一份） */
export async function recreateSchema(conn: mysql.Connection, database: string): Promise<void> {
  await conn.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await conn.query(`CREATE DATABASE \`${database}\` DEFAULT CHARACTER SET utf8mb4`);
  await conn.query(`USE \`${database}\``);
  for (const statement of readSchemaStatements()) await conn.query(statement);
}
