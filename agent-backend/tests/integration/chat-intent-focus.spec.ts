/**
 * 集成测试：意图聚焦（013）端到端链路。
 *
 * 分两层，各守自己的边界：
 *
 * 1. **公开 HTTP（`POST /api/threads/:id/messages`）**：`skip_intent_focus` 是新增
 *    请求字段，`additionalProperties: false` **不能被放宽**——非布尔要 400，
 *    拼错字段名同样要 400，而合法布尔必须能通过校验（用"会话不存在 → 404"证明）。
 * 2. **域链路（真实 `RunManager` + 真实 `IntentFocusRunner` + 真实留档 + 真实 SOUL 开关，
 *    只把模型与 Laya 换成桩）**：判定必须**先于**主模型、跳过必须**零调用**、
 *    五种处置各留档一条、聚焦内容不进历史也不进后续轮次素材。
 *
 * 为什么不用 `buildServer` 跑完整聊天：`route → agent-factory → 真模型` 这一段在
 * 集成测试里不可桩化（与 007 的口径一致），断言集中在域层反而更精确。
 *
 * 运行方式（本地执行）：npm run test:integration
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
import { IntentFocusRunner } from '../../src/domain/intent-focus-runner.js';
import { IntentFocusStore } from '../../src/domain/intent-focus-store.js';
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
/** 聚焦提示固定前缀（规格 FR-004，逐字；**软措辞**：仅供参考，不是限制） */
const PREFIX = '本轮可优先考虑以下工具（仅供参考，不必局限）：';

/** 本轮可用工具（由桩回填，模拟 `agent-factory` 装配后的真实清单） */
const TOOLS = [
  { name: 'read_file', description: '读取文件内容' },
  { name: 'erp__query_order', description: '查询订单' },
];

const CONFIG: IntentFocusConfig = {
  baseUrl: 'http://laya:8000',
  model: 'laya-multilingual',
  apiKey: 'dev-key',
  timeoutMs: 10000,
  threshold: 0.5,
};

/** 判定桩：记录每次调用，返回给定结果（缺省 = read_file 高、query_order 低） */
function makeClient(result?: LayaDecideResult) {
  const calls: Array<{ state: string; questionCount: number }> = [];
  return {
    calls,
    decide: async (state: string, questions: Record<string, unknown>) => {
      calls.push({ state, questionCount: Object.keys(questions).length });
      return (
        result ?? {
          ok: true as const,
          scores: { read_file: 0.9, erp__query_order: 0.3 },
          model: 'laya-multilingual',
        }
      );
    },
  };
}

interface Recorder {
  /** 调用顺序：`judge` → `model`（判定必须先于主模型） */
  order: string[];
  /** 每次回调拿到（并会追加进本轮素材）的聚焦提示 */
  prompts: string[];
  /** 本轮 `systemExtra`（`guidance` 的落点；用于验证两套建议不共存） */
  extras?: string[];
  /** 007 开关的口径：请求带上限 = 该开关开启（用于验证两个开关互不影响） */
  nextActionsMaxes?: Array<number | undefined>;
}

/**
 * 假数字人：按 `agent-factory` 的时序模拟——装配工具 → 判定 → 主模型。
 * 这样"判定先于主模型"就是被测链路的真实行为，而不是断言自己造的顺序。
 */
