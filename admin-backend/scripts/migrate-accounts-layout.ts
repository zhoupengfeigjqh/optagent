#!/usr/bin/env tsx
/**
 * 账号域目录结构收敛（2026-11-27）：
 *   `.platform-data/{users,sessions}/` → `.platform-data/accounts/{users,sessions}/`
 *
 * 用法：`npm run migrate:accounts-layout`
 *   - 读 `PLATFORM_DATA_DIR`（缺省 `./.platform-data`，与 dev/start 同口径）；
 *   - **只复制，不删旧目录**；校验通过后由人决定何时删除；
 *   - 幂等：重复执行时已一致的文件记为 identical；
 *   - 目标已存在且内容不同 → 冲突，**不覆盖**，非零退出。
 *
 * 退出码：0 全部就绪（copied / identical）；1 有冲突或读目录失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  applyAccountsLayoutMigration,
  planAccountsLayoutMigration,
} from '../src/infra/accounts-layout-migration.js';

function main(): void {
  const dataRoot = path.resolve(process.cwd(), process.env.PLATFORM_DATA_DIR ?? './.platform-data');

  if (!fs.existsSync(dataRoot)) {
    console.error(`[migrate:accounts-layout] 平台数据目录不存在：${dataRoot}`);
    process.exit(1);
  }

  const plan = planAccountsLayoutMigration(dataRoot);
  const total = plan.groups.reduce((sum, group) => sum + group.items.length, 0);

  console.log(`[migrate:accounts-layout] 数据目录：${dataRoot}`);
  if (total === 0) {
    console.log('[migrate:accounts-layout] 旧目录下没有 JSON 记录，无需迁移（已是新结构）');
    return;
  }

  for (const group of plan.groups) {
    console.log(`\n  ${group.key}:`);
    console.log(`    从 ${group.from}`);
    console.log(`    到 ${group.to}`);
    for (const item of group.items) {
      const marker = item.status === 'copied' ? '+' : item.status === 'identical' ? '=' : '!';
      console.log(`    ${marker} ${item.id}.json  ${item.status}${item.reason ? `（${item.reason}）` : ''}`);
    }
  }

  const result = applyAccountsLayoutMigration(plan);
  console.log(
    `\n[migrate:accounts-layout] 完成：复制 ${result.copied} 个、已一致 ${result.identical} 个、冲突 ${result.conflicts} 个`,
  );

  if (result.conflicts > 0) {
    console.error(
      '[migrate:accounts-layout] 存在冲突，未覆盖任何目标文件。请人工比对后删除多余副本，再重跑本脚本。',
    );
    process.exit(1);
  }

  // 写后复核：能读出来且与源一致才算通过（避免半截写入被当成成功）
  const after = planAccountsLayoutMigration(dataRoot);
  const unresolved = after.groups.flatMap((group) =>
    group.items.filter((item) => item.status !== 'identical').map((item) => `${group.key}/${item.id}`),
  );
  if (unresolved.length > 0) {
    console.error(`[migrate:accounts-layout] 复核失败，仍未就绪：${unresolved.join('、')}`);
    process.exit(1);
  }

  console.log(
    '[migrate:accounts-layout] 校验通过。旧目录（users/ · sessions/）已无用途，' +
      '确认新结构下能正常登录后，可手工删除它们。',
  );
}

main();
