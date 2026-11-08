/**
 * 集成测试：意图聚焦（016）端到端链路。
 *
 * 分两层：
 * 1. **公开 HTTP**：`skip_intent_focus` 新增字段不得放宽 `additionalProperties`；
 * 2. **域链路**（真实 `RunManager` + 真实 `IntentFocusRunner` + 真实留档 + 真实 SOUL）：
 *    判定先于主模型、提示只进本轮 `systemExtra`、五态留档、跳过零调用、关闭零成本。
 *
 * 模型与 Laya 用桩；技能 / 本体用真实临时文件。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig, type IntentFocusConfig } from '../../src/config';
import type { AppContext } from '../../src/context.js';
import { agentDir, threadDir } from '../../src/domain/dirs.js';
import { HistoryStore } from '../../src/domain/history.js';
import { IntentFocusRunner } from '../../src/domain/intent-focus/runner.js';
import { IntentFocusStore } from '../../src/domain/intent-focus/store.js';
import {
  RunManager,
  type AgentRunRequest,
  type RunAgentLike,
} from '../../src/domain/run-manager.js';
import {
  isIntentFocusEnabled,
  isNextActionsEnabled,
  nextActionHintsCount,
} from '../../src/domain/soul.js';
import type { LayaDecideResult } from '../../src/infra/laya-client.js';
import { UsageDb } from '../../src/infra/usage-db.js';
import { buildServer } from '../../src/server.js';
import type { LlmEvent } from '../../src/types.js';

const USER = 'admin';
const AGENT = 'demo';
const PREFIX = '本轮的任务与以下技能、本体概念与本体行为密切相关，请重点关注（仅供参考，不必局限）';

const CONFIG: IntentFocusConfig = {
  baseUrl: 'http://laya:8000',
  model: 'laya-multilingual',
  apiKey: 'dev-key',
  timeoutMs: 10_000,
  skillThreshold: 0.6,
  ontologyThreshold: 0.6,
  maxSkills: 32,
  maxCapabilities: 96,
};

const ONTOLOGY_YAML = [
  'metadata:',
  '  ontology_id: 1',
  '  ontology_name: 原材料采购和库存',
  '  scenario_id: 2',
  '  scenario_name: 生产调度',
  'functions:',
  '  - name: F1',
  '    title: 校验采购单位一致性',
  'behaviors:',
  '  - name: B1',
  '    title: 创建采购单',
  '    op_type: command',
  '  - name: Q1',
  '    title: 查询采购记录',
  '    op_type: query',
  '  - name: Q2',
  '    title: 查询原材料',
  '    op_type: query',
  'rules:',
  '  - behavior: B1',
  '    data_supplements: [Q1, Q2]',
].join('\n');

/** 判定桩：按题面里的名字给分，并记录调用 */
function makeClient(result?: LayaDecideResult) {
  const calls: Array<{ state: string; questionCount: number }> = [];
  return {
    calls,
    decide: async (state: string, questions: Record<string, { instructions: string }>) => {
      calls.push({ state, questionCount: Object.keys(questions).length });
      if (result) return result;
      const scores: Record<string, number> = {};
      for (const [qid, question] of Object.entries(questions)) {
        const text = question.instructions;
        if (text.includes('原材料采购和库存本体技能')) scores[qid] = 0.9;
        else if (text.includes('普通技能')) scores[qid] = 0.2;
        else if (text.includes('创建采购单')) scores[qid] = 0.9;
        else if (text.includes('校验采购单位一致性')) scores[qid] = 0.7;
        else scores[qid] = 0.05;
      }
      return { ok: true as const, scores, model: 'laya-multilingual' };
    },
  };
}

interface Recorder {
  /** 本轮收到的 `systemExtra`（聚焦提示应只出现在这里） */
  extras: string[];
  /** 本轮收到的消息条数（用于确认提示不进 messages） */
  messageCounts: number[];
}

