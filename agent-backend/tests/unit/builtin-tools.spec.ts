import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILTIN_TOOL_CATALOG } from '../../src/domain/builtin-tool-catalog.js';
import { FileAccess } from '../../src/domain/file-access.js';
import { readToolError } from '../../src/domain/tool-error.js';
import { extractViewLinks } from '../../src/domain/view-links.js';
import { buildBuiltinTools } from '../../src/infra/builtin-tools.js';

let root: string;
const warn = vi.fn();

function fakeLogger(): Logger {
  return { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

const AGENT = 'demo';

const skillsDirOf = (): string => path.join(root, 'users', 'admin', 'agents', AGENT, 'skills');

function build(enabled: string[]) {
  return buildBuiltinTools({
    fileAccess: new FileAccess({ optAgentRoot: root, userId: 'admin', agentName: AGENT }),
    threadId: 'th_1',
    enabled,
    availableDirs: ['临时空间'],
    skillsDir: skillsDirOf(),
    logger: fakeLogger(),
  });
}

async function run(tool: { execute: (...args: never[]) => Promise<unknown> }, params: unknown) {
  const result = (await tool.execute('call_1' as never, params as never)) as {
    content: Array<{ text: string }>;
  };
  return result.content[0]?.text ?? '';
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'builtin-tools-'));
  warn.mockReset();
  const skillDir = path.join(skillsDirOf(), '调度算法');
  mkdirSync(path.join(skillDir, 'references'), { recursive: true });
  writeFileSync(path.join(skillDir, 'SKILL.md'), '# 调度算法正文\n', 'utf8');
  writeFileSync(path.join(skillDir, 'references', '算法详解.md'), '# 详解\n', 'utf8');
  writeFileSync(path.join(root, 'secret.txt'), 'SECRET', 'utf8');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('buildBuiltinTools —— read_skill 接线', () => {
  it('启用后能读到 SKILL.md 与 references/ 附件', async () => {
    const tools = build(['read_skill']);
    expect(tools.map((tool) => tool.name)).toEqual(['read_skill']);

    expect(await run(tools[0]!, { skill: '调度算法' })).toContain('调度算法正文');
    expect(await run(tools[0]!, { skill: '调度算法', path: 'references/算法详解.md' })).toContain(
      '详解',
    );
  });

  it('未启用就不装配（仍是 TOOL.json 白名单说了算）', () => {
    expect(build(['calculator']).map((tool) => tool.name)).toEqual(['calculator']);
    expect(build([])).toEqual([]);
  });

  it('越权：拒绝文案交给模型，同时记 alert 日志（不静默）', async () => {
    const tools = build(['read_skill']);
    const text = await run(tools[0]!, { skill: '调度算法', path: '../../secret.txt' });

    expect(text).toContain('技能文件访问被拒绝');
    expect(text).not.toContain('SECRET');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ alert: true, event: 'file.access.denied', tool: 'read_skill' }),
      expect.stringContaining('越权被拒绝'),
    );
  });

  it('技能不存在属用法问题：给可读提示，但不记 alert（与真越权分家）', async () => {
    const tools = build(['read_skill']);
    const text = await run(tools[0]!, { skill: '不存在的技能' });

    expect(text).toContain('没有名为「不存在的技能」的技能');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('buildBuiltinTools —— grep_skill 接线（2026-10-17 新增）', () => {
  it('启用后能在技能内容中检索，命中行带技能名与路径', async () => {
    const tools = build(['grep_skill']);
    expect(tools.map((tool) => tool.name)).toEqual(['grep_skill']);

    expect(await run(tools[0]!, { pattern: '调度算法' })).toContain('调度算法/SKILL.md:1');
    expect(await run(tools[0]!, { pattern: '详解', skill: '调度算法' })).toContain(
      '调度算法/references/算法详解.md',
    );
  });

  it('越权（非法技能名）→ 拒绝文案交给模型，同时记 alert 日志（与 read_skill 同口径）', async () => {
    const tools = build(['grep_skill']);
    const text = await run(tools[0]!, { pattern: 'x', skill: '../调度算法' });

    expect(text).toContain('技能文件访问被拒绝');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ alert: true, event: 'file.access.denied', tool: 'grep_skill' }),
      expect.stringContaining('越权被拒绝'),
    );
  });
});

