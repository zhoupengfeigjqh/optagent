/**
 * 密码长度约束（024 / 028）：新建用户与重置密码共用这一份。
 *
 * 与后端 `domain/auth/password.ts` 的 `PASSWORD_MIN_LENGTH/MAX_LENGTH` 同值；
 * 两边都改才生效，任一侧单独改都会让用户看到的提示与后端判据分叉。
 */
export const PASSWORD_MIN_LENGTH = 6
export const PASSWORD_MAX_LENGTH = 128

/** 校验密码长度：合法返回 `null`，否则返回可直接展示的提示文案 */
export function passwordError(value: string): string | null {
  if (value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH) return null
  return `密码长度须为 ${PASSWORD_MIN_LENGTH}~${PASSWORD_MAX_LENGTH} 个字符`
}