/** 假数字人：`run-consume` 已完成判定，这里只记录本轮素材 */
function stubAgent(recorder: Recorder): RunAgentLike {
  return {
    key: { userId: USER, agentName: AGENT },
    activeThreads: 0,
    async *run(req: AgentRunRequest) {
      recorder.extras.push(req.systemExtra ?? '');
      recorder.messageCounts.push(req.messages?.length ?? 0);
      yield { type: 'content_delta', delta: '本轮回答' } as LlmEvent;
      yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } } as LlmEvent;
    },
  };
}

describe('POST /api/threads/:id/messages —— skip_intent_focus 校验', () => {
  let app: FastifyInstance;
  let root: string;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-intent-focus-api-'));
    fs.mkdirSync(path.join(root, 'users', USER), { recursive: true });
    const configPath = path.join(root, 'config.yaml');
    fs.writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8');
    const config = loadConfig({
      env: { PUBLIC_BASE_URL: 'http://backend:3000', OPT_AGENT_ROOT: root },
      configPath,
    });

    const dir = agentDir(root, USER, AGENT);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SOUL.md'), '你是助手。\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
    fs.writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');

    app = await buildServer({ config });
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function ctx(): AppContext {
    return (app as unknown as { ctx: AppContext }).ctx;
  }

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

  it('非布尔值 → 400（不静默转成 true / false）', async () => {
    await app.inject({ method: 'POST', url: `/api/agents/${AGENT}/select` });
    for (const bad of ['true', 1, null]) {
      const res = await post({ content: '你好', skip_intent_focus: bad });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_FAILED');
    }
  });

  it('拼错字段名 → 400（schema 未被放宽）', async () => {
    await app.inject({ method: 'POST', url: `/api/agents/${AGENT}/select` });
    const res = await post({ content: '你好', skipIntentFocus: true });
    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_FAILED');
  });

  it('合法布尔通过校验（会话不存在时表现为 404，而不是 400）', async () => {
    await app.inject({ method: 'POST', url: `/api/agents/${AGENT}/select` });
    const res = await post({ content: '你好', skip_intent_focus: true });
    expect(res.statusCode).toBe(404);
    expect(errorCode(res)).toBe('THREAD_NOT_FOUND');
  });

  it('缺省该字段仍是合法请求', async () => {
    await app.inject({ method: 'POST', url: `/api/agents/${AGENT}/select` });
    const res = await post({ content: '你好' });
    expect(res.statusCode).toBe(404);
    expect(errorCode(res)).toBe('THREAD_NOT_FOUND');
  });

  it('未选中数字人时仍是 409（校验顺序未被本字段改变）', async () => {
    const thread = ctx().threadStore.create(USER, AGENT);
    ctx().currentAgent.exit(USER);
    const res = await post({ content: '你好', skip_intent_focus: true }, thread.threadId);
    expect(res.statusCode).toBe(409);
  });
});

