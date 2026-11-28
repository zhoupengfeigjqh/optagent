/**
 * 注册链接的状态判定与排序（028 §13）。
 *
 * 「有用/已失效」的口径此前散在「停止注册」弹窗与「生成链接」弹窗两处，
 * 一旦后端新增状态（例如用尽次数）就会只改一处、两处界面口径分叉。
 */
import type { RegisterLinkItem } from '../api/types'
import { isExpired } from './datetime'

export type RegisterLinkState = 'active' | 'expired' | 'revoked'

export const REGISTER_LINK_STATE_LABELS: Record<RegisterLinkState, string> = {
  active: '有效',
  expired: '已过期',
  revoked: '已撤销',
}

type LinkTiming = Pick<RegisterLinkItem, 'revoked_at' | 'expires_at' | 'created_at'>

/** 单条状态：撤销优先于过期（撤销是显式动作，过期是时间到达） */
export function registerLinkState(link: Pick<LinkTiming, 'revoked_at' | 'expires_at'>, now = Date.now()): RegisterLinkState {
  if (link.revoked_at) return 'revoked'
  if (isExpired(link.expires_at, now)) return 'expired'
  return 'active'
}

/** 有效优先，同状态按创建时间倒序（最近生成的先看到）；不改动入参 */
export function sortRegisterLinks<T extends LinkTiming>(items: readonly T[], now = Date.now()): T[] {
  const order: Record<RegisterLinkState, number> = { active: 0, expired: 1, revoked: 2 }
  return [...items].sort(
    (a, b) =>
      order[registerLinkState(a, now)] - order[registerLinkState(b, now)] ||
      b.created_at.localeCompare(a.created_at),
  )
}

/** 「复用最新一条有效链接」：无有效链接返回 `null`（生成弹窗的入口口径） */
export function latestActiveLink<T extends LinkTiming>(items: readonly T[], now = Date.now()): T | null {
  return (
    sortRegisterLinks(
      items.filter((item) => registerLinkState(item, now) === 'active'),
      now,
    )[0] ?? null
  )
}
