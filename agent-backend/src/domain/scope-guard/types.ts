/**
 * 本体行为权限闸门（020）的共享类型。
 *
 * 口径来源：`specs/020-ontology-scope-guard/data-model.md` §2/§3 与
 * `contracts/scope-guard.md` §1。本文件只有类型与常量，无逻辑、无 IO。
 */

/** 三个拒绝错误码（全局唯一，语义稳定；见契约 §3） */
export type ScopeDenyCode =
  | 'ONTOLOGY_SCOPE_DENIED'
  | 'ONTOLOGY_BEHAVIOR_DISABLED'
  | 'ONTOLOGY_SCOPE_UNAVAILABLE';

/** 拒绝原因（进日志与单测断言，不进用户文案） */
export type DenyReason =
  | 'not_in_scope'
  | 'empty_scope'
  | 'disabled'
  | 'no_entry'
  | 'no_securities'
  | 'internal_error';

/** 放行依据：`everyone` 保留标记 / 用户名命中 */
export type ScopeRule = 'everyone' | 'user';

/** 管控配置形态（日志字段 `scope_kind`，不落具体名单） */
export type ScopeKind = 'everyone' | 'disable' | 'users' | 'unavailable';

/** 行为引用：文案与日志的展示口径 */
export interface BehaviorRef {
  /** `{场景目录}/{本体目录}` */
  ontologyKey: string;
  scenarioName: string;
  ontologyName: string;
  behaviorName: string;
}

/** 行为与所属本体的绑定（同一行为名可挂多个本体） */
export interface BehaviorBinding {
  behaviorName: string;
  ontologyKey: string;
}

/** 一条 `securities.yaml` 条目：只取本特性需要两个字段 */
export interface SecurityEntry {
  actionName: string;
  /** 归一化后的 `scope`（保留标记与用户名；空值/非字符串已剔除） */
  scope: string[];
  /** 被剔除的元素个数（仅用于告警） */
  ignored: number;
}

/** 本体状态：`no_securities` ⇒ 该本体所有行为判定为"管控配置不可用" */
export type OntologyStatus = 'ok' | 'no_securities';

/** 一个本体的判定视图 */
export interface OntologyEntry {
  key: string;
  scenarioName: string;
  ontologyName: string;
  status: OntologyStatus;
  behaviors: BehaviorBinding[];
  /** 归一化 `action_name` → 条目 */
  entries: Map<string, SecurityEntry>;
}

/** 一次加载得到的不可变快照 */
export interface GuardSnapshot {
  /** 目录签名（`ontology` 根目录 mtimeMs，或 `missing`） */
  signature: string;
  /** 归一化行为名 → 绑定列表（按本体键升序，顺序稳定） */
  byBehavior: Map<string, BehaviorBinding[]>;
  ontologies: Map<string, OntologyEntry>;
  warnings: string[];
}

/** 纯策略层的判定结果 */
export type ScopeVerdict =
  | { kind: 'allow'; rule: ScopeRule }
  | {
      kind: 'deny';
      code: ScopeDenyCode;
      reason: DenyReason;
      scopeKind: ScopeKind;
      scopeSize: number;
    };

/** 对外判定结果（包装器据此透传或拒绝） */
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
      /** 唯一的中文拒绝文案来源（包装器不拼文案） */
      message: string;
    };

/**
 * 权限闸门端口：`infra` 只依赖这个接口，不依赖任何实现细节。
 *
 * 契约：`check` **永不抛错**；`invalidate` 丢弃缓存。
 */
export interface ScopeGuardPort {
  check(toolName: string): ScopeDecision;
  invalidate(): void;
}

/** 工厂入参：只给"数字人目录 + 归属用户名 + 告警出口"三样 */
export interface ScopeGuardInput {
  /** 数字人配置目录（只读） */
  agentDir: string;
  /** 当前数字人的归属用户标识（`users/{用户名}/` 的那一段） */
  username: string;
  /** 加载期告警出口（一次重载一次，交装配层写日志） */
  warn?: (warnings: string[]) => void;
}
