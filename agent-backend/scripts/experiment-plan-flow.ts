import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { loadConfig } from '../src/config.js';
import { IntentFocusRunner } from '../src/domain/intent-focus/runner.js';
import { AgentInstanceFactory } from '../src/infra/agent-factory.js';
import type { LlmChatRequest } from '../src/infra/llm/llm-provider.js';
import { PiAiLlmProvider } from '../src/infra/llm/pi-ai-provider.js';
import type { LlmEvent } from '../src/types.js';
import { loadFocusEnv } from './lib/focus-fixture.js';

const INPUT = process.argv[2] ?? '查询一下高强度钢板和铁矿库存';
const THREAD = 'exp-plan-flow';

const line = (title: string): void => {
  console.log(`\n${'='.repeat(16)} ${title} ${'='.repeat(16)}`);
};

interface RecordedCall {
  kind: 'plan' | 'chat';
  system: string;
  messages: Array<{ role: string; content: string }>;
  tools: string[];
  output: string;
  elapsedMs: number;
  usage?: unknown;
}

const calls: RecordedCall[] = [];

/**
 * 规划调用的识别口径：它的 system 一定含第 2 段标题。
 *
 * **不能用 `tools.length === 0` 判断**——工厂在「非 pi provider」时会降级直聊（也是空工具），
 * 那样会把主对话误记成规划调用（第一次跑就踩了这个坑）。
 */
const PLAN_MARK = '本轮规划的唯一起点';

type ProviderCtor = ConstructorParameters<typeof PiAiLlmProvider>;

/** 必须**继承**而不是包一层对象：工厂用 `instanceof PiAiLlmProvider` 判断能否挂工具 */
class RecordingLlm extends PiAiLlmProvider {
  constructor(private readonly sink: RecordedCall[], ...args: ProviderCtor) {
    super(...args);
  }

  override async *streamChat(req: LlmChatRequest): AsyncIterable<LlmEvent> {
    const started = Date.now();
    let output = '';
    let usage: unknown;
    for await (const event of super.streamChat(req)) {
      if (event.type === 'content_delta') output += event.delta;
      if (event.type === 'done') usage = (event as { usage?: unknown }).usage;
      yield event;
    }
    this.sink.push({
      kind: req.systemPrompt.includes(PLAN_MARK) ? 'plan' : 'chat',
      system: req.systemPrompt,
      messages: req.messages.map((message) => ({ role: message.role, content: message.content })),
      tools: req.tools.map((tool) => tool.name),
      output,
      elapsedMs: Date.now() - started,
      ...(usage !== undefined ? { usage } : {}),
    });
  }

  override loopOptions(): ReturnType<PiAiLlmProvider['loopOptions']> {
    const base = super.loopOptions();
    const streamFn: typeof base.streamFn = (model, context, options) => {
      const ctx = context as unknown as {
        systemPrompt?: string;
        messages?: Array<{ role: string; content: unknown }>;
        tools?: Array<{ name: string }>;
      };
      this.sink.push({
        kind: ctx.systemPrompt?.includes(PLAN_MARK) ? 'plan' : 'chat',
        system: ctx.systemPrompt ?? '',
        messages: (ctx.messages ?? []).map((message) => ({
          role: message.role,
          content:
            typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
        })),
        tools: (ctx.tools ?? []).map((tool) => tool.name),
        output: '',
        elapsedMs: 0,
      });
      return base.streamFn(model, context, options);
    };
    return { ...base, streamFn };
  }
}

/**
 * 读 SOUL 的阶数（`intent_focus_depth`）。
 *
 * **必须传**：`IntentFocusRunner` 缺省 `getDepth` 为 0 = 不发散，
 * 聚焦提示里就没有「图路径」段（上游），卡片也没有下游候选。
 * 第一次跑漏了这一步，误以为"没有上下游"。
 */