describe('RunManager × 意图聚焦：时序、跳过、降级与留档', () => {
  let root: string;
  let usage: UsageDb;
  let history: HistoryStore;
  let store: IntentFocusStore;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-intent-focus-run-'));
  });

  afterAll(() => {
    usage?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function freshRoot(): void {
    usage?.close();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-intent-focus-run-'));
    usage = new UsageDb(path.join(root, 'usage.db'));
    history = new HistoryStore(root);
    store = new IntentFocusStore(root);
  }

  /** 按部署产物形态写数字人：SOUL 开关 + TOOL/MCP + 技能 + 本体 */
  function writeAgent(focus: boolean, hints = false, withOntology = true): void {
    const dir = agentDir(root, USER, AGENT);
    fs.mkdirSync(dir, { recursive: true });
    const lines = ['soul_version: 1'];
    if (hints) lines.push('next_action_hints: true', 'next_action_hints_count: 3');
    if (focus) lines.push('intent_focus: true');
    fs.writeFileSync(
      path.join(dir, 'SOUL.md'),
      `---\n${lines.join('\n')}\n---\n\n## 主要使命\n\n你是助手。\n`,
      'utf8',
    );
    fs.writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
    fs.writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');

    const skillDir = path.join(dir, 'skills', 'onto');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: onto-skill\ndescription: 原材料采购和库存本体技能\nmetadata:\n  ontology_id: 1\n  ontology_name: 原材料采购和库存\n  scenario_id: 2\n  scenario_name: 生产调度\n---\n',
      'utf8',
    );
    const plainDir = path.join(dir, 'skills', 'plain');
    fs.mkdirSync(plainDir, { recursive: true });
    fs.writeFileSync(
      path.join(plainDir, 'SKILL.md'),
      '---\nname: plain-skill\ndescription: 普通技能\n---\n',
      'utf8',
    );

    if (withOntology) {
      const ontoDir = path.join(dir, 'ontology', '生产调度', '原材料采购和库存');
      fs.mkdirSync(ontoDir, { recursive: true });
      fs.writeFileSync(path.join(ontoDir, 'ontology.yaml'), ONTOLOGY_YAML, 'utf8');
    }
  }

  function makeRunner(client: { decide: ReturnType<typeof makeClient>['decide'] }, withConfig = true) {
    return new IntentFocusRunner({
      root,
      ...(withConfig ? { config: CONFIG } : {}),
      client,
      store,
      isEnabled: (userId, agentName) => isIntentFocusEnabled(root, userId, agentName),
    });
  }

  function managerWith(port?: ReturnType<typeof makeRunner>): RunManager {
    return new RunManager({
      history,
      usage,
      ...(port ? { intentFocus: port } : {}),
    });
  }

  function start(
    manager: RunManager,
    recorder: Recorder,
    options: { skipIntentFocus?: boolean; guidance?: string; threadId?: string } = {},
  ) {
    return manager.startRun({
      userId: USER,
      threadId: options.threadId ?? 'th_1',
      agent: stubAgent(recorder),
      userMessage: '帮我创建一笔原材料采购单',
      thinking: false,
      ...(options.guidance !== undefined ? { guidance: options.guidance } : {}),
      ...(options.skipIntentFocus === true ? { skipIntentFocus: true } : {}),
    });
  }

  function records(threadId = 'th_1') {
    return store.readAll(USER, AGENT, threadId);
  }

  function historyText(threadId = 'th_1'): string {
    const file = path.join(threadDir(root, USER, AGENT, threadId), 'history.jsonl');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  }

  it('手输轮次：技能 + 能力两次判定，提示进本轮 systemExtra，留档 focused', async () => {
    freshRoot();
    writeAgent(true);
    const client = makeClient();
    const recorder: Recorder = { extras: [], messageCounts: [] };
    const manager = managerWith(makeRunner(client));

    const run = start(manager, recorder);
    await run.settled;

    // 两次判定：技能一批、能力一批；输入是本轮用户输入原文
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]!.state).toBe('帮我创建一笔原材料采购单');
    expect(recorder.extras).toHaveLength(1);
    expect(recorder.extras[0]).toContain(
      `${PREFIX}\n1）onto-skill（本体技能；ontology_name='原材料采购和库存'，ontology_id='1'）`,
    );
    expect(recorder.extras[0]).toContain('   直接命中：创建采购单（B1）');
    // 提示不进 messages，也不进历史
    expect(historyText()).not.toContain(PREFIX);

    const [record] = records();
    expect(record).toMatchObject({
      thread_id: 'th_1',
      agent_name: AGENT,
      message_id: run.assistantMessageId,
      disposition: 'focused',
      reason: null,
      model: 'laya-multilingual',
      batches: 2,
      truncated: false,
      prompt_truncated: false,
      error: null,
    });
    expect(record!.skills.find((skill) => skill.name === 'onto-skill')!.selected).toBe(true);
    // 只写入选行为：Q1/Q2 分数 0.05，规则不再补入
    expect(record!.behaviors.map((item) => item.name)).toEqual(['B1']);
    expect(record).not.toHaveProperty('functions');
    expect(record).not.toHaveProperty('data_supplements');
  });

  it('预置动作入口（skipIntentFocus）→ 判定 0 次、不追加、仅留档 skipped', async () => {
    freshRoot();
    writeAgent(true);
    const client = makeClient();
    const recorder: Recorder = { extras: [], messageCounts: [] };
    const manager = managerWith(makeRunner(client));

    const run = start(manager, recorder, { skipIntentFocus: true });
    await run.settled;

    expect(client.calls).toHaveLength(0);
    expect(recorder.extras[0] ?? '').not.toContain(PREFIX);
    expect(records()[0]).toMatchObject({
      disposition: 'skipped',
      reason: 'skip:preset_action',
      prompt: '',
    });
  });

  it('guidance 非空 → 归一为跳过，两套建议不共存', async () => {
    freshRoot();
    writeAgent(true);
    const client = makeClient();
    const recorder: Recorder = { extras: [], messageCounts: [] };
    const manager = managerWith(makeRunner(client));
    const guidance = '本轮请优先使用以下工具完成任务：read_file';

    const run = start(manager, recorder, { guidance });
    await run.settled;

    expect(client.calls).toHaveLength(0);
    expect(recorder.extras[0]).toContain(guidance);
    expect(recorder.extras[0]).not.toContain(PREFIX);
    expect(records()[0]).toMatchObject({ disposition: 'skipped', prompt: '' });
    expect(historyText()).not.toContain(guidance);
  });

  it('全部低于阈值 → empty/below_threshold、不追加', async () => {
    freshRoot();
    writeAgent(true);
    const client = makeClient({ ok: true, scores: { s1: 0.2, s2: 0.1 }, model: 'laya-multilingual' });
    const recorder: Recorder = { extras: [], messageCounts: [] };
    const manager = managerWith(makeRunner(client));

    const run = start(manager, recorder);
    await run.settled;

    expect(recorder.extras[0] ?? '').not.toContain(PREFIX);
    expect(records()[0]).toMatchObject({
      disposition: 'empty',
      reason: 'below_threshold',
      prompt: '',
    });
  });

  it('判定超时 → degraded、本轮无提示、回答照常', async () => {
    freshRoot();
    writeAgent(true);
    const client = makeClient({ ok: false, reason: 'timeout', message: '判定超时' });
    const recorder: Recorder = { extras: [], messageCounts: [] };
    const manager = managerWith(makeRunner(client));

    const run = start(manager, recorder);
    await run.settled;

    expect(recorder.extras[0] ?? '').not.toContain(PREFIX);
    expect(records()[0]).toMatchObject({ disposition: 'degraded', reason: 'timeout' });
    expect(historyText()).toContain('本轮回答');
  });

  it('SOUL 开关关闭 → 零判定、零留档', async () => {
    freshRoot();
    writeAgent(false);
    const client = makeClient();
    const recorder: Recorder = { extras: [], messageCounts: [] };
    const manager = managerWith(makeRunner(client));

    const run = start(manager, recorder);
    await run.settled;

    expect(client.calls).toHaveLength(0);
    expect(recorder.extras[0] ?? '').not.toContain(PREFIX);
    expect(fs.existsSync(store.filePathOf(USER, AGENT, 'th_1'))).toBe(false);
  });

  it('与 007 开关互相独立', async () => {
    const cases = [
      { focus: false, hints: false, expectFocus: false, expectHints: false },
      { focus: true, hints: false, expectFocus: true, expectHints: false },
      { focus: false, hints: true, expectFocus: false, expectHints: true },
      { focus: true, hints: true, expectFocus: true, expectHints: true },
    ] as const;

    for (const item of cases) {
      freshRoot();
      writeAgent(item.focus, item.hints);
      const client = makeClient();
      const recorder: Recorder & { nextActionsMaxes?: Array<number | undefined> } = {
        extras: [],
        messageCounts: [],
        nextActionsMaxes: [],
      };
      const manager = new RunManager({
        history,
        usage,
        intentFocus: makeRunner(client),
        nextActionsConfig: (userId, agentName) =>
          isNextActionsEnabled(root, userId, agentName)
            ? { enabled: true, max: nextActionHintsCount(root, userId, agentName) }
            : null,
      });

      // 记录 nextActionsMax 需要包一层 agent
      const base = stubAgent(recorder);
      const agent: RunAgentLike = {
        key: base.key,
        activeThreads: 0,
        async *run(req: AgentRunRequest) {
          recorder.nextActionsMaxes!.push(req.nextActionsMax);
          yield* base.run(req);
        },
      };
      const run = manager.startRun({
        userId: USER,
        threadId: 'th_1',
        agent,
        userMessage: '帮我创建一笔原材料采购单',
        thinking: false,
      });
      await run.settled;

      expect(client.calls.length, `focus=${item.focus} hints=${item.hints}`).toBe(
        item.expectFocus ? 2 : 0,
      );
      expect(recorder.extras[0]!.includes(PREFIX)).toBe(item.expectFocus);
      expect(recorder.nextActionsMaxes?.[0]).toBe(item.expectHints ? 3 : undefined);
    }
  });

  it('开关开启但判定模型未配置 → unconfigured、零调用、不追加', async () => {
    freshRoot();
    writeAgent(true);
    const client = makeClient();
    const recorder: Recorder = { extras: [], messageCounts: [] };
    const manager = managerWith(makeRunner(client, false));

    const run = start(manager, recorder);
    await run.settled;

    expect(client.calls).toHaveLength(0);
    expect(recorder.extras[0] ?? '').not.toContain(PREFIX);
    expect(records()[0]).toMatchObject({ disposition: 'unconfigured', reason: 'no_config' });
  });

  it('本体未物化 → empty/no_focusable_skills，技能不评分', async () => {
    freshRoot();
    writeAgent(true, false, false);
    // 只保留本体技能（非本体技能会照常可聚焦，无法验证"无可用候选"）
    fs.rmSync(path.join(agentDir(root, USER, AGENT), 'skills', 'plain'), { recursive: true, force: true });
    const client = makeClient();
    const recorder: Recorder = { extras: [], messageCounts: [] };
    const manager = managerWith(makeRunner(client));

    const run = start(manager, recorder);
    await run.settled;

    expect(client.calls).toHaveLength(0);
    expect(records()[0]).toMatchObject({ disposition: 'empty', reason: 'no_focusable_skills' });
  });

  it('未装配判定口 → 不产生记录，回答照常', async () => {
    freshRoot();
    writeAgent(true);
    const recorder: Recorder = { extras: [], messageCounts: [] };
    const manager = managerWith();

    const run = start(manager, recorder);
    await run.settled;

    expect(recorder.extras[0] ?? '').not.toContain(PREFIX);
    expect(fs.existsSync(store.filePathOf(USER, AGENT, 'th_1'))).toBe(false);
  });

  it('三轮隔离：记录逐轮对齐，聚焦内容不进历史也不进后续轮次素材', async () => {
    freshRoot();
    writeAgent(true);

    const results: LayaDecideResult[] = [
      { ok: true, scores: { s1: 0.9, s2: 0.1 }, model: 'laya-multilingual' },
      { ok: true, scores: { s1: 0.1, s2: 0.1 }, model: 'laya-multilingual' },
    ];
    let call = 0;
    const client = {
      decide: async () => {
        const index = Math.floor(call / 2);
        call += 1;
        return results[Math.min(index, results.length - 1)]!;
      },
    };
    const manager = managerWith(makeRunner(client));

    const recorder: Recorder = { extras: [], messageCounts: [] };
    const round1 = start(manager, recorder);
    await round1.settled;
    const round2 = start(manager, recorder);
    await round2.settled;
    const round3 = start(manager, recorder, { skipIntentFocus: true });
    await round3.settled;

    // 第 2 轮空、第 3 轮跳过，都不含第 1 轮的提示
    expect(recorder.extras[1]).not.toContain(PREFIX);
    expect(recorder.extras[2]).not.toContain(PREFIX);

    const lines = records();
    expect(lines.map((record) => record.disposition)).toEqual(['focused', 'empty', 'skipped']);
    expect(lines.map((record) => record.seq)).toEqual([1, 2, 3]);
    expect(lines.map((record) => record.message_id)).toEqual([
      round1.assistantMessageId,
      round2.assistantMessageId,
      round3.assistantMessageId,
    ]);

    const raw = historyText();
    expect(raw).not.toContain(PREFIX);
    expect(raw).toContain('帮我创建一笔原材料采购单');
  });
});
