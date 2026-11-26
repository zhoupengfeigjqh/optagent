
interface SchemaLike {
  title?: unknown;
  [key: string]: unknown;
}

export function withServerTitleX(schema: unknown, serverTitle?: string): unknown {
  const title = typeof serverTitle === 'string' ? serverTitle.trim() : '';
  if (title === '') return schema;
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return schema;
  const next = { ...(schema as SchemaLike) };
  delete next.title;
  next['x-title'] = title;
  return next;
}
