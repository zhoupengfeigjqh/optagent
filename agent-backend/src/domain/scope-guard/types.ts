
export type ScopeDenyCode = 'ONTOLOGY_SCOPE_DENIED' | 'ONTOLOGY_SCOPE_UNAVAILABLE';

export type DenyReason =
  | 'not_in_scope'
  | 'empty_scope'
  | 'disabled'
  | 'no_entry'
  | 'no_securities'
  | 'internal_error';

export type ScopeRule = 'everyone' | 'user';

export type ScopeKind = 'everyone' | 'disable' | 'users' | 'unavailable';

export interface BehaviorRef {
  ontologyKey: string;
  scenarioName: string;
  ontologyName: string;
  behaviorName: string;
}

export interface BehaviorBinding {
  behaviorName: string;
  ontologyKey: string;
}

export interface SecurityEntry {
  actionName: string;
  scope: string[];
  ignored: number;
}

/** 本体状态：`no_securities` ⇒ 该本体所有行为判定为"管控配置不可用" */
export type OntologyStatus = 'ok' | 'no_securities';

export interface OntologyEntry {
  key: string;
  scenarioName: string;
  ontologyName: string;
  status: OntologyStatus;
  behaviors: BehaviorBinding[];
  entries: Map<string, SecurityEntry>;
}

/** 一次加载得到的不可变快照 */
export interface GuardSnapshot {
  signature: string;
  byBehavior: Map<string, BehaviorBinding[]>;
  ontologies: Map<string, OntologyEntry>;
  warnings: string[];
}

export type ScopeVerdict =
  | { kind: 'allow'; rule: ScopeRule }
  | {
      kind: 'deny';
      code: ScopeDenyCode;
      reason: DenyReason;
      scopeKind: ScopeKind;
      scopeSize: number;
    };

export type ScopeDecision =
  | { kind: 'not_ontology' }
  | { kind: 'allow'; behavior: BehaviorRef; rule: ScopeRule }
  | {
      kind: 'deny';
      behavior: BehaviorRef | null;
      code: ScopeDenyCode;
      reason: DenyReason;
      scopeKind: ScopeKind;
      scopeSize: number;
      message: string;
    };

export interface ScopeGuardPort {
  check(toolName: string): ScopeDecision;
  invalidate(): void;
}

export interface ScopeGuardInput {
  agentDir: string;
  username: string;
  warn?: (warnings: string[]) => void;
}
