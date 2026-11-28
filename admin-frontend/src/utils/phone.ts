/** 手机号口径：1 开头的 11 位数字（与后端 `normalizePhone` 一致，注册后即登录标识） */
export const PHONE_PATTERN = /^1\d{10}$/

/** 校验手机号（调用方传原始输入即可，内部去首尾空白） */
export function isPhone(value: string): boolean {
  return PHONE_PATTERN.test(value.trim())
}
