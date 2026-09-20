/**
 * 集成测试：SKILL 管理端点（T089，契约 §4.1~§4.5）
 *
 * 覆盖：全部恶意夹具逐条被拒且错误码正确、**失败零残留**、
 * 名称冲突流程（显式覆盖或取消）、原子覆盖、编辑回显、被引用时的受影响清单。
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, type TestFixture } from '../helpers/fixture.js';
import { multipartBody } from '../helpers/multipart.js';
import { buildZip, zipFixture } from '../helpers/zip-fixture.js';

let fx: TestFixture;

const SKILL_MD = '---\nname: pdf-parse\ndescription: 解析 PDF 文本层\n---\n\n第一版正文\n';

async function install(
  buffer: Buffer,
  options: { overwrite?: boolean; filename?: string } = {},
) {
  const body = multipartBody(
    options.overwrite === undefined ? {} : { overwrite: String(options.overwrite) },
    { name: options.filename ?? 'skill.zip', content: buffer },
  );
  return fx.app.inject({
    method: 'POST',
    url: '/api/admin/skills/install',
    payload: body.payload,
    headers: body.headers,
  });
}

function skillsRoot(): string {
  return path.join(fx.platformDataDir, 'skills');
}

beforeEach(async () => {
  fx = await createFixture();
  fx.runtime.tools = [];
});

afterEach(async () => {
  await fx.cleanup();
});

describe('POST /api/admin/skills/install', () => {
  it('合规包安装成功（201），卡片出现且名称/描述与包内声明一致（FR-037、FR-038）', async () => {
    const res = await install(zipFixture({ 'SKILL.md': SKILL_MD, 'ref/a.md': 'x' }));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      name: 'pdf-parse',
      description: '解析 PDF 文本层',
      overwritten: false,
    });

    const list = await fx.app.inject({ method: 'GET', url: '/api/admin/skills?page=1' });
    expect(list.json().items[0]).toMatchObject({ name: 'pdf-parse', description: '解析 PDF 文本层' });
  });

  it('缺少 SKILL.md → ADM_SKILL_ARCHIVE_INVALID，且无任何残留', async () => {
    const before = fs.existsSync(skillsRoot()) ? fs.readdirSync(skillsRoot()) : [];
    const res = await install(zipFixture({ 'readme.md': '没有技能说明' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('ADM_SKILL_ARCHIVE_INVALID');
    expect(fs.existsSync(skillsRoot()) ? fs.readdirSync(skillsRoot()) : []).toEqual(before);
  });

  it('元数据缺字段 → ADM_SKILL_ARCHIVE_INVALID', async () => {
    const res = await install(zipFixture({ 'SKILL.md': '---\nname: x\n---\n' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('ADM_SKILL_ARCHIVE_INVALID');
  });

  it('`../` 越界 / 绝对路径 / 符号链接 → ADM_SKILL_ARCHIVE_UNSAFE', async () => {
    const fixtures: Buffer[] = [
      zipFixture({ 'SKILL.md': SKILL_MD, '../escape.txt': 'x' }),
      zipFixture({ 'SKILL.md': SKILL_MD, '/etc/passwd': 'x' }),
      buildZip([
        { name: 'SKILL.md', content: SKILL_MD },
        { name: 'link', symlinkTo: '/etc/passwd' },
      ]),
    ];
    for (const buffer of fixtures) {
      const res = await install(buffer);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('ADM_SKILL_ARCHIVE_UNSAFE');
    }
    // 三次失败均无残留
    const dirs = fs.existsSync(skillsRoot()) ? fs.readdirSync(skillsRoot()) : [];
    expect(dirs.filter((d) => d.startsWith('.tmp-') || d.startsWith('.old-'))).toEqual([]);
  });

  it('深层嵌套超限 → 在写入目标目录之前按上限拒绝（FR-039），无半解压残留（FR-041）', async () => {
    const res = await install(
      zipFixture({ 'SKILL.md': SKILL_MD, 'a/b/c/d/e/f/g/deep.txt': 'x' }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('ADM_SKILL_ARCHIVE_UNSAFE');
    expect(fs.existsSync(path.join(skillsRoot(), 'pdf-parse'))).toBe(false);
  });

  it('非 ZIP 内容 → ADM_SKILL_ARCHIVE_INVALID（按魔数判定，不信扩展名）', async () => {
    const res = await install(Buffer.from('这不是 zip'));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('ADM_SKILL_ARCHIVE_INVALID');
  });

  it('名称冲突且未选择覆盖 → 409 ADM_SKILL_NAME_TAKEN（FR-040）', async () => {
    await install(zipFixture({ 'SKILL.md': SKILL_MD }));
    const res = await install(zipFixture({ 'SKILL.md': SKILL_MD }));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ADM_SKILL_NAME_TAKEN');
  });

  it('显式选择覆盖 → 原子替换，旧附件不残留（FR-040）', async () => {
    await install(zipFixture({ 'SKILL.md': SKILL_MD, 'old-only.txt': '旧附件' }));
    const res = await install(
      zipFixture({
        'SKILL.md': '---\nname: pdf-parse\ndescription: 解析 PDF（第二版）\n---\n\n第二版正文\n',
        'new-only.txt': '新附件',
      }),
      { overwrite: true },
    );
    expect(res.statusCode).toBe(201);
    expect(res.json().overwritten).toBe(true);

    const dir = path.join(skillsRoot(), 'pdf-parse');
    expect(fs.readdirSync(dir).sort()).toEqual(['SKILL.md', 'new-only.txt']);
    expect(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')).toContain('第二版正文');
  });

  it('安装目标是共享技能库，MUST NOT 写入任何数字人的技能目录（FR-037）', async () => {
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      payload: {
        name: 'demo',
        soul: 'x',
        enabled_tools: [],
        mcp_services: [],
        skills: [],
        scenario: { scenario: 's', data_prep_dirs: ['算法规则'] },
      },
    });
    await install(zipFixture({ 'SKILL.md': SKILL_MD }));
    // 安装只落在共享技能库
    expect(fs.existsSync(path.join(fx.platformDataDir, 'skills', 'pdf-parse', 'SKILL.md'))).toBe(true);
    // 安装不会凭空创建数字人目录（FR-037：MUST NOT 直接写入某个数字人的技能目录）
    expect(fs.existsSync(path.join(fx.optAgentRoot, 'users', 'admin', 'agents', 'demo'))).toBe(false);
  });
});

describe('GET /api/admin/skills/{name}（查看）与 /file（读取单文件）', () => {
  it('查看元数据与正文全文（FR-036）', async () => {
    await install(zipFixture({ 'SKILL.md': SKILL_MD }));
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/skills/pdf-parse' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'pdf-parse', content: SKILL_MD });
    expect(typeof res.json().revision).toBe('number');
  });

  it('读取参考文件正文（2026-09-16：SKILL.md 与附件都可查看/编辑）', async () => {
    await install(
      zipFixture({ 'SKILL.md': SKILL_MD, 'references/手册.md': '# 手册\n\n内容\n' }),
    );
    const res = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/skills/pdf-parse/file?path=references/%E6%89%8B%E5%86%8C.md',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ path: 'references/手册.md', binary: false, editable: true });
    expect(res.json().content).toContain('# 手册');
    expect(res.json().hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('读取文件：越界路径 → 400 VALIDATION_FAILED；不存在 → 404', async () => {
    await install(zipFixture({ 'SKILL.md': SKILL_MD }));
    const traversal = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/skills/pdf-parse/file?path=../index.json',
    });
    expect(traversal.statusCode).toBe(400);
    expect(traversal.json().error.code).toBe('VALIDATION_FAILED');

    const missing = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/skills/pdf-parse/file?path=nope.md',
    });
    expect(missing.statusCode).toBe(404);
  });

  it('编辑入口唯一：旧端点 PUT .../content 不再存在（编辑走 PUT .../file）', async () => {
    await install(zipFixture({ 'SKILL.md': SKILL_MD }));
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/skills/pdf-parse/content',
      payload: { content: SKILL_MD, revision: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('不存在 → 404 ADM_SKILL_NOT_FOUND', async () => {
    expect(
      (await fx.app.inject({ method: 'GET', url: '/api/admin/skills/ghost' })).statusCode,
    ).toBe(404);
  });

  it('文件端点：技能不存在 → 404', async () => {
    const res = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/skills/ghost/file?path=SKILL.md',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /api/admin/skills/{name}/file（在线编辑，2026-09-16）', () => {
  /** 读一次文件拿到哈希（编辑的乐观锁基准） */
  async function hashOf(name: string, filePath: string): Promise<string> {
    const res = await fx.app.inject({
      method: 'GET',
      url: `/api/admin/skills/${name}/file?path=${encodeURIComponent(filePath)}`,
    });
    return res.json().hash as string;
  }

  async function save(name: string, filePath: string, content: string, baseHash: string) {
    return fx.app.inject({
      method: 'PUT',
      url: `/api/admin/skills/${name}/file`,
      payload: { path: filePath, content, base_hash: baseHash },
    });
  }

  it('保存附件正文 → 200，再次读取为新内容且索引大小同步', async () => {
    await install(zipFixture({ 'SKILL.md': SKILL_MD, 'references/手册.md': '# 旧手册\n' }));
    const base = await hashOf('pdf-parse', 'references/手册.md');

    const res = await save('pdf-parse', 'references/手册.md', '# 新手册\n\n补充内容\n', base);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ path: 'references/手册.md' });
    expect(res.json().hash).not.toBe(base);

    const readBack = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/skills/pdf-parse/file?path=references/%E6%89%8B%E5%86%8C.md',
    });
    expect(readBack.json().content).toBe('# 新手册\n\n补充内容\n');
    expect(readBack.json().hash).toBe(res.json().hash);
  });

  it('保存 SKILL.md → 卡片描述按新正文同步（列表不脱节）', async () => {
    await install(zipFixture({ 'SKILL.md': SKILL_MD }));
    const base = await hashOf('pdf-parse', 'SKILL.md');

    const res = await save(
      'pdf-parse',
      'SKILL.md',
      '---\nname: pdf-parse\ndescription: 解析 PDF（已修订）\n---\n\n新正文\n',
      base,
    );
    expect(res.statusCode).toBe(200);

    const list = await fx.app.inject({ method: 'GET', url: '/api/admin/skills?page=1' });
    expect(list.json().items[0]).toMatchObject({
      name: 'pdf-parse',
      description: '解析 PDF（已修订）',
    });
  });

  it('base_hash 过期 → 409 ADM_CONFIG_REVISION_CONFLICT，且文件内容保持他处版本', async () => {
    await install(zipFixture({ 'SKILL.md': SKILL_MD, 'references/手册.md': '# 旧手册\n' }));
    const stale = await hashOf('pdf-parse', 'references/手册.md');
    await save('pdf-parse', 'references/手册.md', '# 他处的改动\n', stale);

    const res = await save('pdf-parse', 'references/手册.md', '# 我的改动\n', stale);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ADM_CONFIG_REVISION_CONFLICT');
    expect(
      fs.readFileSync(path.join(skillsRoot(), 'pdf-parse', 'references', '手册.md'), 'utf8'),
    ).toBe('# 他处的改动\n');
  });

  it('越界路径 → 400；二进制 → 400；不存在 → 404', async () => {
    await install(
      zipFixture({ 'SKILL.md': SKILL_MD, 'assets/bin.dat': 'a\u0000b' }),
    );
    const base = await hashOf('pdf-parse', 'SKILL.md');

    const traversal = await save('pdf-parse', '../index.json', 'x', base);
    expect(traversal.statusCode).toBe(400);
    expect(traversal.json().error.code).toBe('VALIDATION_FAILED');

    const binary = await save('pdf-parse', 'assets/bin.dat', 'x', base);
    expect(binary.statusCode).toBe(400);
    expect(binary.json().error.code).toBe('VALIDATION_FAILED');

    const missing = await save('pdf-parse', 'nope.md', 'x', base);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('ADM_SKILL_NOT_FOUND');
  });

  it('在线编辑只改共享技能库，MUST NOT 写入任何数字人的技能目录（FR-037）', async () => {
    await install(zipFixture({ 'SKILL.md': SKILL_MD }));
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      payload: {
        name: 'demo',
        soul: 'x',
        enabled_tools: [],
        mcp_services: [],
        skills: ['pdf-parse'],
        scenario: { scenario: 's', data_prep_dirs: ['算法规则'] },
      },
    });

    const base = await hashOf('pdf-parse', 'SKILL.md');
    expect((await save('pdf-parse', 'SKILL.md', SKILL_MD.replace('正文', '改过的正文'), base)).statusCode).toBe(200);

    expect(
      fs.readFileSync(path.join(skillsRoot(), 'pdf-parse', 'SKILL.md'), 'utf8'),
    ).toContain('改过的正文');
    // 编辑不落物化产物：数字人目录要么不存在，要么内容不由编辑产生
    expect(fs.existsSync(path.join(fx.optAgentRoot, 'users', 'admin', 'agents', 'demo'))).toBe(false);
  });
});

