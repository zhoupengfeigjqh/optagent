import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config';
import { buildServer } from '../../src/server';

const root = mkdtempSync(path.join(tmpdir(), 'optagent-files-'));
const userId = 'admin';

const AGENT_SCENARIOS: Record<string, unknown | null> = {
  alpha: { scenario: '全量', data_prep_dirs: ['生产计划', '产线电价'] },
  beta: { scenario: '精简', data_prep_dirs: ['产线电价'] },
  gamma: null,
  theta: { scenario: '含预定义目录', data_prep_dirs: ['算法规则', '生产计划'] },
  delta: {
    scenario: '带约束',
    data_prep_dirs: ['生产计划'],
    data_prep_fields: {
      生产计划: [
        { name: '产线编号', type: 'string', required: true },
        { name: '计划量', type: 'integer', required: false },
      ],
    },
  },
  epsilon: {
    scenario: '带类型',
    data_prep_dirs: ['生产计划', '产线电价'],
    data_prep_uploads: {
      生产计划: ['.csv', '.xlsx', '.txt', '.json'],
      产线电价: ['.csv'],
    },
  },
  zeta: {
    scenario: '带约束与类型',
    data_prep_dirs: ['生产计划'],
    data_prep_fields: {
      生产计划: [
        { name: '产线编号', type: 'string', required: true },
        { name: '计划量', type: 'integer', required: false },
      ],
    },
    data_prep_uploads: {
      生产计划: ['.csv', '.xlsx', '.txt', '.pdf', '.json', '.zip'],
    },
  },
  iota: { scenario: '屏蔽预定义', data_prep_dirs: ['生产计划'] },
  kappa: { scenario: '全部屏蔽', data_prep_dirs: [] },
  eta: {
    scenario: '带约束与 xls',
    data_prep_dirs: ['生产计划'],
    data_prep_fields: {
      生产计划: [
        { name: '产线编号', type: 'string', required: true },
        { name: '计划量', type: 'integer', required: false },
      ],
    },
    data_prep_uploads: {
      生产计划: ['.xls', '.csv'],
    },
  },
};

function writeAgent(name: string, scenario: unknown | null): void {
  const dir = path.join(root, 'users', userId, 'agents', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SOUL.md'), `你是 ${name}。\n`, 'utf8');
  writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
  writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');
  if (scenario !== null) {
    writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify(scenario), 'utf8');
  }
}

let app: FastifyInstance;