describe('buildBuiltinTools —— grep_files 接线（2026-10-20 增 .html）', () => {
  it('临时空间里的 `.html` 可被检索，命中行带路径与行号（与文本类同口径）', async () => {
    const space = path.join(root, 'users', 'admin', 'user-data', AGENT, '临时空间');
    mkdirSync(space, { recursive: true });
    writeFileSync(path.join(space, '看板.html'), '<h1>产能明细</h1>\n', 'utf8');
    writeFileSync(path.join(space, '说明.txt'), '产能说明\n', 'utf8');

    const tools = build(['grep_files']);
    expect(tools.map((tool) => tool.name)).toEqual(['grep_files']);

    const text = await run(tools[0]!, { pattern: '产能', dir: '临时空间' });

    expect(text).toContain('临时空间/看板.html:1');
    expect(text).toContain('临时空间/说明.txt:1');
  });
});

describe('buildBuiltinTools —— write_file 的结果结构化（2026-10-21）', () => {
  it('成功：返回 JSON（filePath / filePathName / bytes / message），可被视图链接协议抽成「文件」入口', async () => {
    const tools = build(['write_file']);
    const content = '<h1>看板</h1>';

    const text = await run(tools[0]!, { filename: 'th_1_看板.html', content });

    const result = JSON.parse(text) as Record<string, unknown>;
    expect(result).toMatchObject({
      filePath: '临时空间/th_1_看板.html',
      filePathName: 'th_1_看板.html',
      bytes: Buffer.byteLength(content, 'utf8'),
    });
    expect(String(result.message)).toBe(
      `已写入 临时空间/th_1_看板.html（${Buffer.byteLength(content, 'utf8')} 字节）`,
    );
    expect(extractViewLinks(text)).toEqual([
      { url: '临时空间/th_1_看板.html', kind: 'file', name: 'th_1_看板.html' },
    ]);
  });

  it('越权（文件名缺会话前缀）仍是纯文本：不产生链接，且照旧记 file.write.denied', async () => {
    const tools = build(['write_file']);

    const text = await run(tools[0]!, { filename: '看板.html', content: 'x' });

    expect(text).toContain('没有权限执行该操作');
    expect(() => JSON.parse(text)).toThrow();
    expect(extractViewLinks(text)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ alert: true, event: 'file.write.denied', tool: 'write_file' }),
      expect.stringContaining('越权被拒绝'),
    );
  });
});

