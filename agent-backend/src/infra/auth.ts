import { jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import { authContext } from '../domain/current-user.js';

export const AUTH_COOKIE_NAME = 'optagent_auth';
const AUTH_ISSUER = 'optagent-admin';
const AUTH_AUDIENCE = 'optagent-agent';

export const AUTH_ALLOWLIST: readonly string[] = Object.freeze([
  '/api/monitor/health',
  '/api/monitor/agents',
  '/api/builtin-tools',
  '/api/mcp-call-stats',
  '/api/files/raw',
  '/api/files/put',
]);

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
