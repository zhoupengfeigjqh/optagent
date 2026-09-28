/**
 * 单元测试：内置工具装配（`infra/builtin-tools.ts`）。
 *
 * 领域逻辑已在 `read-skill.spec.ts` 单测；这里只守 **接线**：
 * 目录项 → 领域实现 → 交给模型的文本，以及**越权映射**（拒绝文案 + alert 日志）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileAccess } from '../../src/domain/file-access.js';
import { buildBuiltinTools } from '../../src/infra/builtin-tools.js';

let root: string;
const warn = vi.fn();

function fakeLogger(): Logger {
  return { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

/** 本数字人的技能根：users/{uid}/agents/{agent}/skills */
const skillsDirOf = (): string =>
  path.join(root, 'users', 'admin', 'agents', 'demo', 'skills');

function build(enabled: string[]) {
  return buildBuiltinTools({
    fileAccess: new FileAccess({ optAgentRoot: root, userId: 'admin' }),
    threadId: 'th_1',
    enabled,
    availableDirs: ['共享空间'],
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
  // 技能目录之外的文件（越界用例的目标）
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
