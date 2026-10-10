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
  parseSoulMeta,
  stripFrontmatter,
  toolExposedName,
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
    expect(parseSoulMeta('# 旧 SOUL')).toEqual({ intro: '', welcome: '', starters: [] });
    expect(parseSoulMeta('---\nintro: [未闭合\n---\n正文')).toEqual({
      intro: '',
      welcome: '',
      starters: [],
    });
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
