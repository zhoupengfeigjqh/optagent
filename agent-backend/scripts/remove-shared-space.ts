/**
 * 运维脚本：删除已下线的「共享空间」存量目录（2026-11-18，`specs/025-remove-shared-space`）。
 *
 * 语义：共享空间已从运行端整体摘除（不再是空间，任何接口/工具都读不到），磁盘上既有的
 * `user-data/{数字人}/共享空间/` 属于"占空间又不可达"的残留。本脚本把它们**连内容一起删掉**。
 * 这是**不可逆**操作，因此默认 dry-run。
 *
 * 用法（在 `agent-backend` 目录下，默认根为 `.opt-agent`）：
 *   npm run data:remove-shared-space                # dry-run：只打印将删的目录与文件数
 *   npm run data:remove-shared-space -- --apply     # 真删
 *   npx tsx scripts/remove-shared-space.ts --apply <运行期根>
 *
 * 执行时机：**先部署两空间版本、再跑本脚本**。反过来做的话，旧进程仍然承认共享空间，
 * 用户在这期间上传会把这个目录重新建出来。
 *
 * 退出码：0 = 成功（含"没有可删目录"）；1 = 有目录删除失败（其余继续删，逐个计账）。
 */
import path from 'node:path';

import {
  findSharedSpaceDirs,
  removeSharedSpaceDirs,
} from '../src/domain/shared-space-cleanup.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const rootArg = args.find((arg) => arg !== '--apply');
const root = path.resolve(rootArg ?? path.join('.opt-agent'));

console.log(`运行期根：${root}`);
console.log(`扫描面：users/*/user-data/共享空间、users/*/user-data/*/共享空间`);

const dirs = findSharedSpaceDirs(root);
if (dirs.length === 0) {
  console.log('未发现「共享空间」目录（已是两空间布局）');
  process.exit(0);
}

const totalFiles = dirs.reduce((sum, dir) => sum + dir.fileCount, 0);
const totalBytes = dirs.reduce((sum, dir) => sum + dir.totalBytes, 0);
console.log(`发现 ${dirs.length} 个目录、${totalFiles} 个文件、${totalBytes} 字节：`);
for (const dir of dirs) {
  console.log(`  - ${dir.relPath}  （${dir.fileCount} 个文件 / ${dir.totalBytes} 字节）`);
}

if (!apply) {
  console.log('\ndry-run：未删除任何内容。确认清单无误后加 `-- --apply` 执行删除。');
  process.exit(0);
}

const result = await removeSharedSpaceDirs(dirs);
console.log(`\n已删除 ${result.removed.length} 个目录：`);
for (const relPath of result.removed) {
  console.log(`  - ${relPath}`);
}
if (result.failed.length > 0) {
  console.error(`删除失败 ${result.failed.length} 个目录：`);
  for (const failure of result.failed) {
    console.error(`  - ${failure.relPath}：${failure.reason}`);
  }
  process.exit(1);
}
