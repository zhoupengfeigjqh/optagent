/**
 * 统一清单快照（`ReferenceIndex`）：数字人三类引用**只能是清单内已存在的对象**
 * （`FR-019`）。把三份清单收拢为一个不可变快照，供保存校验、异常判定与
 * 部署前校验共用**同一份判据**，避免三处各自取数导致结论漂移。
 */
export interface ReferenceIndex {
  /** 内置工具目录（来自运行环境只读投影，`FR-011`） */
  builtinTools: ReadonlySet<string>;
  /** MCP 服务（来自容器编排声明，`FR-043`） */
  mcpServices: ReadonlySet<string>;
  /** SKILL（来自共享技能库，`FR-036`） */
  skills: ReadonlySet<string>;
}

export interface ReferenceIndexInput {
  builtinTools: Iterable<string>;
  mcpServices: Iterable<string>;
  skills: Iterable<string>;
}

export function createReferenceIndex(input: ReferenceIndexInput): ReferenceIndex {
  return {
    builtinTools: new Set(input.builtinTools),
    mcpServices: new Set(input.mcpServices),
    skills: new Set(input.skills),
  };
}

/** 空清单（运行环境不可达等降级场景；此时任何非空引用都会被判为失效） */
export const EMPTY_REFERENCE_INDEX: ReferenceIndex = createReferenceIndex({
  builtinTools: [],
  mcpServices: [],
  skills: [],
});
