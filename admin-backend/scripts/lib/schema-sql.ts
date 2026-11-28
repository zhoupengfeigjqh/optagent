/**
 * schema.sql 的语句剥离（`db:init` 与真库用例共用，保证两侧永远执行同一份 DDL）。
 *
 * schema.sql 以「`mysql` 客户端整份执行」为准，因此包含 `CREATE DATABASE` / `USE`；
 * 而调用方要么已连到目标库、要么自己按 `MYSQL_DATABASE` 建库，故这两类语句必须剔除，
 * 其余语句逐条执行。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库内唯一的 DDL 来源；改动只需改这一处 */
export const SCHEMA_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../specs/028-account-mysql-binding/schema.sql',
);

const STRIPPED_STATEMENT = /^(create\s+database\b|use\b)/i;

/** 去行注释 → 按 `;` 切分 → 丢弃空语句与建库/切库语句 */
export function stripSchemaStatements(sql: string): string[] {
  const withoutComments = sql
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  return withoutComments
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !STRIPPED_STATEMENT.test(statement));
}

/** 读取并剥离仓库内 schema.sql（可按需指定路径） */
export function readSchemaStatements(schemaFile: string = SCHEMA_FILE): string[] {
  return stripSchemaStatements(fs.readFileSync(schemaFile, 'utf8'));
}
