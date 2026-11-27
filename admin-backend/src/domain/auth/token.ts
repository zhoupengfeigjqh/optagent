import { SignJWT, jwtVerify } from 'jose';

export const AUTH_COOKIE_NAME = 'optagent_auth';
export const AUTH_ISSUER = 'optagent-admin';
export const AUTH_AUDIENCE = 'optagent-agent';

export interface SessionClaims {
  userId: string;
  sessionId: string;
}

function keyOf(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

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

export function cookieHeader(token: string, maxAgeSeconds: number): string {
  return `${AUTH_COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearCookieHeader(): string {
  return `${AUTH_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

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