beforeAll(async () => {
  for (const [name, scenario] of Object.entries(AGENT_SCENARIOS)) writeAgent(name, scenario);

  const configPath = path.join(root, 'config.yaml');
  writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8');

  // PUBLIC_BASE_URL 为必填项；OPT_AGENT_ROOT 指向本次临时数据根
  const config = loadConfig({
    env: { PUBLIC_BASE_URL: 'http://backend:3000', OPT_AGENT_ROOT: root },
    configPath,
  });
  app = await buildServer({ config });
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

async function select(name: string): Promise<void> {
  const res = await app.inject({ method: 'POST', url: `/api/agents/${name}/select` });
  expect(res.statusCode).toBe(200);
}

async function deselect(): Promise<void> {
  await app.inject({ method: 'POST', url: '/api/agents/current/exit' });
}

function listUrl(dir: string): string {
  return `/api/files/list?dir=${encodeURIComponent(dir)}`;
}

function prepDirs(body: unknown): string[] {
  const spaces = (body as { spaces: Array<{ name: string; dirs: Array<{ dir: string }> }> }).spaces;
  const prep = spaces.find((space) => space.name === '数据准备');
  return (prep?.dirs ?? []).map((dir) => dir.dir);
}

describe('文件空间视角＝当前选中数字人', () => {
  it('未选中数字人时 workspace → 409 AGENT_NOT_SELECTED', async () => {
    await deselect();

    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'AGENT_NOT_SELECTED' } });
  });

  it('未选中数字人时列目录 → 409 AGENT_NOT_SELECTED', async () => {
    await deselect();

    const res = await app.inject({ method: 'GET', url: listUrl('临时空间') });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'AGENT_NOT_SELECTED' } });
  });

  it('选中 alpha 后 workspace 返回 alpha 的场景与目录清单', async () => {
    await select('alpha');

    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { scenario: string }).scenario).toBe('全量');
    expect(prepDirs(res.json())).toEqual(['数据准备/生产计划', '数据准备/产线电价']);
  });

  it('切换到 beta 后同一端点返回 beta 的清单（视角随选中变化）', async () => {
    await select('beta');

    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { scenario: string }).scenario).toBe('精简');
    expect(prepDirs(res.json())).toEqual(['数据准备/产线电价']);
  });

  it('同一目录在 alpha 下可列（200），在 beta 下清单外（403）', async () => {
    await select('alpha');
    const allowed = await app.inject({ method: 'GET', url: listUrl('数据准备/生产计划') });
    expect(allowed.statusCode).toBe(200);

    await select('beta');
    const denied = await app.inject({ method: 'GET', url: listUrl('数据准备/生产计划') });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'UPLOAD_DIR_FORBIDDEN' } });
  });

  // 断的行为已不存在，改为钉住**降级表现**：请求被拒（403），而不是返回一个空目录。
  it('已下线的「共享空间」→ 403 UPLOAD_DIR_FORBIDDEN（不是空目录）', async () => {
    await select('beta');

    const res = await app.inject({ method: 'GET', url: listUrl('共享空间') });

    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('UPLOAD_DIR_FORBIDDEN');
    expect(body.error.message).toContain('不开放');
  });

  it('数字人未配置场景 → 503 SCENARIO_NOT_CONFIGURED，且文案指名该数字人', async () => {
    await select('gamma');

    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' });

    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('SCENARIO_NOT_CONFIGURED');
    expect(body.error.message).toContain('gamma');
  });

  it('workspace 的目录项随场景下发字段约束（无约束目录为 []）', async () => {
    await select('delta');

    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' });

    expect(res.statusCode).toBe(200);
    const spaces = (
      res.json() as {
        spaces: Array<{ name: string; dirs: Array<{ dir: string; fields: unknown }> }>;
      }
    ).spaces;
    const prep = spaces.find((s) => s.name === '数据准备')!;
    expect(prep.dirs[0]!.fields).toEqual([
      { name: '产线编号', type: 'string', required: true },
      { name: '计划量', type: 'integer', required: false },
    ]);
    const tmp = spaces.find((s) => s.name === '临时空间')!;
    expect(tmp.dirs[0]!.fields).toEqual([]);
  });

  it('workspace 下发 predefined：仅平台预定义二级目录为 true（014）', async () => {
    await select('theta');

    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' });

    expect(res.statusCode).toBe(200);
    const spaces = (
      res.json() as {
        spaces: Array<{ name: string; dirs: Array<{ dir: string; predefined: boolean }> }>;
      }
    ).spaces;
    const prep = spaces.find((s) => s.name === '数据准备')!;
    expect(prep.dirs).toEqual([
      expect.objectContaining({ dir: '数据准备/算法规则', predefined: true }),
      expect.objectContaining({ dir: '数据准备/生产计划', predefined: false }),
    ]);
    for (const name of ['临时空间']) {
      const space = spaces.find((s) => s.name === name)!;
      expect(space.dirs[0]!.predefined).toBe(false);
    }
  });
});


