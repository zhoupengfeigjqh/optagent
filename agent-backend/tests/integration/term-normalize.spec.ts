/**
 * 集成测试：术语替换（018）端到端。
 *
 * 分两层：
 * 1. **公开 HTTP**：`POST /api/term-normalize` 的开关门控、字典合并、降级与严格字段；
 * 2. **域链路**：`original_content` 让「模型看替换文、历史留原话」两件事同时成立。
 *
 * 术语表用真实临时文件（与部署产物同形），不 mock 读盘。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../../src/config.js';
import type { AppContext } from '../../src/context.js';
import { agentDir, threadDir } from '../../src/domain/dirs.js';
import { HistoryStore } from '../../src/domain/history.js';
import { RunManager, type AgentRunRequest, type RunAgentLike } from '../../src/domain/run-manager.js';
import { UsageDb } from '../../src/infra/usage-db.js';
import { buildServer } from '../../src/server.js';
import type { LlmEvent } from '../../src/types.js';

const USER = 'admin';
const AGENT = 'demo';

function soulOf(focus: boolean, term: boolean): string {
  const lines = ['soul_version: 1'];
  if (focus) lines.push('intent_focus: true');
  if (term) lines.push('term_normalize: true');
  return `---\n${lines.join('\n')}\n---\n\n## 主要使命\n\n你是助手。\n`;
}

const TABLE = {
  供应商信息: '供应商或供应商编号',
  物料: '原材料',
};

function writeAgent(root: string, name: string, options: {
  focus: boolean;
  term?: boolean;
  tables?: Record<string, Record<string, string>>;
  broken?: boolean;
}): void {
  const dir = agentDir(root, USER, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SOUL.md'),
    soulOf(options.focus, options.term ?? options.focus),
    'utf8',
  );
  fs.writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
  fs.writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');
  for (const [ref, table] of Object.entries(options.tables ?? {})) {
    const target = path.join(dir, 'ontology', ...ref.split('/'));
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(
      path.join(target, 'term_mapping.json'),
      options.broken ? '{ not json' : `${JSON.stringify(table, null, 2)}\n`,
      'utf8',
    );
  }
}

describe('POST /api/term-normalize', () => {
  let app: FastifyInstance;
  let root: string;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-term-normalize-'));
    fs.mkdirSync(path.join(root, 'users', USER), { recursive: true });
    const configPath = path.join(root, 'config.yaml');
    fs.writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8');
    app = await buildServer({
      config: loadConfig({
        env: { PUBLIC_BASE_URL: 'http://backend:3000', OPT_AGENT_ROOT: root },
        configPath,
      }),
    });

    writeAgent(root, AGENT, {
      focus: true,
      tables: {
        '生产调度/原材料采购和库存': TABLE,
        '生产调度/供应商档案': { 供应商信息: '供应方' },
      },
    });
    // 开关关：有一模一样的字典，但不得被读取
    writeAgent(root, 'off', { focus: false, tables: { '生产调度/供应商档案': TABLE } });
    writeAgent(root, 'empty', { focus: true });
    // 坏 JSON：降级为未替换 + warning
    writeAgent(root, 'broken', {
      focus: true,
      tables: { '生产调度/供应商档案': { 供应商信息: '供应方' } },
      broken: true,
    });
    writeAgent(root, 'focus-only', {
      focus: true,
      term: false,
      tables: { '生产调度/供应商档案': { 供应商信息: '供应方' } },
      broken: true,
    });
    writeAgent(root, 'term-only', {
      focus: false,
      term: true,
      tables: { '生产调度/供应商档案': { 供应商信息: '供应方' } },
      broken: true,
    });
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function select(name: string) {
    return app.inject({ method: 'POST', url: `/api/agents/${encodeURIComponent(name)}/select` });
  }

  function normalize(content: string) {
    return app.inject({ method: 'POST', url: '/api/term-normalize', payload: { content } });
  }

  it('未选中数字人 → 409（与其余请求同源判定）', async () => {
    const res = await normalize('帮我看下物料');
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('AGENT_NOT_SELECTED');
  });

  it('开关开：按最长优先替换，跨本体同名 key 的 value 用「或」合并', async () => {
    await select(AGENT);
    const res = await normalize('帮我看下供应商信息的物料库存');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      applied: true,
      original: '帮我看下供应商信息的物料库存',
      normalized: '帮我看下供应方或供应商或供应商编号的原材料库存',
      matches: [
        { term: '供应商信息', value: '供应方或供应商或供应商编号', start: 4, end: 9 },
        { term: '物料', value: '原材料', start: 10, end: 12 },
      ],
    });
  });

  it('无命中 / 命中即同值 → applied:false，原文逐字返回', async () => {
    await select(AGENT);
    const res = await normalize('今天天气怎么样');
    expect(res.json()).toEqual({
      applied: false,
      original: '今天天气怎么样',
      normalized: '今天天气怎么样',
      matches: [],
    });
  });

  it('意图聚焦关闭 → 不读字典，直接原文返回', async () => {
    await select('off');
    const res = await normalize('帮我看下供应商信息的物料');
    expect(res.json()).toMatchObject({ applied: false, normalized: '帮我看下供应商信息的物料' });
  });

  it('027：意图聚焦开、术语替换关 → 原文返回，且**不读字典**（坏字典也不告警）', async () => {
    await select('focus-only');
    const warn = vi.spyOn((app as unknown as { ctx: AppContext }).ctx.loggers.logger, 'warn');
    try {
      const res = await normalize('帮我看下供应商信息');
      expect(res.json()).toMatchObject({ applied: false, normalized: '帮我看下供应商信息' });
      expect(warn).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: 'term_normalize.degraded' }),
        expect.any(String),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('027：术语替换开、意图聚焦关 → 仍不替换（两个开关是逻辑与）', async () => {
    await select('term-only');
    const warn = vi.spyOn((app as unknown as { ctx: AppContext }).ctx.loggers.logger, 'warn');
    try {
      const res = await normalize('帮我看下供应商信息');
      expect(res.json()).toMatchObject({ applied: false, normalized: '帮我看下供应商信息' });
      expect(warn).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: 'term_normalize.degraded' }),
        expect.any(String),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('没有任何字典文件 → 原文返回（不是错误）', async () => {
    await select('empty');
    const res = await normalize('帮我看下物料');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ applied: false });
  });

  it('字典非法 → 降级为原文返回，并记结构化 warning', async () => {
    await select('broken');
    const warn = vi.spyOn((app as unknown as { ctx: AppContext }).ctx.loggers.logger, 'warn');
    try {
      const res = await normalize('帮我看下供应商信息');
      expect(res.json()).toMatchObject({ applied: false });
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'term_normalize.degraded' }),
        expect.any(String),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('请求体严格：额外字段 / 空正文 → 400', async () => {
    await select(AGENT);
    const extra = await app.inject({
      method: 'POST',
      url: '/api/term-normalize',
      payload: { content: '你好', normalized: '改过的' },
    });
    expect(extra.statusCode).toBe(400);
    const empty = await app.inject({
      method: 'POST',
      url: '/api/term-normalize',
      payload: { content: '' },
    });
    expect(empty.statusCode).toBe(400);
  });
});

describe('RunManager × original_content：模型看替换文、历史留原话', () => {
  let root: string;
  let usage: UsageDb;
  let history: HistoryStore;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-term-history-'));
    usage = new UsageDb(path.join(root, 'usage.db'));
    history = new HistoryStore(root);
  });

  afterAll(() => {
    usage.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function stubAgent(seen: string[]): RunAgentLike {
    return {
      key: { userId: USER, agentName: AGENT },
      activeThreads: 0,
      async *run(req: AgentRunRequest) {
        for (const message of req.messages ?? []) {
          if (message.role === 'user') seen.push(message.content);
        }
        yield { type: 'content_delta', delta: '好的' } as LlmEvent;
        yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } } as LlmEvent;
      },
    };
  }

  function historyText(threadId: string): string {
    const file = path.join(threadDir(root, USER, AGENT, threadId), 'history.jsonl');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  }

  it('userMessage=替换文、displayContent=原话：模型收替换文，落盘是原话', async () => {
    const seen: string[] = [];
    const manager = new RunManager({ history, usage });
    const run = manager.startRun({
      userId: USER,
      threadId: 'th_term',
      agent: stubAgent(seen),
      userMessage: '帮我看下供应商或供应商编号的原材料库存',
      displayContent: '帮我看下供应商信息的物料库存',
      thinking: false,
    });
    await run.settled;

    expect(seen).toEqual(['帮我看下供应商或供应商编号的原材料库存']);
    const text = historyText('th_term');
    expect(text).toContain('帮我看下供应商信息的物料库存');
    expect(text).not.toContain('供应商或供应商编号的原材料库存');
  });

  it('缺省 displayContent → 两者同一文本（未替换轮次行为不变）', async () => {
    const seen: string[] = [];
    const manager = new RunManager({ history, usage });
    const run = manager.startRun({
      userId: USER,
      threadId: 'th_plain',
      agent: stubAgent(seen),
      userMessage: '原样一句话',
      thinking: false,
    });
    await run.settled;

    expect(seen).toEqual(['原样一句话']);
    expect(historyText('th_plain')).toContain('原样一句话');
  });
});
