/**
 * 签名直链（MCP 远程/跨容器取文件的通用设施）。
 *
 * 背景：MCP 服务（如 OCR）拿不到 backend 的磁盘，LLM 只传相对路径；
 * backend 校验后铸造一次性签名 URL 发给 MCP 服务，服务凭 URL 回源下载。
 *
 * 设计：
 * - HMAC-SHA256 绑定 (userId, relPath, exp)：任一字段被篡改验签即失败，URL 即凭证
 * - 无状态验签（不查库）；时效默认 24h（远程服务可能跨时段回源）
 * - relPath 为 user-data 相对路径（posix 分隔），路径安全由 FileAccess 在铸造/下载两侧各把一关
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function payloadOf(userId: string, relPath: string, exp: number): string {
  return `${userId}\n${relPath}\n${exp}`;
}

export function signRef(secret: string, userId: string, relPath: string, exp: number): string {
  return createHmac('sha256', secret).update(payloadOf(userId, relPath, exp)).digest('hex');
}

/** 验签 + 时效校验（now 可注入便于测试） */
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

/** 铸造签名直链：{baseUrl}/api/files/raw?u=&p=&exp=&sig= */
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