describe('预定义目录屏蔽（清单即可见范围的唯一权威）', () => {
  it('屏蔽后 workspace 不出现该目录，数据准备空间仍在且 200', async () => {
    await select('iota');

    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' });

    expect(res.statusCode).toBe(200);
    expect(prepDirs(res.json())).toEqual(['数据准备/生产计划']);
    const prep = (
      res.json() as {
        spaces: Array<{ name: string; dirs: Array<{ dir: string; predefined: boolean }> }>;
      }
    ).spaces.find((s) => s.name === '数据准备')!;
    expect(prep.dirs.every((dir) => dir.predefined === false)).toBe(true);
  });

  it('屏蔽后访问该目录 → 403（与"清单外目录"同判据，不另开口子）', async () => {
    await select('iota');

    const res = await app.inject({ method: 'GET', url: listUrl('数据准备/算法规则') });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'UPLOAD_DIR_FORBIDDEN' } });
  });

  it('屏蔽后 /api/files/rules → 404，文案说明"未开放"且不暴露其他目录清单', async () => {
    await select('iota');

    const res = await app.inject({ method: 'GET', url: '/api/files/rules' });

    expect(res.statusCode).toBe(404);
    const err = (res.json() as { error: { code: string; message: string } }).error;
    expect(err.code).toBe('FILE_NOT_FOUND');
    expect(err.message).toContain('未开放');
    expect(err.message).toContain('算法规则');
    // 面向用户的文案 MUST NOT 借机列出其他可见目录
    expect(err.message).not.toContain('生产计划');
  });

  it('未屏蔽但目录为空：/api/files/rules 仍是"暂无文件"（既有行为不变）', async () => {
    await select('theta');

    const res = await app.inject({ method: 'GET', url: '/api/files/rules' });

    expect(res.statusCode).toBe(404);
    const err = (res.json() as { error: { code: string; message: string } }).error;
    expect(err.code).toBe('FILE_NOT_FOUND');
    expect(err.message).toContain('暂无文件');
  });

  it('全部屏蔽：workspace 200 且数据准备 dirs 为空（不再 503），扁平空间照常', async () => {
    await select('kappa');

    const workspace = await app.inject({ method: 'GET', url: '/api/files/workspace' });
    expect(workspace.statusCode).toBe(200);
    expect((workspace.json() as { scenario: string }).scenario).toBe('全部屏蔽');
    expect(prepDirs(workspace.json())).toEqual([]);

    for (const dir of ['临时空间']) {
      expect((await app.inject({ method: 'GET', url: listUrl(dir) })).statusCode).toBe(200);
    }
  });

  it('全部屏蔽：数据准备下任何路径都是 403（空间存在但无可见子目录）', async () => {
    await select('kappa');

    const res = await app.inject({ method: 'GET', url: listUrl('数据准备/算法规则') });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'UPLOAD_DIR_FORBIDDEN' } });
  });
});

