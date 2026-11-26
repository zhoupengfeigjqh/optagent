import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { loadConfig } from '../../src/config';
import { PRODUCED_DIR, userDataDir } from '../../src/domain/dirs';
import { buildServer } from '../../src/server';

const root = mkdtempSync(path.join(tmpdir(), 'optagent-produced-read-'));
const userId = 'admin';
const AGENT = 'alpha';
const SCENARIO = { scenario: '产出读入口', data_prep_dirs: ['生产计划'] };
const NAME = 'th_1_总BOM_bom_1_ab.xlsx';
/** 内容不必是合法 xlsx：本层只验"能不能读出来"，不看格式（预览会明确 400） */
const BYTES = Buffer.from('PK\u0003\u0004fake-xlsx-bytes', 'latin1');
const NAME_OK = 'th_1_总BOM_bom_2_cd.xlsx';
const BYTES_OK = XLSX.write(
  (() => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['物料', '数量'],
        ['A', 10],
      ]),
      '物料',
    );
    return wb;
  })(),
  { type: 'buffer', bookType: 'xlsx' },
) as Buffer;

let app: FastifyInstance;

beforeAll(async () => {
  const dir = path.join(root, 'users', userId, 'agents', AGENT);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SOUL.md'), `你是 ${AGENT}。\n`, 'utf8');
  writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
  writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');
  writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify(SCENARIO), 'utf8');

  const produced = path.join(userDataDir(root, userId, AGENT), PRODUCED_DIR);
  mkdirSync(produced, { recursive: true });
  writeFileSync(path.join(produced, NAME), BYTES);
  writeFileSync(path.join(produced, NAME_OK), BYTES_OK);

  const configPath = path.join(root, 'config.yaml');
  writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8');
  const config = loadConfig({
    env: { PUBLIC_BASE_URL: 'http://backend:3000', OPT_AGENT_ROOT: root },
    configPath,
  });
  app = await buildServer({ config });
  const selected = await app.inject({ method: 'POST', url: `/api/agents/${AGENT}/select` });
  expect(selected.statusCode).toBe(200);
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

function q(dir: string, filename: string): string {
  return `dir=${encodeURIComponent(dir)}&filename=${encodeURIComponent(filename)}`;
}

describe('后台产出目录的读入口', () => {
  it('download 可读到产出：octet-stream + 附件名', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/files/download?${q(PRODUCED_DIR, NAME)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(String(res.headers['content-disposition'])).toContain('attachment');
    expect(res.rawPayload.equals(BYTES)).toBe(true);
  });

  it('preview 对可解析的 `.xlsx` 返回结构化 JSON（2026-11-17：前端零解析）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/files/preview?${q(PRODUCED_DIR, NAME_OK)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(String(res.headers['content-disposition'])).toContain('inline');

    const body = res.json() as {
      sheets: Array<{ name: string; rows: string[][]; numericCols: number[] }>;
    };
    expect(body.sheets.map((sheet) => sheet.name)).toEqual(['物料']);
    expect(body.sheets[0]?.rows).toEqual([
      ['物料', '数量'],
      ['A', '10'],
    ]);
    expect(body.sheets[0]?.numericCols).toEqual([1]);
  });

  it('preview 对**无法解析**的 `.xlsx` 明确 400（不静默回退成附件）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/files/preview?${q(PRODUCED_DIR, NAME)}`,
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('读不到不存在的文件：404（不是把目录参数当越权）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/files/download?${q(PRODUCED_DIR, '没有这个.xlsx')}`,
    });

    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('FILE_NOT_FOUND');
  });

  it('list 仍拒绝该二级目录（列目录口径不变）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/files/list?dir=${encodeURIComponent(PRODUCED_DIR)}`,
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('upload 仍拒绝写入产出目录（否则会打乱 .meta.json 索引）', async () => {
    const boundary = '----vitest-produced-boundary';
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="dir"\r\n\r\n${PRODUCED_DIR}\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      Buffer.from('PK\u0003\u0004', 'latin1'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      payload: body,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });

    expect(res.statusCode === 400 || res.statusCode === 403).toBe(true);
    expect(['VALIDATION_FAILED', 'UPLOAD_DIR_FORBIDDEN']).toContain(
      (res.json() as { error: { code: string } }).error.code,
    );
  });

  it('delete 仍拒绝产出目录（删除会留下悬空的产出记录）', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/files?${q(PRODUCED_DIR, NAME)}` });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('其它二级目录不受影响：仍然 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/files/download?${q('临时空间/别处', NAME)}`,
    });

    expect(res.statusCode).toBe(400);
  });
});