describe('DELETE /api/admin/skills/{name}', () => {
  it('删除成功（204）且目录被移除', async () => {
    await install(zipFixture({ 'SKILL.md': SKILL_MD }));
    const res = await fx.app.inject({ method: 'DELETE', url: '/api/admin/skills/pdf-parse' });
    expect(res.statusCode).toBe(204);
    expect(fs.existsSync(path.join(skillsRoot(), 'pdf-parse'))).toBe(false);
  });

  it('不存在 → 404 ADM_SKILL_NOT_FOUND', async () => {
    const res = await fx.app.inject({ method: 'DELETE', url: '/api/admin/skills/ghost' });
    expect(res.statusCode).toBe(404);
  });

  it('删除被引用的 SKILL 前，界面可经 §7.1 取得受影响数字人清单（FR-042）', async () => {
    await install(zipFixture({ 'SKILL.md': SKILL_MD }));
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      payload: {
        name: 'demo',
        soul: 'x',
        enabled_tools: [],
        mcp_services: [],
        skills: ['pdf-parse'],
        scenario: { scenario: 's', data_prep_dirs: ['算法规则'] },
      },
    });
    fx.ctx.users.create('admin', ['demo'], fx.ctx.store.revision());

    const res = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/references?target_type=skill&target_name=pdf-parse',
    });
    expect(res.json().affected).toEqual([{ user_id: 'admin', agent_name: 'demo' }]);
  });
});