describe('上传表字段约束（data_prep_fields 权威校验，契约 §3.1）', () => {
  const PREP_DIR = '数据准备/生产计划';

  function multipart(dir: string, filename: string, content: string | Buffer, contentType: string) {
    const boundary = '----vitest-boundary';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="dir"\r\n\r\n${dir}\r\n`),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
      ),
      Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
  }

  function toXlsxBuf(matrix: unknown[][]): Buffer {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrix), 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  it('缺少必填表头 → 400 FILE_SCHEMA_INVALID + details，且不落盘', async () => {
    await select('delta');
    const { body, headers } = multipart(
      PREP_DIR,
      't.csv',
      '日期,计划量\n2026-01-01,100\n',
      'text/csv',
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      payload: body,
      headers,
    });

    expect(res.statusCode).toBe(400);
    const err = (res.json() as { error: { code: string; details: string[] } }).error;
    expect(err.code).toBe('FILE_SCHEMA_INVALID');
    expect(err.details[0]).toContain('缺少必填表头');
    expect(err.details[0]).toContain('产线编号');

    // 校验失败的文件 MUST NOT 落盘
    const list = await app.inject({ method: 'GET', url: listUrl(PREP_DIR) });
    expect(list.json()).toEqual([]);
  });

  it('取值类型不符 → 400，行号按「表头为第 1 行」计', async () => {
    await select('delta');
    const { body, headers } = multipart(PREP_DIR, 't.csv', '产线编号,计划量\nA1,abc\n', 'text/csv');

    const res = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      payload: body,
      headers,
    });

    expect(res.statusCode).toBe(400);
    const err = (res.json() as { error: { code: string; details: string[] } }).error;
    expect(err.code).toBe('FILE_SCHEMA_INVALID');
    expect(err.details[0]).toContain('第 2 行');
    expect(err.details[0]).toContain('计划量');
  });

  it('xlsx 同样校验（第一个 sheet，数值单元格按显示文本判定）', async () => {
    await select('delta');
    const buf = toXlsxBuf([
      ['产线编号', '计划量'],
      ['A1', 'abc'],
    ]);
    const { body, headers } = multipart(
      PREP_DIR,
      't.xlsx',
      buf,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      payload: body,
      headers,
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('FILE_SCHEMA_INVALID');
  });

  it('合规文件 → 201 落盘（可选字段缺席、空单元格均合法）', async () => {
    await select('delta');
    const { body, headers } = multipart(PREP_DIR, 'ok.csv', '产线编号\nA1\nA2\n', 'text/csv');

    const res = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      payload: body,
      headers,
    });

    expect(res.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: listUrl(PREP_DIR) });
    expect(list.json() as Array<{ filename: string }>).toHaveLength(1);
  });

  it('无约束目录（alpha 的生产计划）与临时空间不触发校验', async () => {
    await select('alpha');
    const { body: b1, headers: h1 } = multipart(
      PREP_DIR,
      'free.csv',
      '任意,内容\n1,2\n',
      'text/csv',
    );
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      payload: b1,
      headers: h1,
    });
    expect(r1.statusCode).toBe(201);

    await select('delta');
    const { body: b2, headers: h2 } = multipart(
      '临时空间',
      'tmp.csv',
      '任意,内容\n1,2\n',
      'text/csv',
    );
    const r2 = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      payload: b2,
      headers: h2,
    });
    expect(r2.statusCode).toBe(201);
  });
});

describe('上传早验（dir 先到时目录校验前置，拒绝省带宽）', () => {
  function multipartOrdered(
    entries: Array<{ name: string; filename?: string; content: string; contentType?: string }>,
  ) {
    const boundary = '----vitest-early-check';
    const bufs: Buffer[] = [];
    for (const e of entries) {
      const disposition = e.filename
        ? `Content-Disposition: form-data; name="${e.name}"; filename="${e.filename}"\r\nContent-Type: ${e.contentType ?? 'application/octet-stream'}`
        : `Content-Disposition: form-data; name="${e.name}"`;
      bufs.push(Buffer.from(`--${boundary}\r\n${disposition}\r\n\r\n${e.content}\r\n`));
    }
    bufs.push(Buffer.from(`--${boundary}--\r\n`));
    return {
      body: Buffer.concat(bufs),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    };
  }

  const DIR_OUT_OF_LIST = { name: 'dir', content: '数据准备/清单外目录' };
  const FILE_CSV = {
    name: 'file',
    filename: 'a.csv',
    content: '任意\n1\n',
    contentType: 'text/csv',
  };

  /** 临时空间里的上传暂存残留（`.upload-` 前缀） */
  async function stagedResidue(): Promise<string[]> {
    const res = await app.inject({ method: 'GET', url: listUrl('临时空间') });
    return (res.json() as Array<{ filename: string }>)
      .map((f) => f.filename)
      .filter((n) => n.startsWith('.upload-'));
  }

  it('dir 先到 + 清单外目录 → 文件上传前即拒绝（403），且不留暂存', async () => {
    await select('alpha');
    const { body, headers } = multipartOrdered([DIR_OUT_OF_LIST, FILE_CSV]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      payload: body,
      headers,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'UPLOAD_DIR_FORBIDDEN' } });
    expect(await stagedResidue()).toEqual([]);
  });

  it('file 先到的旧顺序行为一致（先收后验：同 403，暂存已清）', async () => {
    await select('alpha');
    const { body, headers } = multipartOrdered([FILE_CSV, DIR_OUT_OF_LIST]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      payload: body,
      headers,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'UPLOAD_DIR_FORBIDDEN' } });
    expect(await stagedResidue()).toEqual([]);
  });

  it('dir 先到 + 未选中数字人 → 409 在文件上传前返回，不留暂存', async () => {
    await deselect();
    const { body, headers } = multipartOrdered([{ name: 'dir', content: '临时空间' }, FILE_CSV]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      payload: body,
      headers,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'AGENT_NOT_SELECTED' } });

    await select('alpha');
    expect(await stagedResidue()).toEqual([]);
  });
});

describe('目录级可上传类型（data_prep_uploads 权威判定）', () => {
  function multipart(dir: string, filename: string, content: string, contentType: string) {
    const boundary = '----vitest-upload-types';
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

  it('放宽点：改造前被拒的 .txt / .json 在已配置目录上放行（201）', async () => {
    await select('epsilon');

    const txt = multipart('数据准备/生产计划', 'notes.txt', '随便写点什么', 'text/plain');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/files/upload',
          payload: txt.body,
          headers: txt.headers,
        })
      ).statusCode,
    ).toBe(201);

    const json = multipart('数据准备/生产计划', 'meta.json', '{"a":1}', 'application/json');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/files/upload',
          payload: json.body,
          headers: json.headers,
        })
      ).statusCode,
    ).toBe(201);
  });

  it('收紧点：目录只允许 .csv 时上传 .xlsx → 400 VALIDATION_FAILED，文案含允许清单且不落盘', async () => {
    await select('epsilon');
    const before = (await app.inject({ method: 'GET', url: listUrl('数据准备/产线电价') })).json();

    const { body, headers } = multipart(
      '数据准备/产线电价',
      'price.xlsx',
      'binary-ish',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      payload: body,
      headers,
    });

    expect(res.statusCode).toBe(400);
    const err = (res.json() as { error: { code: string; message: string } }).error;
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.message).toContain('.xlsx');
    expect(err.message).toContain('.csv');
    const after = (await app.inject({ method: 'GET', url: listUrl('数据准备/产线电价') })).json();
    expect(after).toEqual(before);
  });

  it('收紧点：未配置的目录仍按平台默认（.txt 被拒、.csv 放行）', async () => {
    await select('alpha');

    const txt = multipart('数据准备/生产计划', 'note.txt', 'x', 'text/plain');
    const denied = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      payload: txt.body,
      headers: txt.headers,
    });
    expect(denied.statusCode).toBe(400);
    expect((denied.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');

    const csv = multipart('数据准备/生产计划', 'ok.csv', '任意\n1\n', 'text/csv');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/files/upload',
          payload: csv.body,
          headers: csv.headers,
        })
      ).statusCode,
    ).toBe(201);
  });

  it('下发：workspace 的目录项带目录级 upload_extensions（未配置目录 = 平台默认）', async () => {
    await select('epsilon');
    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' });
    expect(res.statusCode).toBe(200);

    const spaces = (
      res.json() as {
        spaces: Array<{
          name: string;
          upload_extensions: string[];
          dirs: Array<{ dir: string; upload_extensions: string[] }>;
        }>;
      }
    ).spaces;

    const prep = spaces.find((s) => s.name === '数据准备')!;
    const plan = prep.dirs.find((d) => d.dir === '数据准备/生产计划')!;
    const price = prep.dirs.find((d) => d.dir === '数据准备/产线电价')!;
    expect(plan.upload_extensions).toEqual(['.csv', '.xlsx', '.txt', '.json']);
    expect(price.upload_extensions).toEqual(['.csv']);

    // 临时空间：目录级恒等于空间级（与改造前一致）
    for (const space of spaces.filter((s) => s.name !== '数据准备')) {
      for (const dir of space.dirs) {
        expect(dir.upload_extensions).toEqual(space.upload_extensions);
      }
    }
  });

  it('下发：未配置 uploads 的数字人（alpha）目录项为平台默认 .csv/.xlsx', async () => {
    await select('alpha');
    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' });
    const prep = (
      res.json() as {
        spaces: Array<{ name: string; dirs: Array<{ dir: string; upload_extensions: string[] }> }>;
      }
    ).spaces.find((s) => s.name === '数据准备')!;
    for (const dir of prep.dirs) {
      expect(dir.upload_extensions).toEqual(['.csv', '.xlsx']);
    }
  });
});

function upload(dir: string, filename: string, content: string | Buffer, contentType: string) {
  const boundary = '----vitest-story-boundary';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="dir"\r\n\r\n${dir}\r\n`),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function postUpload(
  dir: string,
  filename: string,
  content: string | Buffer,
  contentType: string,
): Promise<ReturnType<typeof app.inject>> {
  const { body, headers } = upload(dir, filename, content, contentType);
  return app.inject({ method: 'POST', url: '/api/files/upload', payload: body, headers });
}

/** 临时空间的空间级白名单（2026-10-14 增 `.xls`；2026-10-20 增 `.html`） */
const SPACE_LEVEL_EXTS = [
  '.csv',
  '.xlsx',
  '.xls',
  '.txt',
  '.json',
  '.html',
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.bmp',
  '.webp',
  '.gif',
  '.tif',
  '.tiff',
];

/* ---------- US3：临时空间判定逐项不变（P1） ---------- */

// 2026-11-18（025）：原「US3 共享空间与临时空间」的两条用例合并——共享空间下线后，
// "不受 data_prep_uploads 影响 + 拒绝未知类型"这组断言只在临时空间上验证一次。
describe('US3 临时空间的判定逐项不变（FR-013）', () => {
  it('即便配了 data_prep_uploads：临时空间仍接受全部文档与图片类型，且拒绝未知类型', async () => {
    await select('epsilon');

    expect((await postUpload('临时空间', 'a.json', '{"a":1}', 'application/json')).statusCode).toBe(
      201,
    );
    expect((await postUpload('临时空间', 'b.pdf', '%PDF-1.4', 'application/pdf')).statusCode).toBe(
      201,
    );
    expect((await postUpload('临时空间', 'c.jpg', 'jpeg-ish', 'image/jpeg')).statusCode).toBe(201);
    expect((await postUpload('临时空间', 'b.tif', 'tiff-ish', 'image/tiff')).statusCode).toBe(201);

    const denied = await postUpload('临时空间', 'd.exe', 'MZ', 'application/octet-stream');
    expect(denied.statusCode).toBe(400);
    expect((denied.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('下发口径：临时空间的目录项恒等于所属空间的白名单（逐项比对）', async () => {
    await select('epsilon');
    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' });
    const spaces = (
      res.json() as {
        spaces: Array<{
          name: string;
          upload_extensions: string[];
          dirs: Array<{ dir: string; upload_extensions: string[] }>;
        }>;
      }
    ).spaces;

    for (const name of ['临时空间']) {
      const space = spaces.find((s) => s.name === name)!;
      expect(space.upload_extensions).toEqual(SPACE_LEVEL_EXTS);
      for (const dir of space.dirs) {
        expect(dir.upload_extensions).toEqual(SPACE_LEVEL_EXTS);
      }
    }
    expect(spaces.find((s) => s.name === '数据准备')!.upload_extensions).toEqual(['.csv', '.xlsx']);
  });
});


describe('`.xls` 两空间可用（2026-10-14 新增类型）', () => {
  /** 真实 `.xls`（OLE2/BIFF8）：SheetJS 写入，避免手搓二进制 fixture */
  function xlsBuffer(rows: unknown[][]): Buffer {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer;
  }

  const XLS_TYPE = 'application/vnd.ms-excel';

  it('临时空间：空间级白名单含 .xls ⇒ 上传成功（201）', async () => {
    await select('epsilon');
    const xls = xlsBuffer([['产线编号'], ['A1']]);

    expect((await postUpload('临时空间', '总BOM.xls', xls, XLS_TYPE)).statusCode).toBe(201);
  });

  it('数据准备：目录白名单含 .xls ⇒ 上传成功（不再被"仅 csv/xlsx"挡住）', async () => {
    await select('eta');
    const res = await postUpload(
      '数据准备/生产计划',
      'a.xls',
      xlsBuffer([['产线编号'], ['A1']]),
      XLS_TYPE,
    );

    expect(res.statusCode).toBe(201);
  });

  it('数据准备：声明了字段约束的目录对 .xls 同样做表结构校验（不因容器格式不同而跳过）', async () => {
    await select('eta');
    const res = await postUpload(
      '数据准备/生产计划',
      'bad.xls',
      xlsBuffer([['计划量'], ['1']]),
      XLS_TYPE,
    );

    expect(res.statusCode).toBe(400);
    const err = (res.json() as { error: { code: string; details: string[] } }).error;
    expect(err.code).toBe('FILE_SCHEMA_INVALID');
    expect(err.details[0]).toContain('缺少必填表头');
    expect(err.details[0]).toContain('产线编号');
  });

  it('未配置白名单的目录仍只接受 .csv / .xlsx（存量行为不变，FR-005）', async () => {
    await select('delta');
    const res = await postUpload(
      '数据准备/生产计划',
      'a.xls',
      xlsBuffer([['产线编号'], ['A1']]),
      XLS_TYPE,
    );

    expect(res.statusCode).toBe(400);
    const err = (res.json() as { error: { code: string; message: string } }).error;
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.message).toContain('.xls');
  });

  it('下发：目录配置里的 .xls 原样回传给前台（界面 accept 据此生成）', async () => {
    await select('eta');
    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' });
    const dir = (
      res.json() as {
        spaces: Array<{ name: string; dirs: Array<{ dir: string; upload_extensions: string[] }> }>;
      }
    ).spaces
      .find((s) => s.name === '数据准备')!
      .dirs.find((d) => d.dir === '数据准备/生产计划')!;

    expect(dir.upload_extensions).toEqual(['.xls', '.csv']);
  });
});


describe('US4 声明了字段约束的目录上传非表格类型 → 跳过表结构校验（FR-020）', () => {
  it.each([
    ['notes.txt', '随便写点什么', 'text/plain'],
    ['doc.pdf', '%PDF-1.4', 'application/pdf'],
    ['meta.json', '{"a":1}', 'application/json'],
    ['pack.zip', 'PK\u0003\u0004 zip-ish', 'application/zip'],
  ])('%s 上传成功（201），不因"缺少必填表头"被拒', async (filename, content, contentType) => {
    await select('zeta');
    const res = await postUpload('数据准备/生产计划', filename, content, contentType);
    expect(res.statusCode).toBe(201);
  });

  it('表格类型仍逐条校验：缺必填表头 / 类型不符 / 损坏文件都被拒且理由可读', async () => {
    await select('zeta');

    const missing = await postUpload(
      '数据准备/生产计划',
      't.csv',
      '日期,计划量\n2026-01-01,100\n',
      'text/csv',
    );
    expect(missing.statusCode).toBe(400);
    const missingErr = (missing.json() as { error: { code: string; details: string[] } }).error;
    expect(missingErr.code).toBe('FILE_SCHEMA_INVALID');
    expect(missingErr.details[0]).toContain('缺少必填表头');
    expect(missingErr.details[0]).toContain('产线编号');

    const wrongType = await postUpload(
      '数据准备/生产计划',
      't2.csv',
      '产线编号,计划量\nA1,abc\n',
      'text/csv',
    );
    expect(wrongType.statusCode).toBe(400);
    const wrongErr = (wrongType.json() as { error: { code: string; details: string[] } }).error;
    expect(wrongErr.code).toBe('FILE_SCHEMA_INVALID');
    expect(wrongErr.details[0]).toContain('第 2 行');

    const broken = await postUpload(
      '数据准备/生产计划',
      'broken.xlsx',
      'this is not a zip payload',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(broken.statusCode).toBe(400);
    const brokenErr = (broken.json() as { error: { code: string; details: string[] } }).error;
    expect(brokenErr.code).toBe('FILE_SCHEMA_INVALID');
    expect(brokenErr.details[0]).toContain('无法解析');
  });

  it('.txt 即使目录声明了约束也不落表结构校验：合规 csv 与任意 txt 均 201，缺表头 csv 仍 400', async () => {
    await select('zeta');
    expect(
      (await postUpload('数据准备/生产计划', 'ok.csv', '产线编号\nA1\n', 'text/csv')).statusCode,
    ).toBe(201);
    expect(
      (await postUpload('数据准备/生产计划', 'free.txt', '任意内容', 'text/plain')).statusCode,
    ).toBe(201);
    expect(
      (await postUpload('数据准备/生产计划', 'bad.csv', '日期\n2026-01-01\n', 'text/csv'))
        .statusCode,
    ).toBe(400);
  });
});


describe('US5 未配置 data_prep_uploads 的存量数字人（FR-014）', () => {
  it('数据准备目录只接受 .csv / .xlsx（零迁移：scenario.json 不含该键）', async () => {
    await select('alpha');

    expect(
      (await postUpload('数据准备/生产计划', 'a.csv', '任意\n1\n', 'text/csv')).statusCode,
    ).toBe(201);
    expect(
      (
        await postUpload(
          '数据准备/生产计划',
          'b.xlsx',
          'not-zip',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
      ).statusCode,
    ).toBe(201);

    for (const [filename, contentType] of [
      ['c.txt', 'text/plain'],
      ['d.json', 'application/json'],
      ['e.pdf', 'application/pdf'],
      ['f.zip', 'application/zip'],
    ] as const) {
      const res = await postUpload('数据准备/生产计划', filename, 'x', contentType);
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('数据准备**空间根**上传仍被拒：MUST 指定二级目录（FR-015 修订口径）', async () => {
    await select('alpha');

    const res = await postUpload('数据准备', 'root.csv', '任意\n1\n', 'text/csv');

    expect(res.statusCode).toBe(400);
    const err = (res.json() as { error: { code: string; message: string } }).error;
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.message).toContain('二级目录');
  });
});

describe('FR-060 场景读取口径**不变**（009 回归护栏）', () => {
  it('场景仍只认 users/{uid}/agents/{name}/scenario.json：改文件即生效，与数据域位置无关', async () => {
    await select('beta');
    expect(
      prepDirs((await app.inject({ method: 'GET', url: '/api/files/workspace' })).json()),
    ).toEqual(['数据准备/产线电价']);

    const scenarioFile = path.join(root, 'users', userId, 'agents', 'beta', 'scenario.json');
    writeFileSync(
      scenarioFile,
      JSON.stringify({ scenario: '精简改', data_prep_dirs: ['产线电价', '生产计划'] }),
      'utf8',
    );

    const after = await app.inject({ method: 'GET', url: '/api/files/workspace' });
    expect(prepDirs(after.json())).toEqual(['数据准备/产线电价', '数据准备/生产计划']);
    expect(
      existsSync(path.join(root, 'users', userId, 'user-data', 'beta', '数据准备', '生产计划')),
    ).toBe(true);
    expect(existsSync(path.join(root, 'users', userId, 'agents', 'beta', '数据准备'))).toBe(false);
  });

  it('场景清单收缩不回删数据目录（FR-060：清单是"可见范围"，不是清理依据）', async () => {
    await select('beta');
    const dir = path.join(root, 'users', userId, 'user-data', 'beta', '数据准备', '生产计划');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '既有文件.csv'), '车间\n冲压\n', 'utf8');

    const scenarioFile = path.join(root, 'users', userId, 'agents', 'beta', 'scenario.json');
    writeFileSync(
      scenarioFile,
      JSON.stringify({ scenario: '精简', data_prep_dirs: ['产线电价'] }),
      'utf8',
    );

    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' });
    expect(prepDirs(res.json())).toEqual(['数据准备/产线电价']);
    // 目录与文件都还在（平台只负责可见范围，运行环境 MUST NOT 因清单收缩删数据）
    expect(existsSync(path.join(dir, '既有文件.csv'))).toBe(true);
  });
});
