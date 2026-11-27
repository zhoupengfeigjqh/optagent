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