function readFocusDepth(agentDirPath: string): number {
  const text = fs.readFileSync(path.join(agentDirPath, 'SOUL.md'), 'utf8');
  const matched = /^intent_focus_depth:\s*(\d+)/m.exec(text);
  return matched ? Number(matched[1]) : 0;
}

/** 临时开启 `task_planning`，返回还原函数 */
function forceTaskPlanning(agentDirPath: string): () => void {
  const file = path.join(agentDirPath, 'SOUL.md');
  const original = fs.readFileSync(file, 'utf8');
  if (/^task_planning:\s*true$/m.test(original)) {
    console.log('SOUL 已开启 task_planning（无需改写）');
    return () => undefined;
  }
  const next = original.replace(/^---\r?\n/, (head) => `${head}task_planning: true\n`);
  fs.writeFileSync(file, next, 'utf8');
  console.log('已临时给 SOUL.md 注入 task_planning: true（结束时还原）');
  return () => fs.writeFileSync(file, original, 'utf8');
}

function splitSegments(system: string): Array<{ title: string; body: string }> {
  const marks = [
    '［意图聚焦结果｜本轮规划的唯一起点］',
    '［本体关系｜按本体分段］',
    '［可用函数］',
    '命令前置约束',
    '［输出格式］',
  ];
  const cuts: Array<{ at: number; title: string }> = [];
  for (const mark of marks) {
    const at = system.indexOf(mark);
    if (at >= 0) cuts.push({ at, title: mark.replace(/[［］]/g, '') });
  }
  cuts.sort((l, r) => l.at - r.at);
  const out: Array<{ title: string; body: string }> = [];
  const headEnd = cuts[0]?.at ?? system.length;
  out.push({ title: '角色与总则', body: system.slice(0, headEnd).trim() });
  cuts.forEach((cut, index) => {
    const end = cuts[index + 1]?.at ?? system.length;
    out.push({ title: cut.title, body: system.slice(cut.at, end).trim() });
  });
  return out;
}

