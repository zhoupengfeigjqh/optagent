/**
 * 002 US6 文件预览集成测试（T025）：
 * tmp 目录上传放开（201）；preview 内联 Content-Disposition、按扩展名映射 Content-Type；
 * .xlsx 回退附件下载；文件不存在 404；非法目录/穿越参数 400/403。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { buildServer } from '../../src/server';
import { userDataDir } from '../../src/domain/dirs';

type AppInstance = Awaited<ReturnType<typeof buildServer>>;

async function upload(
  app: AppInstance,
  dir: string,
  filename: string,
  content: string | Buffer,
): Promise<{ statusCode: number; body: { filename?: string } }> {
  const boundary = '----vitest-boundary';
  const buf = typeof content === 'string' ? Buffer.from(content) : content;
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="dir"\r\n\r\n${dir}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
    ),
    buf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: 'POST',
    url: '/api/files/upload',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  });
  return { statusCode: res.statusCode, body: res.json() };
}

describe('文件预览与 tmp 上传（002 US6 / T025）', () => {
  let root: string;
  let app: AppInstance;
  let dataDir: string;

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-preview-'));
    const agentDir = path.join(root, '.opt-agent', 'users', 'admin', 'agents', 'demo');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(path.join(agentDir, 'SOUL.md'), '你是 demo。');
    writeFileSync(path.join(agentDir, 'TOOL.json'), JSON.stringify({ enabled: [] }));
    writeFileSync(path.join(agentDir, 'MCP.json'), JSON.stringify({ servers: [] }));
    const configPath = path.join(root, 'config.yaml');
    writeFileSync(configPath, 'models:\n  - model: m1\n');
    const config = loadConfig({
      env: { DEEPSEEK_API_KEY: 'sk-x', OPT_AGENT_ROOT: path.join(root, '.opt-agent') },
      configPath,
    });
    app = await buildServer({ config });
    dataDir = userDataDir(config.optAgentRoot, 'admin');
    mkdirSync(path.join(dataDir, '生产计划'), { recursive: true });
    mkdirSync(path.join(dataDir, 'tmp'), { recursive: true });
  });
  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('tmp 目录上传 → 201', async () => {
    const res = await upload(app, 'tmp', 'note.txt', '临时内容');
    expect(res.statusCode).toBe(201);
    expect(res.body.filename).toMatch(/^note_\d{8}_\d{6}\.txt$/);
  });

  it('.txt 预览 → inline + text/plain', async () => {
    writeFileSync(path.join(dataDir, 'tmp', 'a.txt'), '预览内容');
    const res = await app.inject({ method: 'GET', url: '/api/files/preview?dir=tmp&filename=a.txt' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^inline;/);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toBe('预览内容');
  });

  it('.csv/.json/.pdf 按扩展名映射 Content-Type', async () => {
    writeFileSync(path.join(dataDir, '生产计划', 'a.csv'), 'x,y');
    writeFileSync(path.join(dataDir, 'tmp', 'a.json'), '{}');
    writeFileSync(path.join(dataDir, 'tmp', 'a.pdf'), '%PDF-1.4');
    const csv = await app.inject({ method: 'GET', url: '/api/files/preview?dir=生产计划&filename=a.csv' });
    expect(csv.headers['content-type']).toContain('text/csv');
    const json = await app.inject({ method: 'GET', url: '/api/files/preview?dir=tmp&filename=a.json' });
    expect(json.headers['content-type']).toContain('application/json');
    const pdf = await app.inject({ method: 'GET', url: '/api/files/preview?dir=tmp&filename=a.pdf' });
    expect(pdf.headers['content-type']).toContain('application/pdf');
  });

  it('.xlsx 预览 → 回退附件下载（attachment + octet-stream）', async () => {
    writeFileSync(path.join(dataDir, '生产计划', 'a.xlsx'), 'PK fake');
    const res = await app.inject({
      method: 'GET',
      url: '/api/files/preview?dir=生产计划&filename=a.xlsx',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['content-type']).toContain('application/octet-stream');
  });

  it('文件不存在 → 404 FILE_NOT_FOUND', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/files/preview?dir=tmp&filename=nope.txt' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('FILE_NOT_FOUND');
  });

  it('目录非白名单 → 403；路径穿越 → 400', async () => {
    const forbidden = await app.inject({ method: 'GET', url: '/api/files/preview?dir=secret&filename=a.txt' });
    expect(forbidden.statusCode).toBe(403);
    const traversal = await app.inject({
      method: 'GET',
      url: `/api/files/preview?dir=${encodeURIComponent('..')}&filename=a.txt`,
    });
    expect(traversal.statusCode).toBe(400);
  });
});
