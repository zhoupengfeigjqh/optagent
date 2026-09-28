/**
 * MCP 工具入参 schema 的**视图裁剪**（把"由运行环境注入的参数"对 LLM 隐藏）。
 *
 * 抽出原因（宪章原则二）：`mcp-tool-adapter.ts` 是既有超限文件，而"schema 视图裁剪"
 * 是一族自洽的纯函数——本次 R11 新增的 `result_url` 隐藏正是复用它，属与本次改动
 * **直接相关**的邻近逻辑，故一并移出（而非借机搬迁无关代码）。
 *
 * 两条裁剪规则：
 * 1. **按参数名删除**（`exposeSchema`）：穿透参数 `uid`/`sid`、异步工具的 `result_url`
 *    —— 它们的值由运行环境在**发出调用之前**注入，模型无从填写，也就不可能幻觉出
 *    伪造值或覆盖；服务端看到的入参依旧完整（`required` 里的同名项一并移除）。
 * 2. **按取值路径删除**（`hideSchemaPaths`）：`file_args` 派生模式的目标字段——
 *    沿对象段进 `properties`、数组段进 `items` 逐步下行，只复制走过的分支，
 *    未触碰的部分保持原对象引用。
 */
import type { FileArgStep } from '../../domain/file-arg-path.js';

/** JSON Schema 里我们关心的部分（只读） */
export interface InputSchemaLike {
  properties?: Record<string, unknown>;
  required?: unknown;
  [key: string]: unknown;
}

/**
 * 暴露给 LLM 的入参 schema：**删掉由运行环境注入的参数**（含 `required` 里的同名项）。
 *
 * 删 `required` 里的一项是否会让模型少填必填参数？不会——这些值由运行环境补齐。
 * 未声明任何注入参数的工具**原样返回**（不碰第三方给的 schema 对象）。
 */
export function exposeSchema(schema: unknown, injected: readonly string[]): unknown {
  if (injected.length === 0 || typeof schema !== 'object' || schema === null) {
    return schema ?? { type: 'object', properties: {} };
  }
  const source = schema as InputSchemaLike;
  const properties = { ...(source.properties ?? {}) };
  for (const name of injected) delete properties[name];
  const next: InputSchemaLike = { ...source, properties };
  if (Array.isArray(source.required)) {
    const required = source.required.filter(
      (item): item is string => typeof item === 'string' && !injected.includes(item),
    );
    if (required.length > 0) next.required = required;
    else delete next.required;
  }
  return next;
}

/**
 * 从呈现给 LLM 的 JSON Schema 中**按取值路径剔除派生目标字段**（含嵌套）。
 *
 * 路径上的某层在 schema 里不存在（如服务方没声明该字段）时跳过——运行期注入仍会发生，
 * 服务端是否接受交由服务端校验。没有可隐藏的字段时**原样返回**（不碰第三方给的 schema 对象）。
 */
export function hideSchemaPaths(schema: unknown, paths: FileArgStep[][]): unknown {
  if (paths.length === 0 || typeof schema !== 'object' || schema === null) return schema;
  let out: unknown = schema;
  for (const steps of paths) {
    const result = hideSchemaStep(out, steps);
    if (result.changed) out = result.node;
  }
  return out;
}

function hideSchemaStep(
  node: unknown,
  steps: FileArgStep[],
): { node: unknown; changed: boolean } {
  if (typeof node !== 'object' || node === null) return { node, changed: false };
  const step = steps[0]!;
  const obj = node as InputSchemaLike;
  const childOf = (key: string): unknown =>
    (obj.properties as Record<string, unknown> | undefined)?.[key];

  if (step.array) {
    if (steps.length === 1) {
      // 目标本身就是数组属性（如 `files[]`）：整段属性从 schema 隐藏
      const properties = { ...(obj.properties ?? {}) };
      if (!(step.key in properties)) return { node, changed: false };
      delete properties[step.key];
      const next: InputSchemaLike = { ...obj, properties };
      if (Array.isArray(obj.required)) {
        const required = obj.required.filter(
          (item): item is string => typeof item === 'string' && item !== step.key,
        );
        if (required.length > 0) next.required = required;
        else delete next.required;
      }
      return { node: next, changed: true };
    }
    // 数组段：取该属性的数组 schema，下行到**元素 schema**（`items`）再继续
    const arraySchema = childOf(step.key);
    const inner = hideSchemaStep(
      (arraySchema as { items?: unknown } | undefined)?.items,
      steps.slice(1),
    );
    if (!inner.changed) return { node, changed: false };
    const nextArray = { ...(arraySchema as object), items: inner.node };
    return {
      node: { ...obj, properties: { ...(obj.properties ?? {}), [step.key]: nextArray } },
      changed: true,
    };
  }

  if (steps.length === 1) {
    const properties = { ...(obj.properties ?? {}) };
    if (!(step.key in properties)) return { node, changed: false };
    delete properties[step.key];
    const next: InputSchemaLike = { ...obj, properties };
    if (Array.isArray(obj.required)) {
      const required = obj.required.filter(
        (item): item is string => typeof item === 'string' && item !== step.key,
      );
      if (required.length > 0) next.required = required;
      else delete next.required;
    }
    return { node: next, changed: true };
  }

  const child = (obj.properties as Record<string, unknown> | undefined)?.[step.key];
  const inner = hideSchemaStep(child, steps.slice(1));
  if (!inner.changed) return { node, changed: false };
  return {
    node: { ...obj, properties: { ...(obj.properties ?? {}), [step.key]: inner.node } },
    changed: true,
  };
}