async function main(): Promise<void> {
  const config = loadConfig({
    env: process.env,
    configPath: path.resolve(process.cwd(), 'config.yaml'),
  });
  const env = loadFocusEnv();
  const logger = pino({ level: 'info' }, pino.destination({ dest: 1, sync: true }));

  line('阶段 0：环境');
  console.log(`数字人：${env.user} / ${env.agent}`);
  console.log(`主模型：${config.defaultModel.model}（${config.defaultModel.baseUrl}）`);
  console.log(`聚焦模型：${env.config.model}（${env.config.baseUrl}）`);
  console.log(`输入：${INPUT}`);

  const restoreSoul = forceTaskPlanning(env.dir);
  const factory = new AgentInstanceFactory({
    root: env.root,
    llm: () => provider,
    providerFor: () => provider,
    logger,
    mcpTimeoutMs: config.mcpTimeoutMs,
    ...(config.mcpConnectTimeoutMs !== undefined
      ? { mcpConnectTimeoutMs: config.mcpConnectTimeoutMs }
      : {}),
    ...(config.readTruncateKb !== undefined ? { truncateKb: config.readTruncateKb } : {}),
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000',
    fileSignSecret: process.env.FILE_SIGN_SECRET ?? 'experiment-secret',
  });
  const provider = new RecordingLlm(calls, config.defaultModel, config.llmRetry);

  const agent = await factory.create({ userId: env.user, agentName: env.agent });
  try {
    const ready = await agent.mcpReady(config.mcpConnectTimeoutMs ?? 20_000);
    console.log(`MCP 建连：${ready ? '已就绪' : '超时（降级继续）'}`);
    console.log(`不可用服务：${JSON.stringify(agent.unavailableMcp())}`);

    line('阶段 1：意图聚焦（Laya /v1/systemone，真实调用）');
    const depth = readFocusDepth(env.dir);
    console.log(`…（阶数 intent_focus_depth = ${depth}）`);
    const focusRunner = new IntentFocusRunner({
      root: env.root,
      config: env.config,
      client: env.client,
      isEnabled: () => true,
      getDepth: () => depth,
    });
    const focusStarted = Date.now();
    const focus = await focusRunner.judge({
      userId: env.user,
      agentName: env.agent,
      threadId: THREAD,
      messageId: 'exp-message',
      userInput: INPUT,
      skip: false,
    });
    console.log(`判定耗时：${Date.now() - focusStarted} ms`);
    console.log(`入选技能：${JSON.stringify(focus.toolTips.map((tip) => tip.name))}`);
    console.log('\n--- focus.prompt 原文 ---');
    console.log(focus.prompt === '' ? '（空串 = 本轮无聚焦结果，规划会被跳过）' : focus.prompt);

    line('阶段 2：计划制定（规划调用，真实 DeepSeek）');
    const signal = new AbortController().signal;
    const events: LlmEvent[] = [];
    const answerParts: string[] = [];
    const planStarted = Date.now();
    for await (const event of agent.run({
      threadId: THREAD,
      messages: [{ role: 'user', content: INPUT }] as never,
      ...(focus.prompt !== '' ? { systemExtra: focus.prompt, focusPrompt: focus.prompt } : {}),
      thinking: false,
      signal,
    })) {
      events.push(event);
      if (event.type === 'content_delta') answerParts.push(event.delta);
    }
    console.log(`整轮耗时：${Date.now() - planStarted} ms`);

    const planCalls = calls.filter((call) => call.kind === 'plan');
    const chatCalls = calls.filter((call) => call.kind === 'chat');
    console.log(`LLM 调用：规划 ${planCalls.length} 次 / 主对话 ${chatCalls.length} 次`);

    planCalls.forEach((call, index) => {
      console.log(`\n--- 第 ${index + 1} 次规划调用（${call.elapsedMs} ms，prompt ${Array.from(call.system).length} 字）---`);
      for (const segment of splitSegments(call.system)) {
        console.log(`\n[段：${segment.title}]（${Array.from(segment.body).length} 字）`);
        console.log(segment.body);
      }
      console.log('\n[规划 messages]');
      for (const message of call.messages) console.log(`${message.role}: ${message.content}`);
      console.log('\n[规划原始输出]');
      console.log(call.output);
    });

    line('阶段 3：计划执行（真实 MCP 工具）');
    chatCalls.forEach((call, index) => {
      const cost = call.elapsedMs > 0 ? `${call.elapsedMs} ms` : '请求侧记录（耗时见事件流）';
      console.log(`\n--- 第 ${index + 1} 次主对话调用（${cost}）---`);
      console.log(`可见工具（${call.tools.length}）：${call.tools.join('、')}`);
      const snapshot = [...call.messages].reverse().find((message) => message.content.includes('［执行进度］'));
      console.log(`本轮快照：\n${snapshot === undefined ? '（无）' : snapshot.content}`);
    });

    console.log('\n--- 工具调用流水 ---');
    for (const event of events) {
      if (event.type === 'tool_call_start') {
        const item = event as unknown as {
          name: string;
          label?: string;
          argsDigest?: Record<string, string>;
        };
        console.log(
          `→ ${item.name}${item.label ? `（${item.label}）` : ''} ${JSON.stringify(item.argsDigest ?? {})}`,
        );
      }
      if (event.type === 'tool_call_end') {
        const item = event as unknown as { name?: string; status?: string; resultText?: string };
        console.log(
          `← ${item.name ?? ''} [${item.status ?? ''}] ${(item.resultText ?? '').slice(0, 600)}`,
        );
      }
    }

    console.log('\n--- 最终回答 ---');
    console.log(answerParts.join('').trim() || '（空）');

    const done = events.find((event) => event.type === 'done') as { usage?: unknown } | undefined;
    console.log(`\nusage：${JSON.stringify(done?.usage ?? null)}`);
  } finally {
    restoreSoul();
    await agent.dispose();
    console.log('\nSOUL.md 已还原。');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
