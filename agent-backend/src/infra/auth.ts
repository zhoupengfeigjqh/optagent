/**
 * 运行侧鉴权钩子（`contracts/auth-api.md` §3，`research.md` D6/D13）。
 *
 * 职责单一：验签 Cookie → 会话内省（单会话）→ 注入请求级身份（`AsyncLocalStorage`）。
 * **不含**用户记录、密码、业务判断（解耦红线）；只认 JWT 契约与内省端点契约。
 *
 * 边界：
 * - 白名单（平台级只读投影）放行，不注入身份；
 * - 未配置 `AUTH_SECRET` → 直接放行（legacy 单用户回退，可回滚）；
 * - 验签失败/缺失 → 401 `UNAUTHENTICATED`；
 * - 会话已被新登录取代 → 401 `SESSION_REVOKED`；
 * - 内省不可达 → 放行 + 告警（降级，`原则九`）。
 */
import { jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import { authContext } from '../domain/current-user.js';

export const AUTH_COOKIE_NAME = 'optagent_auth';
const AUTH_ISSUER = 'optagent-admin';
const AUTH_AUDIENCE = 'optagent-agent';

/**
 * 免鉴权放行清单（不注入身份）。
 *
 * 两类：
 * - 平台级只读投影（监控/目录）；
 * - **签名直链**（`/api/files/raw`、`/api/files/put`）：URL 本身就是凭证
 *   （HMAC 绑定 u/p/exp，`infra/file-sign.ts`），调用方是 MCP 服务容器而非浏览器，
 *   **不会带 Cookie**。放行不降低安全性——签名校验在各自的 handler 里独立完成，
 *   且它在钩子之前根本到不了。
 *
 * 2026-11-18 故障：`fresh_order_parse` 回源下载商品数据被拒成 401 `UNAUTHENTICATED`，
 * 原因就是这两条不在清单里。**新增签名直链类端点时 MUST 同步加进来。**
 */
export const AUTH_ALLOWLIST: readonly string[] = Object.freeze([
  '/api/monitor/health',
  '/api/monitor/agents',
  '/api/builtin-tools',
  '/api/mcp-call-stats',
  '/api/files/raw',
  '/api/files/put',
]);

/** 鉴权错误（`server.ts` 的错误处理器按 `code` 映射 401）。 */
export class AuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

export interface AuthHookOptions {
  /** 验签密钥；缺省 = 鉴权未启用（放行回退 legacy 单用户） */
  secret?: string;
  /** 会话内省；缺省 = 不做单会话校验 */
  introspect?: (userId: string, sessionId: string) => Promise<boolean>;
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

/**
 * 构造 Fastify `onRequest` 鉴权钩子（回调式）。
 *
 * 身份注入用 `authContext.run(store, done)`：`done()` 在 ALS 上下文中触发后续
 * 生命周期，handler 内的 `getCurrentUser()` 因此能读到该身份（与 `@fastify/request-context`
 * 的做法一致；`enterWith` 在 async 钩子里无法传播到后续 handler）。
 */
export function createAuthHook(options: AuthHookOptions) {
  const key = options.secret ? new TextEncoder().encode(options.secret) : null;

  return function authHook(
    req: FastifyRequest,
    _reply: FastifyReply,
    done: HookHandlerDoneFunction,
  ): void {
    if (!key) {
      done(); // 鉴权未启用：legacy 单用户回退
      return;
    }

    const pathOnly = req.url.split('?')[0] ?? '';
    if (AUTH_ALLOWLIST.includes(pathOnly)) {
      done();
      return;
    }

    void (async () => {
      try {
        const token = readCookie(req.headers.cookie, AUTH_COOKIE_NAME);
        if (!token) throw new AuthError('UNAUTHENTICATED', '未登录或登录已失效');

        let userId: string;
        let sessionId: string;
        try {
          const { payload } = await jwtVerify(token, key, {
            issuer: AUTH_ISSUER,
            audience: AUTH_AUDIENCE,
          });
          if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
            throw new Error('登录凭据缺少身份信息');
          }
          userId = payload.sub;
          sessionId = payload.jti;
        } catch {
          throw new AuthError('UNAUTHENTICATED', '未登录或登录已失效');
        }

        if (options.introspect) {
          try {
            const valid = await options.introspect(userId, sessionId);
            if (!valid) throw new AuthError('SESSION_REVOKED', '已在其它设备登录');
          } catch (err) {
            if (err instanceof AuthError) throw err;
            req.log.warn(
              { event: 'auth.introspect.unreachable', user_id: userId },
              '会话内省不可达，降级放行（单会话保证临时放宽）',
            );
          }
        }

        authContext.run({ userId }, () => done());
      } catch (err) {
        done(err as Error);
      }
    })();
  };
}

export interface IntrospectorOptions {
  timeoutMs?: number;
  /** 结果缓存时长（毫秒）：把稳态额外耗时摊薄（`SC-007`） */
  cacheTtlMs?: number;
}

/**
 * 会话内省客户端：调平台 `GET /api/admin/auth/session/valid`。
 * 带短 TTL 缓存，减少每请求网络往返。
 */
export function createIntrospector(
  baseUrl: string,
  options: IntrospectorOptions = {},
): (userId: string, sessionId: string) => Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const cacheTtlMs = options.cacheTtlMs ?? 1500;
  const cache = new Map<string, { valid: boolean; at: number }>();
  const base = baseUrl.replace(/\/+$/, '');

  return async function introspect(userId: string, sessionId: string): Promise<boolean> {
    const key = `${userId}\u0000${sessionId}`;
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && now - hit.at < cacheTtlMs) return hit.valid;

    const url = `${base}/api/admin/auth/session/valid?user_id=${encodeURIComponent(userId)}&session_id=${encodeURIComponent(sessionId)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`会话内省失败：HTTP ${res.status}`);
    const body = (await res.json()) as { valid?: unknown };
    const valid = body.valid === true;
    if (cache.size > 1000) cache.clear();
    cache.set(key, { valid, at: now });
    return valid;
  };
}
