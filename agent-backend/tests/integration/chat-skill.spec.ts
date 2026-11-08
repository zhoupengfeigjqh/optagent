/**
 * 集成测试：显式技能（`/技能名`，2026-11-07）。
 *
 * 两层：
 * 1. **公开 HTTP**：`skill` 字段受 schema 约束（未知字段仍 400），技能不存在 → 400 可读清单；
 * 2. **域链路**：`skill` 透传给 `agent.run`、**自动跳过意图聚焦**、随 user 行落盘（回放确定性）。
 *
 * 模型与聚焦判定用桩；技能目录用真实临时文件（校验读的就是它）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config';
import { agentDir } from '../../src/domain/dirs.js';
import { HistoryStore } from '../../src/domain/history.js';
import {
  RunManager,
  type AgentRunRequest,
  type RunAgentLike,
} from '../../src/domain/run-manager.js';
import type { IntentFocusPort } from '../../src/domain/intent-focus/runner.js';
import { UsageDb } from '../../src/infra/usage-db.js';
import { buildServer } from '../../src/server.js';
import type { LlmEvent } from '../../src/types.js';

const USER = 'admin';
const AGENT = 'demo';

/** 写最小可加载数字人 + 两个技能 */
function writeAgent(root: string): void {
  const dir = agentDir(root, USER, AGENT);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SOUL.md'), '你是供应商助手。\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
  fs.writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');

  const supplier = path.join(dir, 'skills', 'supplier-query');
  fs.mkdirSync(supplier, { recursive: true });
  fs.writeFileSync(
    path.join(supplier, 'SKILL.md'),
    '---\nname: supplier-query\ndescription: 当用户需要查询供应商信息时使用\n---\n正文\n',
    'utf8',
  );
  const contract = path.join(dir, 'skills', 'contract-check');
  fs.mkdirSync(contract, { recursive: true });
  fs.writeFileSync(
    path.join(contract, 'SKILL.md'),
    '---\nname: contract-check\ndescription: 当用户需要核对合同时使用\n---\n正文\n',
    'utf8',
  );
}

describe('POST /api/threads/:id/messages —— skill 字段校验', () => {
  let app: FastifyInstance;
  let root: string;

  function post(payload: Record<string, unknown>, threadId = 'th_missing') {
    return app.inject({
      method: 'POST',
      url: `/api/threads/${threadId}/messages`,
      payload,
    });
  }

  function errorCode(res: { json(): unknown }): string {
    return (res.json() as { error: { code: string } }).error.code;
  }

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-chat-skill-api-'));
    fs.mkdirSync(path.join(root, 'users', USER), { recursive: true });
    const configPath = path.join(root, 'config.yaml');
    fs.writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8');
    const config = loadConfig({
      env: { PUBLIC_BASE_URL: 'http://backend:3000', OPT_AGENT_ROOT: root },
      configPath,
    });
    writeAgent(root);
    app = await buildServer({ config });
    await app.inject({ method: 'POST', url: `/api/agents/${AGENT}/select` });
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('空白 skill → 400（不当作"没选技能"静默放过）', async () => {
    for (const bad of ['', '   ']) {
      const res = await post({ content: '你好', skill: bad });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_FAILED');
    }
  });

  it('技能不存在 → 400，文案带可用技能清单', async () => {
    const res = await post({ content: '你好', skill: 'not-exists' });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toContain('not-exists');
    expect(body.error.message).toContain('supplier-query');
  });

  it('合法技能通过校验（会话不存在时表现为 404，而不是 400）', async () => {
    const res = await post({ content: '你好', skill: 'supplier-query' });
    expect(res.statusCode).toBe(404);
    expect(errorCode(res)).toBe('THREAD_NOT_FOUND');
  });

  it('拼错字段名仍 400（additionalProperties 未被放宽）', async () => {
    const res = await post({ content: '你好', skillName: 'supplier-query' });
    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_FAILED');
  });

  it('GET /api/agents/current/skills 返回当前数字人的技能清单', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agents/current/skills' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { agent_name: string; skills: Array<{ name: string }> };
    expect(body.agent_name).toBe(AGENT);
    expect(body.skills.map((s) => s.name).sort()).toEqual(['contract-check', 'supplier-query']);
  });
});

describe('RunManager × 显式技能：透传、跳过聚焦、落盘', () => {
  let root: string;
  let usage: UsageDb;
  let history: HistoryStore;

  interface Recorder {
    skills: Array<string | undefined>;
    extras: string[];
  }

  function stubAgent(recorder: Recorder): RunAgentLike {
    return {
      key: { userId: USER, agentName: AGENT },
      activeThreads: 0,
      async *run(req: AgentRunRequest) {
        recorder.skills.push(req.skill);
        recorder.extras.push(req.systemExtra ?? '');
        yield { type: 'content_delta', delta: '本轮回答' } as LlmEvent;
        yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } } as LlmEvent;
      },
    };
  }

  /** 聚焦桩：记录 skip 入参；按真实 runner 语义——skip 时直接返回空态（不判、不产卡片） */
  function focusPort(seen: { count: number; skips: boolean[] }): IntentFocusPort {
    return {
      judge: async (input) => {
        seen.count += 1;
        seen.skips.push(input.skip);
        return input.skip ? { prompt: '', toolTips: [] } : { prompt: '聚焦提示', toolTips: [] };
      },
    };
  }

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-chat-skill-run-'));
    usage = new UsageDb(path.join(root, 'usage.db'));
    history = new HistoryStore(root);
    writeAgent(root);
  });

  afterAll(() => {
    usage.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function manager(calls: { count: number }): RunManager {
    return new RunManager({ history, usage, intentFocus: focusPort(calls) });
  }

  it('带 skill：透传给 agent.run、跳过聚焦、user 行落盘 skill', async () => {
    const seen = { count: 0, skips: [] as boolean[] };
    const recorder: Recorder = { skills: [], extras: [] };
    const run = manager(seen).startRun({
      userId: USER,
      threadId: 'th_skill',
      agent: stubAgent(recorder),
      userMessage: '查一下供应商 S-1024 的账期',
      thinking: false,
      skill: 'supplier-query',
    });
    await run.settled;

    expect(recorder.skills).toEqual(['supplier-query']);
    // 显式技能 = 自动跳过意图聚焦：runner 收到 skip=true，本轮没有任何聚焦提示
    expect(seen.skips).toEqual([true]);
    expect(recorder.extras[0]).not.toContain('聚焦提示');
    expect(history.readAll(USER, AGENT, 'th_skill')).toContainEqual(
      expect.objectContaining({ role: 'user', skill: 'supplier-query' }),
    );
  });

  it('不带 skill：聚焦照常判定，user 行不写 skill（存量行为不变）', async () => {
    const seen = { count: 0, skips: [] as boolean[] };
    const recorder: Recorder = { skills: [], extras: [] };
    const run = manager(seen).startRun({
      userId: USER,
      threadId: 'th_plain',
      agent: stubAgent(recorder),
      userMessage: '查一下供应商 S-1024 的账期',
      thinking: false,
    });
    await run.settled;

    expect(recorder.skills).toEqual([undefined]);
    expect(seen.skips).toEqual([false]);
    expect(recorder.extras[0]).toContain('聚焦提示');
    expect(history.readAll(USER, AGENT, 'th_plain')).not.toContainEqual(
      expect.objectContaining({ skill: expect.anything() }),
    );
  });
});
