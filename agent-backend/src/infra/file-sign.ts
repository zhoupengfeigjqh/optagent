import { createHmac, timingSafeEqual } from 'node:crypto';

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function agentScopedPath(agentName: string, relPath: string): string {
  return `${agentName}/${relPath}`;
}

export function splitAgentScopedPath(
  value: string,
): { agentName: string; relPath: string } | undefined {
  if (value.includes('\\')) return undefined;
  const idx = value.indexOf('/');
  if (idx <= 0) return undefined;
  const agentName = value.slice(0, idx);
  const relPath = value.slice(idx + 1);
  if (relPath === '' || agentName === '.' || agentName === '..') return undefined;
  return { agentName, relPath };
}

function payloadOf(userId: string, relPath: string, exp: number): string {
  return `${userId}\n${relPath}\n${exp}`;
}

export function signRef(secret: string, userId: string, relPath: string, exp: number): string {
  return createHmac('sha256', secret)
    .update(payloadOf(userId, relPath, exp))
    .digest('hex');
}

export function verifyRef(
  secret: string,
  userId: string,
  relPath: string,
  exp: number,
  sig: string,
  now: number = Date.now(),
): boolean {
  if (!Number.isFinite(exp) || exp < now) return false;
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  const expected = Buffer.from(signRef(secret, userId, relPath, exp), 'utf8');
  const actual = Buffer.from(sig, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function mintSignedUrl(
  baseUrl: string,
  secret: string,
  userId: string,
  relPath: string,
  ttlMs: number = DEFAULT_TTL_MS,
  now: number = Date.now(),
): string {
  const exp = now + ttlMs;
  const sig = signRef(secret, userId, relPath, exp);
  const q = new URLSearchParams({ u: userId, p: relPath, exp: String(exp), sig });
  return `${baseUrl.replace(/\/+$/, '')}/api/files/raw?${q.toString()}`;
}


export const DEFAULT_PUT_TTL_MS = 12 * 60 * 60 * 1000;

function putPayloadOf(userId: string, dir: string, exp: number): string {
  return `put\n${userId}\n${dir}\n${exp}`;
}

export function signPutRef(secret: string, userId: string, dir: string, exp: number): string {
  return createHmac('sha256', secret)
    .update(putPayloadOf(userId, dir, exp))
    .digest('hex');
}

export function verifyPutRef(
  secret: string,
  userId: string,
  dir: string,
  exp: number,
  sig: string,
  now: number = Date.now(),
): boolean {
  if (!Number.isFinite(exp) || exp < now) return false;
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  const expected = Buffer.from(signPutRef(secret, userId, dir, exp), 'utf8');
  const actual = Buffer.from(sig, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export interface PutUrlHints {
  sid?: string;
  callId?: string;
  tool?: string;
}

export function mintPutUrl(
  baseUrl: string,
  secret: string,
  userId: string,
  dir: string,
  hints: PutUrlHints = {},
  ttlMs: number = DEFAULT_PUT_TTL_MS,
  now: number = Date.now(),
): string {
  const exp = now + ttlMs;
  const sig = signPutRef(secret, userId, dir, exp);
  const params: Record<string, string> = {
    u: userId,
    d: dir,
    exp: String(exp),
    sig,
    t: String(now),
  };
  if (hints.sid) params.sid = hints.sid;
  if (hints.callId) params.call_id = hints.callId;
  if (hints.tool) params.tool = hints.tool;
  const q = new URLSearchParams(params);
  return `${baseUrl.replace(/\/+$/, '')}/api/files/put?${q.toString()}`;
}
