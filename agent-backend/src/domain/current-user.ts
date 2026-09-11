/**
 * "当前用户"抽象。
 *
 * 本期固定返回 admin（单用户）；接口按 JWT 预留——接入认证后 userId 从 token 解析，
 * 业务层只依赖 CurrentUser 接口，不感知来源（FR-002）。
 */

export interface CurrentUser {
  userId: string;
}

export const BUILTIN_ADMIN: CurrentUser = Object.freeze({ userId: 'admin' });

/**
 * 取当前用户。预留参数：未来 JWT 中间件解析出的 token payload 从这里传入。
 */
export function getCurrentUser(_auth?: unknown): CurrentUser {
  return BUILTIN_ADMIN;
}
