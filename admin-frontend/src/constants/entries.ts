/**
 * 跨应用入口常量（2026-11-24 按注册原型重构新增）。
 *
 * 管理台基址：Vite `base` 与路由 base 共用的路径前缀。
 */

/** 管理台应用基址（与 `vite.config.ts` 的 `base` 保持一致） */
export const ADMIN_BASE_PATH = '/admin'

/** 普通用户注册页属于前台应用，与后台 `/admin` 基址分离。 */
export const PUBLIC_REGISTER_PATH = '/register'
