/**
 * 判定合成层（020）：缓存 + 签名重载 + 多本体合成 + 唯一的中文文案。
 *
 * 对外只暴露 `ScopeGuardPort`（`check` / `invalidate`）。三条硬约束：
 * 1. **永不抛**：任何异常都收敛成"管控不可用 → 拒绝"（fail-closed）；
 * 2. **零副作用**：除缓存与本文件的 `warn` 出口，不写任何东西、不发任何请求；
 * 3. **不依赖环境**：不知道工具从哪来、不知道 MCP/HITL/HTTP，也不 import `infra`。
 */
import { catalogSignature, loadGuardCatalog } from './catalog.js';
import { decideScope, matchKeys, normalizeName } from './policy.js';
import type {
  BehaviorBinding,
  BehaviorRef,
  DenyReason,
  GuardSnapshot,
  ScopeDecision,
  ScopeDenyCode,
  ScopeGuardInput,
  ScopeGuardPort,
  ScopeKind,
  ScopeVerdict,
} from './types.js';

export function createScopeGuard(input: ScopeGuardInput): ScopeGuardPort {
  let snapshot: GuardSnapshot | null = null;
  /** 已告警过的冲突签名：同一组合只吵一次，避免每次调用刷日志 */
  const warnedConflicts = new Set<string>();

  const emit = (warnings: string[]): void => {
    if (warnings.length === 0) return;
    try {
      input.warn?.(warnings);
    } catch {
      // 告警出口故障不得影响判定（原则九：可观测性不能反过来制造故障）
    }
  };

  const ensureSnapshot = (): GuardSnapshot => {
    const signature = catalogSignature(input.agentDir);
    if (snapshot !== null && snapshot.signature === signature) return snapshot;
    const loaded = loadGuardCatalog(input.agentDir, signature);
    snapshot = loaded;
    emit(loaded.warnings);
    return loaded;
  };

  const refOf = (binding: BehaviorBinding, snap: GuardSnapshot): BehaviorRef => {
    const ontology = snap.ontologies.get(binding.ontologyKey);
    return {
      ontologyKey: binding.ontologyKey,
      scenarioName: ontology?.scenarioName ?? '',
      ontologyName: ontology?.ontologyName ?? binding.ontologyKey,
      behaviorName: binding.behaviorName,
    };
  };

  const check = (toolName: string): ScopeDecision => {
    try {
      const snap = ensureSnapshot();

      const bindings: BehaviorBinding[] = [];
      const seen = new Set<string>();
      for (const key of matchKeys(toolName)) {
        for (const binding of snap.byBehavior.get(key) ?? []) {
          const id = `${binding.ontologyKey}\u0000${normalizeName(binding.behaviorName)}`;
          if (seen.has(id)) continue;
          seen.add(id);
          bindings.push(binding);
        }
      }
      if (bindings.length === 0) return { kind: 'not_ontology' };

      if (bindings.length > 1) {
        const conflictKey = bindings.map((b) => b.ontologyKey).join('|');
        if (!warnedConflicts.has(conflictKey)) {
          warnedConflicts.add(conflictKey);
          emit([
            `${input.agentDir}:behavior_conflict:${bindings[0]!.behaviorName}:${conflictKey}`,
          ]);
        }
      }

      let allowed: { binding: BehaviorBinding; verdict: Extract<ScopeVerdict, { kind: 'allow' }> } | null =
        null;

      // 拒绝优先（`FR-015`）：任一本体拒绝即拒绝；按本体键升序保证可复现
      for (const binding of bindings) {
        const ontology = snap.ontologies.get(binding.ontologyKey);
        let verdict: ScopeVerdict;
        if (ontology === undefined || ontology.status === 'no_securities') {
          verdict = {
            kind: 'deny',
            code: 'ONTOLOGY_SCOPE_UNAVAILABLE',
            reason: 'no_securities',
            scopeKind: 'unavailable',
            scopeSize: 0,
          };
        } else {
          const entry = ontology.entries.get(normalizeName(binding.behaviorName));
          verdict = decideScope(entry, input.username);
        }
        if (verdict.kind === 'deny') {
          return denyDecision(refOf(binding, snap), verdict);
        }
        if (allowed === null) allowed = { binding, verdict };
      }

      if (allowed === null) return { kind: 'not_ontology' };
      return {
        kind: 'allow',
        behavior: refOf(allowed.binding, snap),
        rule: allowed.verdict.rule,
      };
    } catch (err) {
      // fail-closed：判定自身出错时不得放行，也不得把异常抛给调用方
      emit([`${input.agentDir}:evaluator_error:${(err as Error).message}`]);
      return {
        kind: 'deny',
        behavior: null,
        code: 'ONTOLOGY_SCOPE_UNAVAILABLE',
        reason: 'internal_error',
        scopeKind: 'unavailable',
        scopeSize: 0,
        message: buildMessage(null, 'internal_error'),
      };
    }
  };

  return {
    check,
    invalidate: () => {
      snapshot = null;
    },
  };
}

function denyDecision(ref: BehaviorRef, verdict: Extract<ScopeVerdict, { kind: 'deny' }>): ScopeDecision {
  return {
    kind: 'deny',
    behavior: ref,
    code: verdict.code,
    reason: verdict.reason,
    scopeKind: verdict.scopeKind,
    scopeSize: verdict.scopeSize,
    message: buildMessage(ref, verdict.reason),
  };
}

/**
 * 中文拒绝文案的**唯一**来源（包装器不拼文案，契约 §4）。
 *
 * 只讲"哪个本体、哪个行为、哪类原因"，**不含** `scope` 名单（`FR-016`）；
 * 唯一豁免是归属不可知（`internal_error`）时的兜底。
 */
function buildMessage(ref: BehaviorRef | null, reason: DenyReason): string {
  if (ref === null || reason === 'internal_error') {
    return '本体的授权配置不可用，已按安全默认拒绝执行；请联系管理员重新部署该本体。';
  }
  const label = `${ref.ontologyName}/${ref.behaviorName}`;
  if (reason === 'disabled') {
    return `本体行为「${label}」当前已被停用，已拒绝执行。`;
  }
  if (reason === 'no_entry' || reason === 'no_securities') {
    return `本体行为「${label}」的授权配置不可用，已按安全默认拒绝执行；请联系管理员重新部署该本体。`;
  }
  return `本体行为「${label}」未授权给当前用户，已拒绝执行。`;
}

/**
 * 兜底文案与错误码：**仅供包装器在端口违约（`check` 抛错）时使用**。
 *
 * 文案留在本文件，确保"用户可见文案只有一个来源"；包装器只引用，不拼字。
 */
export const SCOPE_GUARD_FALLBACK_MESSAGE =
  '本体的授权配置不可用，已按安全默认拒绝执行；请联系管理员重新部署该本体。';
export const SCOPE_GUARD_FALLBACK_CODE: ScopeDenyCode = 'ONTOLOGY_SCOPE_UNAVAILABLE';

/** 供测试与日志断言使用的错误码字面量（避免各处手写字符串） */
export const SCOPE_DENY_CODES: readonly ScopeDenyCode[] = [
  'ONTOLOGY_SCOPE_DENIED',
  'ONTOLOGY_BEHAVIOR_DISABLED',
  'ONTOLOGY_SCOPE_UNAVAILABLE',
];

/** 供测试断言的 `scope_kind` 取值（与契约 §5.1 一致） */
export const SCOPE_KINDS: readonly ScopeKind[] = ['everyone', 'disable', 'users', 'unavailable'];
