import { normalizeName } from '../ontology-doc.js';
import type { ScopeVerdict, SecurityEntry } from './types.js';

export const RESERVED_EVERYONE = 'everyone';
export const RESERVED_DISABLE = 'disable';

export { matchKeys } from '../ontology-doc.js';
export { normalizeName };

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