function stubAgent(recorder: Recorder): RunAgentLike {
  return {
    key: { userId: USER, agentName: AGENT },
    activeThreads: 0,
    async *run(req: AgentRunRequest) {
      if (req.runtime) req.runtime.availableTools = [...TOOLS];
      recorder.nextActionsMaxes?.push(req.nextActionsMax);
      recorder.extras?.push(req.systemExtra ?? '');
      if (req.focusJudge) {
        recorder.order.push('judge');
        recorder.prompts.push(await req.focusJudge(TOOLS));
      }
      recorder.order.push('model');
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

    // 可加载的数字人（009 起缺 TOOL/MCP 会被判不可用 → 409，误伤本组用例）
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

  it('缺省该字段仍是合法请求（手输 / 回车 / 带附件的行为零变更）', async () => {
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

describe('RunManager × 意图聚焦：判定时序、跳过与留档', () => {
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

  /** 每个用例一份干净目录：开关文件与留档互不干扰 */
  function freshRoot(): void {
    usage?.close();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-intent-focus-run-'));
    usage = new UsageDb(path.join(root, 'usage.db'));
    history = new HistoryStore(root);
    store = new IntentFocusStore(root);
  }

  /**
   * 按部署产物形态写一份完整可加载的数字人配置。
   *
   * 两个开关**各自独立写键**（与 `renderSoulMd` 同形）：关闭态不写该键，
   * 不是写 `false`——部署产物零残留。
   */
  function writeAgent(focus: boolean, hints = false): void {
    const dir = agentDir(root, USER, AGENT);
    fs.mkdirSync(dir, { recursive: true });
    const lines = ['soul_version: 1'];
    if (hints) lines.push('next_action_hints: true', 'next_action_hints_count: 3');
    if (focus) lines.push('intent_focus: true');
    const frontmatter = lines.join('\n');
    fs.writeFileSync(
      path.join(dir, 'SOUL.md'),
      `---\n${frontmatter}\n---\n\n## 主要使命\n\n你是助手。\n`,
      'utf8',
    );
    fs.writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
    fs.writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');
  }

  function makeRunner(client: ReturnType<typeof makeClient>, withConfig = true) {
    return new IntentFocusRunner({
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
      userMessage: '帮我看看这批订单的交付风险',
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

  it('手输轮次：判定先于主模型，提示进本轮素材，留档 focused', async () => {
    freshRoot();
    writeAgent(true);
    const client = makeClient();
    const recorder: Recorder = { order: [], prompts: [] };
    const manager = managerWith(makeRunner(client));

    const run = start(manager, recorder);
    await run.settled;

    // 时序：判定在装配后、主模型前（FR-001）
    expect(recorder.order).toEqual(['judge', 'model']);
    // 只取过阈值的工具（read_file=0.9 入选、erp__query_order=0.3 淘汰），工具英文名逐字（FR-004）
    expect(recorder.prompts[0]).toBe(`${PREFIX}read_file`);
    // 每个候选工具一条 noul 命题（2 个工具 = 2 题），输入是**本轮用户输入原文**（FR-002）
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.questionCount).toBe(TOOLS.length);
    expect(client.calls[0]?.state).toBe('帮我看看这批订单的交付风险');

    const [record] = records();
    expect(record).toMatchObject({
      thread_id: 'th_1',
      agent_name: AGENT,
      message_id: run.assistantMessageId,
      disposition: 'focused',
      reason: null,
      model: 'laya-multilingual',
      candidates: TOOLS.length,
      batches: 1,
      actions: ['read_file'],
      probabilities: { read_file: 0.9, erp__query_order: 0.3 },
      focus_prompt: `${PREFIX}read_file`,
      error: null,
    });
    expect(typeof record?.seq).toBe('number');
    // 用户可见的回答与历史都不含聚焦提示（FR-012）
    expect(historyText()).not.toContain(PREFIX);
  });

  it('预置动作入口（skipIntentFocus）→ 判定 0 次、提示不追加、仅留档 skipped', async () => {
    freshRoot();
    writeAgent(true);
    const client = makeClient();
    const recorder: Recorder = { order: [], prompts: [] };
    const manager = managerWith(makeRunner(client));

    const run = start(manager, recorder, { skipIntentFocus: true });
    await run.settled;

    expect(client.calls).toHaveLength(0);
    expect(recorder.prompts).toEqual(['']);

    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({
      disposition: 'skipped',
      reason: 'skip:preset_action',
      model: null,
      focus_prompt: '',
    });
  });

  it('guidance 非空（卡片自带工具引导）→ 归一为跳过，不与聚焦提示叠加', async () => {
    freshRoot();
    writeAgent(true);
    const client = makeClient();
    const recorder: Recorder = { order: [], prompts: [], extras: [] };
    const manager = managerWith(makeRunner(client));
    const guidance = '本轮请优先使用以下工具完成任务：read_file';

    // 故意**不传** skipIntentFocus：调用方漏传时服务端也必须归一
    const run = start(manager, recorder, { guidance });
    await run.settled;

    expect(client.calls).toHaveLength(0);
    expect(recorder.prompts).toEqual(['']);
    // guidance 照常进本轮 systemExtra，且其中没有聚焦提示（两套建议不共存）
    expect(recorder.extras?.[0]).toContain(guidance);
    expect(recorder.extras?.[0]).not.toContain(PREFIX);

    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({
      disposition: 'skipped',
      reason: 'skip:preset_action',
      focus_prompt: '',
    });
    // guidance 仍是请求级：不落历史
    expect(historyText()).not.toContain(guidance);
  });

  it('全部低于阈值 → empty、不追加（与未开启该功能时表现一致）', async () => {
    freshRoot();
    writeAgent(true);
    const client = makeClient({
      ok: true,
      scores: { read_file: 0.2, erp__query_order: 0.1 },
      model: 'laya-multilingual',
    });
    const recorder: Recorder = { order: [], prompts: [] };
    const manager = managerWith(makeRunner(client));

    const run = start(manager, recorder);
    await run.settled;

    expect(recorder.prompts).toEqual(['']);
    expect(records()[0]).toMatchObject({
      disposition: 'empty',
      reason: 'below_threshold',
      actions: [],
      focus_prompt: '',
    });
  });

  it('判定超时 → degraded、本轮无提示、回答照常（失败不改变用户所见）', async () => {
    freshRoot();
    writeAgent(true);
    const client = makeClient({ ok: false, reason: 'timeout', message: '判定超时' });
    const recorder: Recorder = { order: [], prompts: [] };
    const manager = managerWith(makeRunner(client));

    const run = start(manager, recorder);
    await run.settled;

    expect(recorder.prompts).toEqual(['']);
    expect(records()[0]).toMatchObject({ disposition: 'degraded', reason: 'timeout' });
    // 回答照常落盘（失败只降级，不改本轮产出）
    expect(historyText()).toContain('本轮回答');
  });

  it('SOUL 开关关闭 → 零判定、零留档（关闭即零成本）', async () => {
    freshRoot();
    writeAgent(false);
    const client = makeClient();
    const recorder: Recorder = { order: [], prompts: [] };
    const manager = managerWith(makeRunner(client));

    const run = start(manager, recorder);
    await run.settled;

    expect(client.calls).toHaveLength(0);
    expect(recorder.prompts).toEqual(['']);
    expect(fs.existsSync(store.filePathOf(USER, AGENT, 'th_1'))).toBe(false);
  });

  it('与 007 开关互相独立：四种组合各按各的键生效（FR-035）', async () => {
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
      const recorder: Recorder = { order: [], prompts: [], nextActionsMaxes: [] };
      const manager = new RunManager({
        history,
        usage,
        intentFocus: makeRunner(client),
        // 与 `server-attachments.ts` 同构：开关逐次现读真实 SOUL.md
        nextActionsConfig: (userId, agentName) =>
          isNextActionsEnabled(root, userId, agentName)
            ? { enabled: true, max: nextActionHintsCount(root, userId, agentName) }
            : null,
      });

      const run = start(manager, recorder);
      await run.settled;

      expect(client.calls.length, `focus=${item.focus} hints=${item.hints}`).toBe(
        item.expectFocus ? 1 : 0,
      );
      expect(recorder.prompts[0]).toBe(item.expectFocus ? `${PREFIX}read_file` : '');
      expect(recorder.nextActionsMaxes?.[0]).toBe(item.expectHints ? 3 : undefined);
    }
  });

  it('开关开启但判定模型未配置 → unconfigured、零调用、不追加', async () => {
    freshRoot();
    writeAgent(true);
    const client = makeClient();
    const recorder: Recorder = { order: [], prompts: [] };
    const manager = managerWith(makeRunner(client, false));

    const run = start(manager, recorder);
    await run.settled;

    expect(client.calls).toHaveLength(0);
    expect(recorder.prompts).toEqual(['']);
    expect(records()[0]).toMatchObject({ disposition: 'unconfigured', reason: 'no_config' });
  });

  it('未装配判定口 → 装配方不传 focusJudge（功能整体不生效）', async () => {
    freshRoot();
    writeAgent(true);
    const recorder: Recorder = { order: [], prompts: [] };
    const manager = managerWith();

    const run = start(manager, recorder);
    await run.settled;

    expect(recorder.order).toEqual(['model']);
    expect(recorder.prompts).toEqual([]);
    expect(fs.existsSync(store.filePathOf(USER, AGENT, 'th_1'))).toBe(false);
  });

  it('三轮隔离：记录逐轮对齐；聚焦内容不进历史，也不进后续轮次素材', async () => {
    freshRoot();
    writeAgent(true);

    // 第 1 轮聚焦、第 2 轮空结果、第 3 轮预置卡片跳过
    const results: LayaDecideResult[] = [
      {
        ok: true,
        scores: { read_file: 0.95, erp__query_order: 0.6 },
        model: 'laya-multilingual',
      },
      {
        ok: true,
        scores: { read_file: 0.1, erp__query_order: 0.05 },
        model: 'laya-multilingual',
      },
    ];
    const calls: number[] = [];
    const client = {
      decide: async () => {
        calls.push(1);
        return results[Math.min(calls.length - 1, results.length - 1)]!;
      },
    };
    const manager = managerWith(
      new IntentFocusRunner({
        config: CONFIG,
        client,
        store,
        isEnabled: (userId, agentName) => isIntentFocusEnabled(root, userId, agentName),
      }),
    );

    const recorder: Recorder = { order: [], prompts: [] };
    const round1 = start(manager, recorder);
    await round1.settled;
    const round2 = start(manager, recorder);
    await round2.settled;
    const round3 = start(manager, recorder, { skipIntentFocus: true });
    await round3.settled;

    // 每轮素材独立：第 2 轮空、第 3 轮跳过，都不含第 1 轮的聚焦提示（FR-010）
    expect(recorder.prompts).toEqual([`${PREFIX}read_file，erp__query_order`, '', '']);
    expect(calls).toHaveLength(2);

    const lines = records();
    expect(lines.map((r) => r.disposition)).toEqual(['focused', 'empty', 'skipped']);
    expect(lines.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(lines.map((r) => r.message_id)).toEqual([
      round1.assistantMessageId,
      round2.assistantMessageId,
      round3.assistantMessageId,
    ]);

    // 历史里既没有聚焦提示，也没有会话正文被改写（FR-007）
    const raw = historyText();
    expect(raw).not.toContain(PREFIX);
    expect(raw).not.toContain('read_file，');
    expect(raw).toContain('帮我看看这批订单的交付风险');
  });
});
