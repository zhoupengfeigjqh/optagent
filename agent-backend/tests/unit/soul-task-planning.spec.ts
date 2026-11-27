import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentDir } from '../../src/domain/dirs.js';
import { isTaskPlanningEnabled, parseSoulMeta, stripFrontmatter } from '../../src/domain/soul.js';

let root: string;
const UID = 'u1';
const AGENT = '生产计划助手';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-task-planning-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeSoul(text: string): void {
  const dir = agentDir(root, UID, AGENT);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SOUL.md'), text, 'utf8');
}

describe('parseSoulMeta：task_planning', () => {
  it('显式 true 时开启', () => {
    expect(parseSoulMeta('---\ntask_planning: true\n---\n正文').taskPlanning).toBe(true);
  });

  it('缺键 / false / 非布尔一律关闭（fail-closed）', () => {
    expect(parseSoulMeta('---\nintro: 无开关\n---\n正文').taskPlanning).toBe(false);
    expect(parseSoulMeta('---\ntask_planning: false\n---\n正文').taskPlanning).toBe(false);
    expect(parseSoulMeta('---\ntask_planning: "true"\n---\n正文').taskPlanning).toBe(false);
    expect(parseSoulMeta('---\ntask_planning: 1\n---\n正文').taskPlanning).toBe(false);
  });

  it('开关不进入 System Prompt 正文', () => {
    expect(stripFrontmatter('---\ntask_planning: true\n---\n你是交付助理')).toBe('你是交付助理');
  });
});

describe('isTaskPlanningEnabled：与 intent_focus 逻辑与', () => {
  it('两个都开才为真', () => {
    writeSoul('---\nintent_focus: true\ntask_planning: true\n---\n正文');
    expect(isTaskPlanningEnabled(root, UID, AGENT)).toBe(true);
  });

  it('只开规划、聚焦关闭 → 不规划（FR-001）', () => {
    writeSoul('---\nintent_focus: false\ntask_planning: true\n---\n正文');
    expect(isTaskPlanningEnabled(root, UID, AGENT)).toBe(false);
  });

  it('只开聚焦、未勾规划 → 不规划（未勾选即零规划调用）', () => {
    writeSoul('---\nintent_focus: true\n---\n正文');
    expect(isTaskPlanningEnabled(root, UID, AGENT)).toBe(false);
  });

  it('SOUL.md 缺失 → false + 告警（不抛）', () => {
    const logger = { warn: vi.fn() };
    expect(isTaskPlanningEnabled(root, UID, AGENT, logger)).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('SOUL.md 读不出来（同路径是目录）→ false + 告警', () => {
    fs.mkdirSync(path.join(agentDir(root, UID, AGENT), 'SOUL.md'), { recursive: true });
    const logger = { warn: vi.fn() };
    expect(isTaskPlanningEnabled(root, UID, AGENT, logger)).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });
});
