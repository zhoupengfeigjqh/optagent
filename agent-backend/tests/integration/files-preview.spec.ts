/**
 * 内联预览集成测试（2026-10-20）：`.html` 可点开渲染，且**必须沙箱化**。
 *
 * 覆盖口径：
 * - 上传到共享空间 / 临时空间的 `.html` 可被 `GET /api/files/preview` 内联返回
 *   （`text/html` + `inline`），并带 `CSP: sandbox` 与 `nosniff`；
 * - 非 HTML 的内联类型（`.txt`）**不加**这两条头（避免误伤既有行为）；
 * - `/api/files/raw` 签名直链同样沙箱化——它可被浏览器直接打开，不加就是同源 XSS；
 * - 未配置白名单的数据准备目录仍按平台默认拒绝 `.html`（存量行为不变）。
 *
 * 为什么单独一个文件：`files-scenario.spec.ts` 已远超 500 行（存量），本次改动不往里堆
 * （宪章原则二）。fixture 与 `files-naming.spec.ts` 同款最小化。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config';
import { agentScopedPath, signRef } from '../../src/infra/file-sign';
import { buildServer } from '../../src/server';

const root = mkdtempSync(path.join(tmpdir(), 'optagent-preview-'));
const userId = 'admin';
const AGENT = 'alpha';
/** 带一个数据准备二级目录（未配置可上传类型 ⇒ 平台默认 `.csv` + `.xlsx`） */
const SCENARIO = { scenario: '预览', data_prep_dirs: ['生产计划'] };

let app: FastifyInstance;
let secret: string;

beforeAll(async () => {
  const dir = path.join(root, 'users', userId, 'agents', AGENT);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SOUL.md'), `你是 ${AGENT}。\n`, 'utf8');
  writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
  writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');
  writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify(SCENARIO), 'utf8');

  const configPath = path.join(root, 'config.yaml');
  writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8');
  const config = loadConfig({
    env: { PUBLIC_BASE_URL: 'http://backend:3000', OPT_AGENT_ROOT: root },
    configPath,
  });
  secret = config.fileSignSecret;
  app = await buildServer({ config });

  const selected = await app.inject({ method: 'POST', url: `/api/agents/${AGENT}/select` });
  expect(selected.statusCode).toBe(200);
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

/** 手工 multipart（`dir` 字段在前，命中早验路径）；与 `files-naming.spec.ts` 同款 */
function multipart(dir: string, filename: string, content: string, contentType: string) {
  const boundary = '----vitest-preview-boundary';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="dir"\r\n\r\n${dir}\r\n`),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    Buffer.from(content, 'utf8'),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

function uploadHtml(dir: string, filename: string) {
  const { body, headers } = multipart(dir, filename, '<h1>看板</h1>', 'text/html');
  return app.inject({ method: 'POST', url: '/api/files/upload', payload: body, headers });
}

function preview(dir: string, filename: string) {
  return app.inject({
    method: 'GET',
    url: `/api/files/preview?dir=${encodeURIComponent(dir)}&filename=${encodeURIComponent(filename)}`,
  });
}

/** 铸造与运行环境同款的签名直链（`/api/files/raw`） */
function signedRawUrl(relPath: string): string {
  const scoped = agentScopedPath(AGENT, relPath);
  const exp = Date.now() + 60_000;
  const sig = signRef(secret, userId, scoped, exp);
  const q = new URLSearchParams({ u: userId, p: scoped, exp: String(exp), sig });
  return `/api/files/raw?${q.toString()}`;
}

describe('`.html` 内联预览（2026-10-20）', () => {
  it('共享空间：`preview` 以 `text/html` 内联返回，且带 CSP sandbox + nosniff', async () => {
    expect((await uploadHtml('共享空间', '看板.html')).statusCode).toBe(201);

    const res = await preview('共享空间', '看板.html');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(String(res.headers['content-disposition'])).toContain('inline');
    expect(res.headers['content-security-policy']).toBe('sandbox');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body).toContain('<h1>看板</h1>');
  });

  it('临时空间：同样可内联（空间级白名单已放开 `.html`）', async () => {
    expect((await uploadHtml('临时空间', '报表.html')).statusCode).toBe(201);

    const res = await preview('临时空间', '报表.html');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['content-security-policy']).toBe('sandbox');
  });

  it('签名直链 `raw` 也沙箱化（可被浏览器直接打开，不加就是同源 XSS）', async () => {
    const res = await app.inject({ method: 'GET', url: signedRawUrl('共享空间/看板.html') });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['content-security-policy']).toBe('sandbox');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('非 HTML 的内联类型不加沙箱头（`.txt` 行为不变）', async () => {
    const { body, headers } = multipart('共享空间', '说明.txt', '纯文本', 'text/plain');
    expect(
      (await app.inject({ method: 'POST', url: '/api/files/upload', payload: body, headers }))
        .statusCode,
    ).toBe(201);

    const res = await preview('共享空间', '说明.txt');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBeUndefined();
  });

  it('未配置白名单的数据准备目录仍按平台默认拒绝 `.html`（存量行为不变）', async () => {
    const res = await uploadHtml('数据准备/生产计划', '看板.html');
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });
});
