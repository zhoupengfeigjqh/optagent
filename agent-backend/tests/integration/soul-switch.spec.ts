/**
 * 集成测试：`SOUL.md` 开关的端到端口径（007 修订 · Tail Protocol · FR-035 / SC-007）。
 *
 * 这里跑的是**真实链路**：真实 `SOUL.md` 文件 → `loadAgentConfig` 解析 → 开关读取
 * （`isNextActionsEnabled`）→ `RunManager.nextActionsConfig` 的真实装配语义（与 `server.ts`
 * 逐字同构的闭包）。修订后卡片与回答同流产出，"开关门控"收敛为提示词装配期一件事：
 *
 * - **FR-035（System Prompt 恒等）**：开关开 / 关两态，`loadAgentConfig.systemPrompt` MUST
 *   逐字一致（尾部块指令是运行期按开关**追加**的，不写进固化 System Prompt）；
 * - **SC-007（关闭即零成本）**：关闭态 `nextActionsConfig` 返回 `null` → 请求不带
 *   `nextActionsMax`（不追加指令、模型不感知协议）→ 收尾不定稿卡片；
 *   开启态返回真实条数上限（`next_action_hints_count`，缺省 3）。
 *
 * 与 `tests/unit/next-actions.spec.ts` 的分工：那边用**注入的**桩覆盖判定分支，
 * 这边用**磁盘上的真实文件**验证"写进 SOUL.md 的开关真的被读到"。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAgentConfig } from '../../src/domain/agent-instance.js';
import { agentDir } from '../../src/domain/dirs.js';
import { isNextActionsEnabled, nextActionHintsCount } from '../../src/domain/soul.js';

/**
 * 两态共用的 SOUL 正文：这段就是 `systemPrompt`（`loadAgentConfig` 会 trim 首尾空白），
 * MUST 不因开关而变。
 */
const BODY = '## 主要使命\n\n你是交付助理，帮助业务人员排查订单风险。';

const USER = 'admin';
const AGENT = 'demo';

let root: string;

/** 按给定开关行写一套数字人配置（SOUL.md 与 `admin-backend` 的 `renderSoulMd` 产物同形） */
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

/** 与 `server.ts` 逐字同构的装配闭包：开关与条数逐次现读 */
function makeNextActionsConfig(): (userId: string, agentName: string) => { enabled: boolean; max: number } | null {
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
    // 开关本身不出现在任何一态的系统提示词里
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

    // SOUL.md 读不出来（目录被删）→ 关，且不抛错
    fs.rmSync(agentDir(root, USER, AGENT), { recursive: true, force: true });
    expect(isNextActionsEnabled(root, USER, AGENT)).toBe(false);
  });

  it('SC-007（修订）：关闭态 → 装配结果为 null；开启态 → 带条数上限（count 可配）', () => {
    const config = makeNextActionsConfig();

    writeSoul('');
    expect(config(USER, AGENT)).toBeNull(); // 不追加指令、收尾不定稿卡片

    writeSoul('next_action_hints: true\n');
    expect(config(USER, AGENT)).toEqual({ enabled: true, max: 3 }); // 缺省上限

    writeSoul('next_action_hints: true\nnext_action_hints_count: 5\n');
    expect(config(USER, AGENT)).toEqual({ enabled: true, max: 5 });
  });
});
