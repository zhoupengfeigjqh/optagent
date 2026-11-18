/**
 * 登录凭据（JWT，`contracts/auth-api.md` §1，`research.md` D2）。
 *
 * - 标准 JWT（`jose`，HS256）：后续替换 Keycloak/OIDC 时其签发同为 JWT，换签发方即可。
 * - claims：`sub`（用户标识）、`jti`（会话标识，单会话判定）、`iss`、`aud`、`iat`、`exp`。
 * - Cookie 契约单处定义（名/属性），三侧共用同一常量来源。
 */
import { SignJWT, jwtVerify } from 'jose';

export const AUTH_COOKIE_NAME = 'optagent_auth';
export const AUTH_ISSUER = 'optagent-admin';
export const AUTH_AUDIENCE = 'optagent-agent';

export interface SessionClaims {
  userId: string;
  /** 会话标识（JWT `jti`），用于单会话判定 */
  sessionId: string;
}

function keyOf(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** 签发登录凭据。`ttlSeconds` 决定 `exp`。 */
export async function signSession(
  userId: string,
  sessionId: string,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return new SignJWT({ jti: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(AUTH_ISSUER)
    .setAudience(AUTH_AUDIENCE)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + ttlSeconds)
    .sign(keyOf(secret));
}

/** 验签并解析身份；无效/过期/密钥不符/claims 缺失一律抛错（调用方转 401）。 */
export async function verifySession(token: string, secret: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, keyOf(secret), {
    issuer: AUTH_ISSUER,
    audience: AUTH_AUDIENCE,
  });
  if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
    throw new Error('登录凭据缺少身份信息');
  }
  return { userId: payload.sub, sessionId: payload.jti };
}

/** 下发凭据的 `Set-Cookie` 值（HttpOnly/Path=/SameSite=Lax；内网明文不设 Secure）。 */
export function cookieHeader(token: string, maxAgeSeconds: number): string {
  return `${AUTH_COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

/** 清除凭据的 `Set-Cookie` 值。 */
export function clearCookieHeader(): string {
  return `${AUTH_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

/** 从 `Cookie` 头解析指定名（找不到返回 `null`）。 */
export function readCookie(header: string | undefined, name: string): string | null {
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
