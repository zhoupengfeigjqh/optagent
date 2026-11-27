import path from 'node:path';

import Database from 'better-sqlite3';

const DEFAULT_DB = path.join('.opt-agent', 'usage.db');

const action = process.argv[2] === 'clear' ? 'clear' : 'inspect';
const dbPath = path.resolve(process.argv[3] ?? DEFAULT_DB);

const db = new Database(dbPath);
try {
  const tables = (
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as Array<{
      name: string;
    }>
  )
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
