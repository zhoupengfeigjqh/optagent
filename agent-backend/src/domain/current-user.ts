import { AsyncLocalStorage } from 'node:async_hooks';

export interface CurrentUser {
  userId: string;
}

export const BUILTIN_ADMIN: CurrentUser = Object.freeze({ userId: 'admin' });

interface RequestIdentity {
  userId: string;
}

export const authContext = new AsyncLocalStorage<RequestIdentity>();

/**
 * 取当前用户。`_auth` 参数保留以兼容既有签名（未来可从传入 payload 兜底）。
 */
export function getCurrentUser(_auth?: unknown): CurrentUser {
  const store = authContext.getStore();
  if (store && typeof store.userId === 'string' && store.userId !== '') {
    return { userId: store.userId };
  }
  return BUILTIN_ADMIN;
}