describe('buildBuiltinTools —— write_file 按扩展名路由（2026-11-16）', () => {
  const tmpFile = (name: string): string =>
    path.join(root, 'users', 'admin', 'user-data', AGENT, '临时空间', name);

  async function runFull(
    tools: ReadonlyArray<{ execute: (...args: never[]) => Promise<unknown> }>,
    params: unknown,
  ) {
    return (await tools[0]!.execute('call_1' as never, params as never)) as {
      content: Array<{ text: string }>;
      details?: unknown;
    };
  }

  it('成功结果带 mode（文本类）', async () => {
    const text = await run(build(['write_file'])[0]!, {
      filename: 'th_1_分析.md',
      content: '# 结论',
    });

    expect(JSON.parse(text)).toMatchObject({
      filePath: '临时空间/th_1_分析.md',
      mode: 'markdown',
      bytes: Buffer.byteLength('# 结论', 'utf8'),
    });
  });

  it('非法 JSON → CONTENT_FORMAT_MISMATCH 标记，且不落盘', async () => {
    const result = await runFull(build(['write_file']), {
      filename: 'th_1_坏.json',
      content: '{rows: 42}',
    });

    expect(result.content[0]?.text).toContain('内容与扩展名不匹配');
    expect(readToolError(result.details)).toMatchObject({ code: 'CONTENT_FORMAT_MISMATCH' });
    expect(existsSync(tmpFile('th_1_坏.json'))).toBe(false);
  });

  it('CSV 引号未闭合 → CONTENT_FORMAT_MISMATCH，且不落盘', async () => {
    const result = await runFull(build(['write_file']), {
      filename: 'th_1_坏.csv',
      content: 'a,b\n"未闭合\n',
    });

    expect(readToolError(result.details)).toMatchObject({ code: 'CONTENT_FORMAT_MISMATCH' });
    expect(existsSync(tmpFile('th_1_坏.csv'))).toBe(false);
  });

  it('`.xlsx`：表格源 → 真实工作簿落盘，且能被 read_file 读回', async () => {
    const tools = build(['write_file', 'read_file']);
    const write = tools.find((tool) => tool.name === 'write_file')!;
    const read = tools.find((tool) => tool.name === 'read_file')!;

    const text = await run(write, { filename: 'th_1_汇总.xlsx', content: '物料,数量\nA,10\n' });
    expect(JSON.parse(text)).toMatchObject({ mode: 'xlsx' });
    expect(existsSync(tmpFile('th_1_汇总.xlsx'))).toBe(true);

    const back = await run(read, { path: '临时空间/th_1_汇总.xlsx' });
    expect(back).toContain('### Sheet: Sheet1');
    expect(back).toContain('物料,数量');
  });

  it('`.pdf`：受限 Markdown → PDF 落盘（不再写假文件）', async () => {
    const result = await runFull(build(['write_file']), {
      filename: 'th_1_报告.pdf',
      content: '# 月报\n\n产量 1200 件\n',
    });

    expect(readToolError(result.details)).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ mode: 'pdf' });
    expect(existsSync(tmpFile('th_1_报告.pdf'))).toBe(true);
  });

  it('未登记扩展名：写得进去，就一定能用 read_file 读回来', async () => {
    const tools = build(['write_file', 'read_file']);
    const write = tools.find((tool) => tool.name === 'write_file')!;
    const read = tools.find((tool) => tool.name === 'read_file')!;
    const content = '# 日志\n2026-11-16 start\n';

    await run(write, { filename: 'th_1_日志.log', content });
    const back = await run(read, { path: '临时空间/th_1_日志.log' });

    expect(back).toBe(content);
  });
});

describe('buildBuiltinTools —— 失败标记（工具卡片标红的唯一依据）', () => {
  async function runFull(
    tools: ReadonlyArray<{ execute: (...args: never[]) => Promise<unknown> }>,
    params: unknown,
  ) {
    return (await tools[0]!.execute('call_1' as never, params as never)) as {
      content: Array<{ text: string }>;
      details?: unknown;
    };
  }

  it('越权：正文与告警不变，另带 FILE_ACCESS_DENIED 标记', async () => {
    const result = await runFull(build(['write_file']), { filename: '看板.html', content: 'x' });

    expect(result.content[0]?.text).toContain('没有权限执行该操作');
    expect(readToolError(result.details)).toMatchObject({ code: 'FILE_ACCESS_DENIED' });
  });

  it('计算失败：带 CALCULATION_FAILED 标记', async () => {
    const result = await runFull(build(['calculator']), { expression: '1+' });

    expect(result.content[0]?.text).toContain('表达式无法计算');
    expect(readToolError(result.details)).toMatchObject({ code: 'CALCULATION_FAILED' });
  });

  it('目录里的每个工具名都有实现：没有一个落到「未知内置工具」兜底', async () => {
    const names = BUILTIN_TOOL_CATALOG.map((entry) => entry.name);
    const tools = build(names);
    expect(tools.map((tool) => tool.name).sort()).toEqual([...names].sort());

    for (const tool of tools) {
      const result = await runFull([tool], {});
      expect(readToolError(result.details)?.code).not.toBe('TOOL_NOT_IMPLEMENTED');
    }
  });

  it('正常返回（业务结果"算出来了"）：**不带**标记，卡片保持绿', async () => {
    const result = await runFull(build(['calculator']), { expression: '1+1' });

    expect(result.content[0]?.text).toContain('2');
    expect(readToolError(result.details)).toBeUndefined();
  });
});
