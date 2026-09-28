/**
 * 判断值是否"有效"（非 undefined / null / 空字符串）
 * 用于 col 配置回退默认值的场景：isTruth(v) ? v : default
 * 注意：0 和 false 视为有效值（例如 resizable: false 应保持 false 而不是回退默认）
 */
export function isTruth(value) {
  return value !== undefined && value !== null && value !== ''
}
