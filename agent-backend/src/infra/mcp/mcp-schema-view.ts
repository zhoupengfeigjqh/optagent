import type { FileArgStep } from '../../domain/file-arg-path.js';

export interface InputSchemaLike {
  properties?: Record<string, unknown>;
  required?: unknown;
  [key: string]: unknown;
}

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

export function withServerTitleX(schema: unknown, serverTitle?: string): unknown {
  const title = typeof serverTitle === 'string' ? serverTitle.trim() : '';
  if (title === '') return schema;
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return schema;
  const next = { ...(schema as InputSchemaLike) };
  delete next.title;
  next['x-title'] = title;
  return next;
}

export function hideSchemaPaths(schema: unknown, paths: FileArgStep[][]): unknown {
  if (paths.length === 0 || typeof schema !== 'object' || schema === null) return schema;
  let out: unknown = schema;
  for (const steps of paths) {
    const result = hideSchemaStep(out, steps);
    if (result.changed) out = result.node;
  }
  return out;
}

function hideSchemaStep(node: unknown, steps: FileArgStep[]): { node: unknown; changed: boolean } {
  if (typeof node !== 'object' || node === null) return { node, changed: false };
  const step = steps[0]!;
  const obj = node as InputSchemaLike;
  const childOf = (key: string): unknown =>
    (obj.properties as Record<string, unknown> | undefined)?.[key];

  if (step.array) {
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
