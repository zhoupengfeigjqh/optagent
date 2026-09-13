/**
 * 跨平台安全删除原语（domain 层共用）。
 *
 * 背景：Windows + Node（v24.13 实测）下，路径任意位置含中文等**非 ASCII 字符**时，
 * `fs.rmSync` 整体静默失效（不抛错、不删除，force/maxRetries 均无效）；
 * 而 `unlinkSync`/`rmdirSync`/`readdirSync` 等原语在同路径上行为正常。
 * 因此删除操作一律走本模块的手动实现，不使用 `rmSync`。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 删除单文件；不存在则忽略（等效 `rmSync(p, {force:true})` 语义） */
export function removeFileSafe(p: string): void {
  try {
    fs.unlinkSync(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/** removeFileSafe 的异步版（等效 `fs.promises.rm(p, {force:true})` 语义） */
export async function removeFileSafeAsync(p: string): Promise<void> {
  try {
    await fs.promises.unlink(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/** 递归删除目录（逐层 unlink + rmdir）；不存在则忽略 */
export function removeDirRecursive(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) removeDirRecursive(p);
    else fs.unlinkSync(p);
  }
  fs.rmdirSync(dir);
}
