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

/* ------------------------------------------------------------------ *
 * 写方向（R11：MCP 异步工具的后台产出回写）
 *
 * 与读方向**共用密钥与验签设施**，但 payload 形状刻意不同：
 * 读三段 `{userId}\n{relPath}\n{exp}`（**保持不变**，存量签名 URL 全部继续有效），
 * 写四段 `put\n{userId}\n{dir}\n{exp}`。段数不同 ⇒ 两种 payload 不可能碰撞 ⇒
 * 一张"读某文件"的签名**不能被用于写**（否则权限被放大）。
 * ------------------------------------------------------------------ */

/** 写方向默认时效：须 ≥ 任务最长时长（算法任务可能数十分钟，见契约 §10.3） */
export const DEFAULT_PUT_TTL_MS = DEFAULT_TTL_MS;

function putPayloadOf(userId: string, dir: string, exp: number): string {
  return `put\n${userId}\n${dir}\n${exp}`;
}

export function signPutRef(secret: string, userId: string, dir: string, exp: number): string {
  return createHmac('sha256', secret).update(putPayloadOf(userId, dir, exp)).digest('hex');
}

/** 验签 + 时效校验（now 可注入便于测试） */
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

/**
 * 归属提示参数（**不参与验签**，见契约 §10.3）。
 *
 * 决定"写到哪个用户的哪个目录"的字段（`u`/`d`/`exp`）全在签名内；
 * 只决定"这条产出怎么归档"的字段在签名外——与 `filename` 同一处置：
 * 篡改它们只影响元数据与文件名前缀，**不构成越权**。
 */
export interface PutUrlHints {
  /** 发起该任务的会话（= thread_id）：决定落盘文件名的 `{prefix}`（缺失回退 uid） */
  sid?: string;
  /** 关联那次"已受理"的工具调用（前端挂载点） */
  callId?: string;
  /** 运行环境侧工具全名（含 `{server}__` 前缀） */
  tool?: string;
}

/** 铸造写方向直链：{baseUrl}/api/files/put?u=&d=&exp=&sig=[&sid=&call_id=&tool=] */
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
  const params: Record<string, string> = { u: userId, d: dir, exp: String(exp), sig };
  if (hints.sid) params.sid = hints.sid;
  if (hints.callId) params.call_id = hints.callId;
  if (hints.tool) params.tool = hints.tool;
  const q = new URLSearchParams(params);
  return `${baseUrl.replace(/\/+$/, '')}/api/files/put?${q.toString()}`;
}
