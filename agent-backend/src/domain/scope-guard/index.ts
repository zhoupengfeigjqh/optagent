/**
 * 本体行为权限闸门（020）的**唯一导出面**。
 *
 * 外部只见三样：工厂 `createScopeGuard`、端口/决策类型、错误码常量。
 * 规则、加载、缓存、文案都在包内部，改它们不会波及装配层。
 */
export {
  createScopeGuard,
  SCOPE_DENY_CODES,
  SCOPE_GUARD_FALLBACK_CODE,
  SCOPE_GUARD_FALLBACK_MESSAGE,
  SCOPE_KINDS,
  SCOPE_TERMINAL_NOTICE,
} from './guard.js';
export type {
  BehaviorRef,
  DenyReason,
  ScopeDecision,
  ScopeDenyCode,
  ScopeGuardInput,
  ScopeGuardPort,
  ScopeKind,
  ScopeRule,
} from './types.js';
