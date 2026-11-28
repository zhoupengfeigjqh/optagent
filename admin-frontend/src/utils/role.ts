/**
 * 角色判定唯一口径。
 *
 * 管理台守卫（`useAuthSession.isAdmin`）与用户列表展示都必须走这里：
 * 未来角色枚举扩展时，只改这一处，不会出现"守卫放行但列表显示普通用户"。
 */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'admin'
}
