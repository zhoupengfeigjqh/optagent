
export const ASYNC_RESULT_URL_PARAM = 'resultUrl';

interface InputSchemaLike {
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

export function declaresResultUrl(schema: unknown): boolean {
  if (typeof schema !== 'object' || schema === null) return false;
  const properties = (schema as InputSchemaLike).properties;
  if (typeof properties !== 'object' || properties === null) return false;
  return ASYNC_RESULT_URL_PARAM in (properties as Record<string, unknown>);
}

export function injectResultUrl(params: unknown, resultUrl: string): unknown {
  const base =
    typeof params === 'object' && params !== null
      ? { ...(params as Record<string, unknown>) }
      : params === undefined
        ? {}
        : null;
  if (base === null) return params;
  base[ASYNC_RESULT_URL_PARAM] = resultUrl;
  return base;
}

export interface AsyncToolContext {
  mintResultUrl: (toolName: string, toolCallId: string) => string;
}
