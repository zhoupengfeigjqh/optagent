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
  /**
   * MCP 服务名 → 该服务的**可见工具**（`allowed_tools` 白名单）。
   *
   * 004 新增：数字人"问题实例"的关联工具允许引用 MCP 工具，判据是
   * **模型真正看得到的工具**——挂载后由 `allowed_tools` 过滤（见
   * `agent-backend/src/infra/mcp-tool-scope.ts`），白名单外的工具模型无从调用，
   * 因此引导它也没有意义，保存期直接拒绝。
   */
  mcpTools: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface ReferenceIndexInput {
  builtinTools: Iterable<string>;
  mcpServices: Iterable<string>;
  skills: Iterable<string>;
  /**
   * 服务 → 可见工具（004）。**可选**：不关心 MCP 工具粒度的调用方（如只校验三类引用的场景）
   * 可以不给，此时 `mcpTools` 为空映射——只影响问题实例的工具关联校验。
   */
  mcpTools?: Iterable<readonly [string, Iterable<string>]>;
}

export function createReferenceIndex(input: ReferenceIndexInput): ReferenceIndex {
  return {
    builtinTools: new Set(input.builtinTools),
    mcpServices: new Set(input.mcpServices),
    skills: new Set(input.skills),
    mcpTools: new Map([...(input.mcpTools ?? [])].map(([name, tools]) => [name, new Set(tools)])),
  };
}

/** 空清单（运行环境不可达等降级场景；此时任何非空引用都会被判为失效） */
export const EMPTY_REFERENCE_INDEX: ReferenceIndex = createReferenceIndex({
  builtinTools: [],
  mcpServices: [],
  skills: [],
  mcpTools: [],
});
