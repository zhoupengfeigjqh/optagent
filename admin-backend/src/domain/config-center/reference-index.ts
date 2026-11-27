/**
 * 统一清单快照（`ReferenceIndex`）：数字人三类引用**只能是清单内已存在的对象**
 * （`FR-019`）。把三份清单收拢为一个不可变快照，供保存校验、异常判定与
 * 部署前校验共用**同一份判据**，避免三处各自取数导致结论漂移。
 */
export interface ReferenceIndex {
  builtinTools: ReadonlySet<string>;
  mcpServices: ReadonlySet<string>;
  skills: ReadonlySet<string>;
  /**
   * 本体（来自本体库，`FR-058`，2026-10-17）。
   *
   * 键形如 `"{metadata.scenario_name}/{metadata.ontology_name}"`——与部署路径
   * `ontology/{场景}/{本体}/` 的两段完全一致；同名本体可存在于不同场景，故不能只用本体名。
   */
  ontologies: ReadonlySet<string>;
  mcpTools: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface ReferenceIndexInput {
  builtinTools: Iterable<string>;
  mcpServices: Iterable<string>;
  skills: Iterable<string>;
  ontologies?: Iterable<string>;
  mcpTools?: Iterable<readonly [string, Iterable<string>]>;
}

export function createReferenceIndex(input: ReferenceIndexInput): ReferenceIndex {
  return {
    builtinTools: new Set(input.builtinTools),
    mcpServices: new Set(input.mcpServices),
    skills: new Set(input.skills),
    ontologies: new Set(input.ontologies ?? []),
    mcpTools: new Map([...(input.mcpTools ?? [])].map(([name, tools]) => [name, new Set(tools)])),
  };
}

/** 空清单（运行环境不可达等降级场景；此时任何非空引用都会被判为失效） */
export const EMPTY_REFERENCE_INDEX: ReferenceIndex = createReferenceIndex({
  builtinTools: [],
  mcpServices: [],
  skills: [],
  ontologies: [],
  mcpTools: [],
});
