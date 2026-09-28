/**
 * 跨平台安全删除原语（domain 层共用）。
 *
 * 背景：Windows + Node（v24.13 实测）下，路径任意位置含中文等**非 ASCII 字符**时，
 * `fs.rmSync` 整体静默失效（不抛错、不删除，force/maxRetries 均无效）；
 * 而 `unlinkSync`/`rmdirSync`/`readdirSync` 等原语在同路径上行为正常。
 * 因此删除操作一律走本模块的手动实现，不使用 `rmSync`。
 *
 * **为什么面向请求路径的删除默认用异步版**：删除是「多文件 × 单次文件系统调用」的操作，
 * 而单次删除的开销在**软件层**可能有巨大差异——实测同一台机器、同一块 NVMe、同一 NTFS：
 * C: 盘 `unlinkSync` 0–1ms，D: 盘 ~300ms（安全软件/过滤驱动所致）。
 * 同步删除会把这段时间**整个占住事件循环**，期间服务无法响应任何请求：删除一个会话
 * 会把用户紧接着发出的"切换会话"一起拖慢（实测 DELETE 780ms → 紧随其后的 GET 被拖到 744ms）。
 * 故 `*Async` 为默认选择；同步版本只保留给**极小的单文件**场景（`removeFileSafe`）。
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

/**
 * 递归删除目录（逐层 unlink + rmdir）的**异步**版；不存在则忽略。
 *
 * - 全程 `await`，**不阻塞事件循环**：删除再慢也只影响发起它的那条请求；
 * - 容忍 `ENOENT`（并发删除/父目录已消失）——删除是幂等的，不存在 = 目标达成；
 * - 仍逐个原语实现，**不用 `fs.rm`**（见文件头：非 ASCII 路径下静默失效）。
 */
export async function removeDirRecursiveAsync(dir: string): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) await removeDirRecursiveAsync(p);
    else await removeFileSafeAsync(p);
  }
  try {
    await fs.promises.rmdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
