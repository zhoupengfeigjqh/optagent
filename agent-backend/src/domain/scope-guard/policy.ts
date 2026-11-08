/**
 * 授权判定的**纯策略层**（020）：名称归一化 + 四条规则。
 *
 * 规则顺序（唯一权威，见 `data-model.md` §3.3）：
 * 1. `scope` 含 `disable` → 拒绝（**优先于** `everyone`）；
 * 2. `scope` 含 `everyone` → 放行；
 * 3. 当前用户名在 `scope` 中 → 放行；
 * 4. 其余 → 拒绝（空 `scope` 记为 `empty_scope`）。
 *
 * 本文件不碰文件、不碰工具、不碰日志——因此可以用纯数据把矩阵跑到 100%。
 */
import type { ScopeVerdict, SecurityEntry } from './types.js';

/** 保留标记：不参与用户名比较 */
export const RESERVED_EVERYONE = 'everyone';
export const RESERVED_DISABLE = 'disable';

/** 名称归一化：去首尾空白 + 小写（漏拦代价高于误拦，故大小写不敏感） */
export function normalizeName(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * 工具名 → 候选匹配键（1~2 个）。
 *
 * 同时给"完整名"与"去掉首个 `__` 前缀后的名字"：装配层给 MCP 工具加了
 * `{服务名}__` 前缀（现状），但"工具名本身就是行为名"的服务同样存在，
 * 只试一种会产生无解释的漏拦（`FR-003`）。
 */
export function matchKeys(toolName: string): string[] {
  const full = normalizeName(toolName);
  if (full === '') return [];
  const keys = [full];
  const sep = toolName.indexOf('__');
  if (sep >= 0) {
    const stripped = normalizeName(toolName.slice(sep + 2));
    if (stripped !== '' && stripped !== full) keys.push(stripped);
  }
  return keys;
}

/**
 * 对一条管控条目做判定。
 *
 * `entry` 缺失 = 本体行为已识别但管控未登记 → `no_entry`（fail-closed）。
 */
export function decideScope(entry: SecurityEntry | undefined, username: string): ScopeVerdict {
  if (entry === undefined) {
    return {
      kind: 'deny',
      code: 'ONTOLOGY_SCOPE_UNAVAILABLE',
      reason: 'no_entry',
      scopeKind: 'unavailable',
      scopeSize: 0,
    };
  }

  const { scope } = entry;
  const size = scope.length;

  if (scope.includes(RESERVED_DISABLE)) {
    return {
      kind: 'deny',
      code: 'ONTOLOGY_BEHAVIOR_DISABLED',
      reason: 'disabled',
      scopeKind: 'disable',
      scopeSize: size,
    };
  }
  if (scope.includes(RESERVED_EVERYONE)) {
    return { kind: 'allow', rule: 'everyone' };
  }

  const me = normalizeName(username);
  if (me !== '' && scope.includes(me)) {
    return { kind: 'allow', rule: 'user' };
  }

  return {
    kind: 'deny',
    code: 'ONTOLOGY_SCOPE_DENIED',
    reason: size === 0 ? 'empty_scope' : 'not_in_scope',
    scopeKind: 'users',
    scopeSize: size,
  };
}
