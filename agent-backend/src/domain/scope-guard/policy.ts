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
import { normalizeName } from '../ontology-doc.js';
import type { ScopeVerdict, SecurityEntry } from './types.js';

/** 保留标记：不参与用户名比较 */
export const RESERVED_EVERYONE = 'everyone';
export const RESERVED_DISABLE = 'disable';

/**
 * 名称归一与匹配键的**唯一来源**是 `../ontology-doc.ts`（020/021 共用）。
 *
 * 这里只做再导出，保证既有调用方（本文件、`catalog.ts`、`guard.ts` 与测试）
 * 的 import 路径与语义不变——把口径搬走而不是复制一份。
 */
export { matchKeys } from '../ontology-doc.js';
export { normalizeName };

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

  // `disable` 优先级最高（即使同时含 `everyone`），但对外**不再单列"已停用"码**：
  // 统一按「未授权」表述，`reason` / `scopeKind` 仍区分，日志可查是被显式停用还是没授权。
  if (scope.includes(RESERVED_DISABLE)) {
    return {
      kind: 'deny',
      code: 'ONTOLOGY_SCOPE_DENIED',
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
