/**
 * 名称与路径安全判据（**唯一**落点，`FR-015`、`FR-020`）。
 *
 * 数字人名、用户标识、场景名、数据准备二级目录名、字段名**共用**这两条判据
 * ——它们最终都会成为路径或键名，口径必须一致，散落各处必然分叉。
 *
 * 独立成模块的原因：`agent-design.ts` 加场景字段约束后越过 500 行门禁
 * （宪章原则二），按"一个文件一个职责"拆出判据；同时避免与
 * `scenario.ts` 相互 import。
 */

/** 名称安全：非空、≤64 字符、不含分隔符 / `..` / 控制字符 */
export function isSafeName(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0 || name.length > 64) return false;
  if (name === '.' || name === '..') return false;
  if (/[/\\]/.test(name)) return false;
  if (name.includes('..')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return false;
  return true;
}

/** 场景二级目录名（与字段名）安全：同名称规则，且不允许为空 */
export function isSafeDirName(name: string): boolean {
  return typeof name === 'string' && name.trim() !== '' && isSafeName(name);
}
