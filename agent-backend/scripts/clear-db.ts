/**
 * 运维脚本：查看 / 清空 sqlite 库的**表数据**（保留表与索引结构，MUST NOT `DROP`）。
 *
 * 用途：需要一份"干净但结构完好"的库时（例如验收前重置调用统计与 Token 用量）。
 * 与 `smoke.ts` / `perf.ts` 同处 `scripts/`，都是**只在本机跑的运维入口**，不进服务进程。
 *
 * 用法（在 `agent-backend` 目录下，默认库为 `.opt-agent/usage.db`）：
 *   npm run db:inspect                 # 看表、行数、列与自增计数
 *   npm run db:clear                   # 清空数据
 *   npx tsx scripts/clear-db.ts clear .opt-agent/usage.db   # 指定库
 *
 * `clear` 只做 `DELETE FROM <表>`（跳过 `sqlite_*` 内部表），并重置 `AUTOINCREMENT`
 * 计数，使新数据的 id 从 1 重新开始；**表与索引一律保留**。
 */
import path from 'node:path';

import Database from 'better-sqlite3';

const DEFAULT_DB = path.join('.opt-agent', 'usage.db');

const action = process.argv[2] === 'clear' ? 'clear' : 'inspect';
const dbPath = path.resolve(process.argv[3] ?? DEFAULT_DB);

const db = new Database(dbPath);
try {
  // 只取业务表：`sqlite_*`（如 `sqlite_sequence`）是引擎内部表，不动
  const tables = (db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all() as Array<{ name: string }>)
    .map((row) => row.name)
    .filter((name) => !name.startsWith('sqlite_'));

  const countOf = (table: string): number =>
    (db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }).c;
  const columnsOf = (table: string): string =>
    (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>)
      .map((column) => column.name)
      .join(', ');
  const hasSequence = Boolean(
    db.prepare(`SELECT name FROM sqlite_master WHERE name = 'sqlite_sequence'`).get(),
  );

  if (action === 'clear') {
    // 一个事务内清空全部表：要么都空，要么都不动（避免只清了一半）
    db.transaction(() => {
      for (const table of tables) db.prepare(`DELETE FROM "${table}"`).run();
      // 重置自增计数（表还在，只是下一个 id 从 1 开始）
      if (hasSequence) db.prepare(`DELETE FROM sqlite_sequence`).run();
    })();
    console.log(`已清空数据（表结构保留）: ${dbPath}`);
  } else {
    console.log(`库: ${dbPath}`);
  }

  for (const table of tables) {
    console.log(`  ${table}: ${countOf(table)} 行  [${columnsOf(table)}]`);
  }
  if (action === 'inspect' && hasSequence) {
    const sequences = db.prepare(`SELECT name, seq FROM sqlite_sequence`).all() as Array<{
      name: string;
      seq: number;
    }>;
    for (const row of sequences) console.log(`  [自增计数] ${row.name} = ${row.seq}`);
  }
} finally {
  db.close();
}
