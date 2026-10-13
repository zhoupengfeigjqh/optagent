/**
 * 单元测试：SOUL 结构化解析与 System Prompt 分区（004）。
 *
 * 守住四条口径：
 * - 无 frontmatter（存量旧文档）→ 正文即全文，**System Prompt 逐字不变**；
 * - 有头无尾 / YAML 非法 → 按"无 frontmatter"降级，**绝不吞配置**；
 * - 展示数据只从 frontmatter 取，正文里的同名内容不算数（避免污染进模型）；
 * - 端到端：`loadAgentConfig` 的 `systemPrompt` **不含** frontmatter 里的展示数据。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentConfigError, loadAgentConfig } from '../../src/domain/agent-instance.js';
import {
  buildStarterGuidance,
  emptySoulMeta,
  isNextActionsEnabled,
  nextActionHintsCount,
  parseExposedName,
  parseSoulMeta,
  stripFrontmatter,
  toolExposedName,
  type SoulToolRef,
} from '../../src/domain/soul.js';

const STRUCTURED = `---
soul_version: 1
intro: 专注订单交付的助理
welcome: 你好，我是交付助理
starters:
  - prompt: 帮我梳理昨天订单的交付风险
    tools:
      - kind: builtin
        name: read_file
      - kind: mcp
        service: erp
        name: query_order
  - prompt: 这个月哪些订单可能延期？
---

## 主要使命

你是交付助理。

## 绝对禁止
- 不得编造订单号
`;

describe('stripFrontmatter', () => {
  it('去掉 frontmatter，只留正文（= 进模型的提示词）', () => {
    const body = stripFrontmatter(STRUCTURED);
    expect(body.startsWith('\n## 主要使命')).toBe(true);
    expect(body).not.toContain('intro:');
    expect(body).not.toContain('welcome:');
    expect(body).not.toContain('starters:');
    // 正文里该进模型的部分一字不少
    expect(body).toContain('你是交付助理。');
    expect(body).toContain('- 不得编造订单号');
  });

  it('存量旧文档（无 frontmatter）原样返回 —— System Prompt 逐字不变', () => {
    const legacy = '# 生产计划助手\n\n你是助手。';
    expect(stripFrontmatter(legacy)).toBe(legacy);
  });

  it('有头无尾 → 视为无 frontmatter，整篇当正文（不吞配置）', () => {
    const broken = '---\nintro: x\n\n## 主要使命\n正文';
    expect(stripFrontmatter(broken)).toBe(broken);
  });

  it('正文里的水平线不会被误判为 frontmatter 起点', () => {
    const text = '正文第一段\n\n---\n\n正文第二段';
    expect(stripFrontmatter(text)).toBe(text);
  });
});

describe('parseSoulMeta', () => {
  it('解析 intro / welcome / starters（含工具引用）', () => {
    const meta = parseSoulMeta(STRUCTURED);
    expect(meta.intro).toBe('专注订单交付的助理');
    expect(meta.welcome).toBe('你好，我是交付助理');
    expect(meta.starters).toHaveLength(2);
    expect(meta.starters[0]?.tools).toEqual([
      { kind: 'builtin', name: 'read_file' },
      { kind: 'mcp', service: 'erp', name: 'query_order' },
    ]);
    expect(meta.starters[1]?.tools).toEqual([]);
  });

  it('旧文档 / YAML 非法 → 空值降级（不抛错）', () => {
    expect(parseSoulMeta('# 旧 SOUL')).toEqual(emptySoulMeta());
    expect(parseSoulMeta('---\nintro: [未闭合\n---\n正文')).toEqual(emptySoulMeta());
  });

  it('007：next_action_hints 仅在显式 true 时为开，其余一律关（fail-closed）', () => {
    const withKey = (value: string) => parseSoulMeta(`---\nnext_action_hints: ${value}\n---\n正文`);
    expect(withKey('true').nextActionHints).toBe(true);
    expect(withKey('false').nextActionHints).toBe(false);
    // 非布尔（字符串 "yes" / 数字 / null）不给"看起来像真"的机会
    expect(withKey('yes').nextActionHints).toBe(false);
    expect(withKey('1').nextActionHints).toBe(false);
    expect(withKey('null').nextActionHints).toBe(false);
    // 键缺失
    expect(parseSoulMeta('---\nintro: x\n---\n正文').nextActionHints).toBe(false);
  });

  it('007：next_action_hints_count 合法整数原样读，缺省 / 坏值收敛到 3', () => {
    const withCount = (value: string) =>
      parseSoulMeta(`---\nnext_action_hints_count: ${value}\n---\n正文`).nextActionHintsCount;

    expect(withCount('1')).toBe(1);
    expect(withCount('6')).toBe(6);
    expect(withCount('3')).toBe(3);
    // 键缺失
    expect(parseSoulMeta('---\nintro: x\n---\n正文').nextActionHintsCount).toBe(3);
    // 越界 / 小数 / 非数字 / null / 布尔 → 缺省（收敛式，不抛错）
    expect(withCount('0')).toBe(3);
    expect(withCount('7')).toBe(3);
    expect(withCount('2.5')).toBe(3);
    expect(withCount('"3"')).toBe(3);
    expect(withCount('null')).toBe(3);
    expect(withCount('true')).toBe(3);
  });

  it('残缺条目与未知工具类型被跳过，不影响其余项', () => {
    const meta = parseSoulMeta(`---
starters:
  - prompt: 正常问题
  - tools: []
  - prompt: '   '
  - prompt: 另一个问题
    tools:
      - kind: mcp
        name: no_service
      - kind: unknown
        name: x
---
正文
`);
    expect(meta.starters.map((s) => s.prompt)).toEqual(['正常问题', '另一个问题']);
    // MCP 缺服务名、未知 kind 都不算有效工具引用
    expect(meta.starters[1]?.tools).toEqual([]);
  });
});

describe('工具引导', () => {
  it('MCP 工具带服务前缀（与 mcp-tool-adapter 同口径）', () => {
    expect(toolExposedName({ kind: 'builtin', name: 'read_file' })).toBe('read_file');
    expect(toolExposedName({ kind: 'mcp', service: 'erp', name: 'query_order' })).toBe(
      'erp__query_order',
    );
  });

  it('无关联工具时不下发引导（空串，避免白占 token）', () => {
    expect(buildStarterGuidance([])).toBe('');
    expect(buildStarterGuidance([{ kind: 'builtin', name: 'read_file' }])).toContain('read_file');
  });
});

describe('parseExposedName —— toolExposedName 的逆（007 实测补齐）', () => {
  it('与 `toolExposedName` 互为往返（改任一侧此断言必红）', () => {
    const refs: SoulToolRef[] = [
      { kind: 'builtin', name: 'read_file' },
      { kind: 'builtin', name: 'list_dir' },
      { kind: 'mcp', service: 'erp', name: 'query_order' },
      { kind: 'mcp', service: 'hd-algorithm', name: 'hd_algorithm_input_parser' },
      // 工具名自身含下划线（MCP 工具常见），必须在**第一个** `__` 处切分
      { kind: 'mcp', service: 'hd-algorithm', name: 'hd_scheduling_submit' },
    ];

    for (const ref of refs) {
      expect(parseExposedName(toolExposedName(ref))).toEqual(ref);
    }
  });

  it('无 `__` / 分隔符在首尾 / 空串 → 内置工具（内置名不含 `__`）', () => {
    expect(parseExposedName('read_file')).toEqual({ kind: 'builtin', name: 'read_file' });
    expect(parseExposedName('__x')).toEqual({ kind: 'builtin', name: '__x' });
    expect(parseExposedName('x__')).toEqual({ kind: 'builtin', name: 'x__' });
    expect(parseExposedName('  ')).toEqual({ kind: 'builtin', name: '' });
  });

  it('真实产物口径：模型把 MCP 写成 builtin + 暴露名，还原为 `kind: mcp`', () => {
    // 取自线上快照 `next-actions.json`：`{ kind: 'builtin', name: 'hd-algorithm__hd_algorithm_input_parser' }`
    expect(parseExposedName('hd-algorithm__hd_algorithm_input_parser')).toEqual({
      kind: 'mcp',
      service: 'hd-algorithm',
      name: 'hd_algorithm_input_parser',
    });
  });
});

describe('isNextActionsEnabled —— SOUL.md 开关读取（007）', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-switch-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeSoul(userId: string, name: string, soul: string): void {
    const dir = path.join(root, 'users', userId, 'agents', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SOUL.md'), soul, 'utf8');
  }

  it('frontmatter 为 true → 开；false / 无键 → 关', () => {
    writeSoul('u1', 'on', '---\nnext_action_hints: true\n---\n正文');
    writeSoul('u1', 'off', '---\nnext_action_hints: false\n---\n正文');
    writeSoul('u1', 'legacy', '# 旧文档\n\n正文');
    expect(isNextActionsEnabled(root, 'u1', 'on')).toBe(true);
    expect(isNextActionsEnabled(root, 'u1', 'off')).toBe(false);
    expect(isNextActionsEnabled(root, 'u1', 'legacy')).toBe(false);
    // 不同用户互不串味（目录按用户与数字人两级定位）
    expect(isNextActionsEnabled(root, 'u2', 'on')).toBe(false);
  });

  it('文件缺失 / YAML 非法 / 非布尔 → 关，并各有一条告警', () => {
    const warns: string[] = [];
    const logger = { warn: (msg: string) => warns.push(msg) };
    writeSoul('u1', 'broken', '---\nnext_action_hints: [未闭合\n---\n正文');
    writeSoul('u1', 'wrongtype', '---\nnext_action_hints: yes\n---\n正文');

    expect(isNextActionsEnabled(root, 'u1', 'missing', logger)).toBe(false);
    expect(isNextActionsEnabled(root, 'u1', 'broken', logger)).toBe(false);
    expect(isNextActionsEnabled(root, 'u1', 'wrongtype', logger)).toBe(false);
    // 只有"读不出来"才告警；非布尔是配置写错但读得到，不产生噪音
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('u1');
  });
});

describe('nextActionHintsCount —— SOUL.md 条数读取（007）', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-count-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeSoul(userId: string, name: string, soul: string): void {
    const dir = path.join(root, 'users', userId, 'agents', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SOUL.md'), soul, 'utf8');
  }

  it('合法整数原样读；无键 / 坏值收敛到缺省 3（与开关的 fail-closed 不同：条数读不到按缺省走）', () => {
    writeSoul('u1', 'five', '---\nnext_action_hints_count: 5\n---\n正文');
    writeSoul('u1', 'broken', '---\nnext_action_hints_count: 99\n---\n正文');
    writeSoul('u1', 'legacy', '# 旧文档\n\n正文');

    expect(nextActionHintsCount(root, 'u1', 'five')).toBe(5);
    expect(nextActionHintsCount(root, 'u1', 'broken')).toBe(3);
    expect(nextActionHintsCount(root, 'u1', 'legacy')).toBe(3);
  });

  it('文件缺失 → 缺省 3 并告警（不抛错、不把条数降成 0）', () => {
    const warns: string[] = [];
    const logger = { warn: (msg: string) => warns.push(msg) };

    expect(nextActionHintsCount(root, 'u1', 'missing', logger)).toBe(3);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('u1');
  });
});

describe('loadAgentConfig —— frontmatter 不进 System Prompt（004）', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** 写一个最小可加载的数字人目录（SOUL/TOOL/MCP 三件套） */
  function writeAgent(name: string, soul: string): string {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SOUL.md'), soul, 'utf8');
    fs.writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
    fs.writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');
    return dir;
  }

  it('结构化 SOUL.md → System Prompt 只含正文（展示数据不进模型）', () => {
    const dir = writeAgent(
      'structured',
      [
        '---',
        'soul_version: 1',
        'intro: 只看前台的角色简介',
        'welcome: 只看前台的欢迎语',
        '---',
        '',
        '## 主要使命',
        '',
        '你是结构化助手。',
        '',
      ].join('\n'),
    );

    const bundle = loadAgentConfig(dir);
    expect(bundle.systemPrompt).toContain('你是结构化助手。');
    expect(bundle.systemPrompt).not.toContain('只看前台');
    expect(bundle.systemPrompt).not.toContain('soul_version');
  });

  it('仅有 frontmatter、正文为空 → 配置错误（不给模型一个空提示词）', () => {
    const dir = writeAgent('empty-body', '---\nintro: x\n---\n');
    expect(() => loadAgentConfig(dir)).toThrow(AgentConfigError);
  });
});
