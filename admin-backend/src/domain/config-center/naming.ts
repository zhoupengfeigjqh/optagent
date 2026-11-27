
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
