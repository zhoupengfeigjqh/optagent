/**
 * 单元测试：签名直链（读方向 / 写方向）
 *
 * 守住的核心理由（契约 `runtime-api-delta.md` §10.6 不变式 3）：
 * 读写 payload **形状隔离**——段数不同（3 vs 4）⇒ 两种 payload 不可能碰撞
 * ⇒ 一张"读某文件"的签名**不能被用于写**（否则权限被放大）；
 * 而读方向格式一字未改 ⇒ **存量签名 URL 零失效**。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PUT_TTL_MS,
  mintPutUrl,
  mintSignedUrl,
  signPutRef,
  signRef,
  verifyPutRef,
  verifyRef,
} from '../../src/infra/file-sign.js';

const SECRET = 'test-secret-0123456789';
const NOW = 1_700_000_000_000;
const PRODUCED_DIR = '临时空间/后台产出';

describe('读方向（既有行为，本次 MUST NOT 变化）', () => {
  it('签名 → 验签通过', () => {
    const sig = signRef(SECRET, 'admin', '共享空间/a.xlsx', NOW + 1000);
    expect(verifyRef(SECRET, 'admin', '共享空间/a.xlsx', NOW + 1000, sig, NOW)).toBe(true);
  });

  it('铸造的 URL 仍是 `/api/files/raw` 三段形态（不含写方向参数）', () => {
    const url = mintSignedUrl('http://backend:3000', SECRET, 'admin', '共享空间/a.xlsx', 1000, NOW);
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/api/files/raw');
    expect([...parsed.searchParams.keys()].sort()).toEqual(['exp', 'p', 'sig', 'u']);
  });
});

describe('写方向', () => {
  it('签名 → 验签通过', () => {
    const sig = signPutRef(SECRET, 'admin', PRODUCED_DIR, NOW + 1000);
    expect(verifyPutRef(SECRET, 'admin', PRODUCED_DIR, NOW + 1000, sig, NOW)).toBe(true);
  });

  it('过期即失败', () => {
    const sig = signPutRef(SECRET, 'admin', PRODUCED_DIR, NOW - 1);
    expect(verifyPutRef(SECRET, 'admin', PRODUCED_DIR, NOW - 1, sig, NOW)).toBe(false);
  });

  it('目录被篡改 → 失败（目录在签名内，决定"写到哪个子目录"）', () => {
    const sig = signPutRef(SECRET, 'admin', PRODUCED_DIR, NOW + 1000);
    expect(verifyPutRef(SECRET, 'admin', '共享空间', NOW + 1000, sig, NOW)).toBe(false);
  });

  it('用户被篡改 → 失败（用户决定"写到谁的空间"）', () => {
    const sig = signPutRef(SECRET, 'admin', PRODUCED_DIR, NOW + 1000);
    expect(verifyPutRef(SECRET, 'zpf', PRODUCED_DIR, NOW + 1000, sig, NOW)).toBe(false);
  });

  it('畸形签名（长度/字符集不符）直接拒绝', () => {
    for (const bad of ['', 'zzzz', 'a'.repeat(63), 'A'.repeat(64)]) {
      expect(verifyPutRef(SECRET, 'admin', PRODUCED_DIR, NOW + 1000, bad, NOW)).toBe(false);
    }
  });
});

describe('读写形状隔离（§10.6 不变式 3）', () => {
  it('读签名不能用于写', () => {
    const readSig = signRef(SECRET, 'admin', PRODUCED_DIR, NOW + 1000);
    expect(verifyPutRef(SECRET, 'admin', PRODUCED_DIR, NOW + 1000, readSig, NOW)).toBe(false);
  });

  it('写签名不能用于读', () => {
    const putSig = signPutRef(SECRET, 'admin', '共享空间/a.xlsx', NOW + 1000);
    expect(verifyRef(SECRET, 'admin', '共享空间/a.xlsx', NOW + 1000, putSig, NOW)).toBe(false);
  });

  it('同样入参下两种签名值不同（编码了不同 payload）', () => {
    const readSig = signRef(SECRET, 'admin', PRODUCED_DIR, NOW + 1000);
    const putSig = signPutRef(SECRET, 'admin', PRODUCED_DIR, NOW + 1000);
    expect(putSig).not.toBe(readSig);
  });
});

describe('mintPutUrl', () => {
  it('缺省不带归属提示参数（只有 u/d/exp/sig）', () => {
    const url = new URL(
      mintPutUrl('http://backend:3000', SECRET, 'admin', PRODUCED_DIR, {}, 1000, NOW),
    );
    expect(url.pathname).toBe('/api/files/put');
    expect([...url.searchParams.keys()].sort()).toEqual(['d', 'exp', 'sig', 'u']);
  });

  it('带上 sid / call_id / tool：仅作归属提示，不参与验签', () => {
    const url = new URL(
      mintPutUrl(
        'http://backend:3000',
        SECRET,
        'admin',
        PRODUCED_DIR,
        { sid: 'th_9f8e', callId: 'call_c1', tool: 'ocr__submit_ocr' },
        1000,
        NOW,
      ),
    );
    expect(url.searchParams.get('sid')).toBe('th_9f8e');
    expect(url.searchParams.get('call_id')).toBe('call_c1');
    expect(url.searchParams.get('tool')).toBe('ocr__submit_ocr');
    // 验签只由 u/d/exp 决定——提示参数篡改不影响通过（也不构成越权，见契约 §10.3）
    const sig = url.searchParams.get('sig')!;
    const exp = Number(url.searchParams.get('exp'));
    expect(verifyPutRef(SECRET, 'admin', PRODUCED_DIR, exp, sig, NOW)).toBe(true);
  });

  it('非 ASCII 目录（中文）编码后能原样解回', () => {
    const url = new URL(
      mintPutUrl('http://backend:3000/', SECRET, 'admin', PRODUCED_DIR, {}, 1000, NOW),
    );
    expect(url.searchParams.get('d')).toBe(PRODUCED_DIR);
  });

  it('默认时效为写方向 TTL（须 ≥ 任务最长时长）', () => {
    const url = new URL(
      mintPutUrl('http://backend:3000', SECRET, 'admin', PRODUCED_DIR, {}, undefined, NOW),
    );
    expect(Number(url.searchParams.get('exp'))).toBe(NOW + DEFAULT_PUT_TTL_MS);
  });
});
