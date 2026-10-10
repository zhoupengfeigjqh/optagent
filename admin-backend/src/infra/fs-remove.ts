/**
 * 可靠的文件/目录删除（`fs.rmSync` 的替代实现）。
 *
 * **为什么不直接用 `fs.rmSync`**（2026-10-09 根因修正）：
 * Node 的 `rmSync` 在 Windows 上对**含非 ASCII 字符（中文）的路径**会
 * **静默失败**——既不抛错也不删除。实测 Node 24.13.0：
 *
 * ```text
 * fs.rmSync('…/海大生产计划助手.json', { recursive: true, force: true })  → 返回后文件仍在
 * fs.unlinkSync('…/海大生产计划助手.json')                                → 删除成功
 * ```
 *
 * 同一目录下的 ASCII 名文件一切正常，加 `maxRetries` 或 `path.toNamespacedPath()`
 * 也无效——所以**不是**"Windows 非 ASCII 路径限制"，而是 `rmSync` 自身实现
 * （它内部还要走 `lstat`/`rename` 等额外步骤）的缺陷。
 *
 * 后果很隐蔽：删除数字人 / 技能 / 本体，或部署覆盖时清理旧目录，都会留下
 * "界面说删了、磁盘还在"的不一致状态，且下次同名导入反被"已存在"挡住。
 *
 * 因此这里改用 `unlinkSync` / `rmdirSync` **手工递归**——实测对本环境的中文路径
 * 可靠，语义与 `rmSync(..., { recursive: true, force: true })` 对齐：
 * - 目标不存在 → 直接返回（幂等）；
 * - 目录 → 先递归子项，再 `rmdir`；
 * - 其它（文件、符号链接）→ 删条目本身，**不跟进**链接目标。
 */
import fs from 'node:fs';
import path from 'node:path';

export function removeTree(abs: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return; // 幂等：不存在即成功
    throw err;
  }

  if (!stat.isDirectory()) {
    fs.unlinkSync(abs);
    return;
  }

  for (const entry of fs.readdirSync(abs)) {
    removeTree(path.join(abs, entry));
  }
  fs.rmdirSync(abs);
}
