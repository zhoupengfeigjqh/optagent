import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAgentConfig } from '../../src/domain/agent-instance.js';
import { agentDir } from '../../src/domain/dirs.js';
import { isNextActionsEnabled, nextActionHintsCount } from '../../src/domain/soul.js';

const BODY = '## 主要使命\n\n你是交付助理，帮助业务人员排查订单风险。';

const USER = 'admin';
const AGENT = 'demo';

let root: string;

function writeSoul(switchLine: string): void {
  const dir = agentDir(root, USER, AGENT);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SOUL.md'),
    `---\nsoul_version: 1\n${switchLine}intro: 订单交付助理\n---\n\n${BODY}\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
  fs.writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');
  fs.writeFileSync(
    path.join(dir, 'scenario.json'),
    JSON.stringify({ scenario: '', data_prep_dirs: [] }),
    'utf8',
  );
}

function makeNextActionsConfig(): (
  userId: string,
  agentName: string,
) => { enabled: boolean; max: number } | null {
  return (userId, agentName) => {
    if (!isNextActionsEnabled(root, userId, agentName)) return null;
    return { enabled: true, max: nextActionHintsCount(root, userId, agentName) };
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-switch-it-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('SOUL.md 开关：开 / 关两态', () => {
  it('FR-035：开关开 / 关的 System Prompt 逐字一致（开关不进提示词）', () => {
    writeSoul('');
    const off = loadAgentConfig(agentDir(root, USER, AGENT));

    writeSoul('next_action_hints: true\n');
    const on = loadAgentConfig(agentDir(root, USER, AGENT));

    expect(off.systemPrompt).toBe(BODY);
    expect(on.systemPrompt).toBe(BODY);
    expect(on.systemPrompt).toBe(off.systemPrompt);
    expect(on.systemPrompt).not.toContain('next_action_hints');
    expect(off.systemPrompt).not.toContain('next_action_hints');
  });

  it('读取口径：只有显式 `true` 才算开；缺键 / false / 非布尔都收敛为关', () => {
    for (const [line, expected] of [
      ['', false],
      ['next_action_hints: false\n', false],
      ['next_action_hints: yes\n', false],
    ] as const) {
      writeSoul(line);
      expect(isNextActionsEnabled(root, USER, AGENT)).toBe(expected);
    }

    writeSoul('next_action_hints: true\n');
    expect(isNextActionsEnabled(root, USER, AGENT)).toBe(true);

    fs.rmSync(agentDir(root, USER, AGENT), { recursive: true, force: true });
    expect(isNextActionsEnabled(root, USER, AGENT)).toBe(false);
  });

  it('SC-007（修订）：关闭态 → 装配结果为 null；开启态 → 带条数上限（count 可配）', () => {
    const config = makeNextActionsConfig();

    writeSoul('');
    expect(config(USER, AGENT)).toBeNull();

    writeSoul('next_action_hints: true\n');
    expect(config(USER, AGENT)).toEqual({ enabled: true, max: 3 }); // 缺省上限

    writeSoul('next_action_hints: true\nnext_action_hints_count: 5\n');
    expect(config(USER, AGENT)).toEqual({ enabled: true, max: 5 });
  });
});
