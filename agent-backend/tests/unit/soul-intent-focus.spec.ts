/**
 * 单元测试：SOUL 的「意图聚焦」开关（013）。
 *
 * 守住三条口径：
 * - 开关是**功能开关**，缺键 / 非布尔一律 false（fail-closed，与 007 同构）；
 * - 读取失败（文件缺失 / YAML 非法）→ false + 告警，绝不因配置读不出来就多发一次判定；
 * - 该键**不进 System Prompt 正文**（`stripFrontmatter` 结果逐字不变）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentDir } from '../../src/domain/dirs.js';
import { isIntentFocusEnabled, parseSoulMeta, stripFrontmatter } from '../../src/domain/soul.js';

let root: string;
const UID = 'u1';
const AGENT = '生产计划助手';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-intent-focus-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeSoul(text: string): void {
  const dir = agentDir(root, UID, AGENT);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SOUL.md'), text, 'utf8');
}

describe('parseSoulMeta：intent_focus', () => {
  it('true 时开启', () => {
    expect(parseSoulMeta('---\nintent_focus: true\n---\n正文').intentFocus).toBe(true);
  });

  it('缺键 / false / 非布尔 → 一律关闭（fail-closed）', () => {
    expect(parseSoulMeta('---\nintro: 无开关\n---\n正文').intentFocus).toBe(false);
    expect(parseSoulMeta('---\nintent_focus: false\n---\n正文').intentFocus).toBe(false);
    expect(parseSoulMeta('---\nintent_focus: "yes"\n---\n正文').intentFocus).toBe(false);
    expect(parseSoulMeta('---\nintent_focus: 1\n---\n正文').intentFocus).toBe(false);
  });

  it('开关不进入 System Prompt 正文', () => {
    const raw = '---\nintent_focus: true\n---\n你是交付助理';
    expect(stripFrontmatter(raw)).toBe('你是交付助理');
  });
});

describe('isIntentFocusEnabled：读盘口径', () => {
  it('开启时返回 true', () => {
    writeSoul('---\nintent_focus: true\n---\n正文');
    expect(isIntentFocusEnabled(root, UID, AGENT)).toBe(true);
  });

  it('SOUL.md 缺失 → false 且告警', () => {
    const warnings: string[] = [];
    const enabled = isIntentFocusEnabled(root, UID, AGENT, { warn: (m) => warnings.push(m) });
    expect(enabled).toBe(false);
    expect(warnings).toHaveLength(1);
  });

  it('YAML 非法 → false（解析降级，不抛错也不告警，与 007 同口径）', () => {
    const warnings: string[] = [];
    writeSoul('---\nintent_focus: [未闭合\n---\n正文');
    expect(isIntentFocusEnabled(root, UID, AGENT, { warn: (m) => warnings.push(m) })).toBe(false);
    expect(warnings).toHaveLength(0);
  });
});
