/**
 * "当前用户"抽象（`research.md` D5）。
 *
 * - 有请求级身份（`onRequest` 鉴权钩子注入的 `AsyncLocalStorage`）时，返回该身份；
 * - 无请求上下文（启动期 `ensureRootDirs`）或鉴权未启用（未配 `AUTH_SECRET`）时，
 *   回退内置 `admin`（legacy 单用户，与改造前逐字一致）。
 *
 * 业务层只依赖本函数，不感知来源；53 处调用点零改动。
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface CurrentUser {
  userId: string;
}

export const BUILTIN_ADMIN: CurrentUser = Object.freeze({ userId: 'admin' });

interface RequestIdentity {
  userId: string;
}

/** 请求级身份存储：鉴权钩子在 `onRequest` 中写入，`getCurrentUser()` 读取。 */
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
