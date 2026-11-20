/**
 * 027 集成测试共用环境：本地 Laya 桩 + fake LlmProvider + 部署产物写入 + 起服务。
 *
 * 抽出来的理由（宪章原则二）：`chat-rewrite` / `chat-rewrite-budget` / `chat-rewrite-degrade`
 * 三个文件都要"真 HTTP + 桩模型"，各写一份会让 `buildServer` 的构造口径悄悄漂移——
 * 这类漂移表现为"某个文件里的用例永远绿"，最难发现。
 *
 * 这里**不 mock 任何域代码**：SOUL、技能、本体、留档都是真实文件；只有两个模型是桩。
 */
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

import { loadConfig } from '../../../src/config.js';
import type { AppContext } from '../../../src/context.js';
import { agentDir } from '../../../src/domain/dirs.js';
import type { LlmChatRequest, LlmProvider } from '../../../src/infra/llm/llm-provider.js';
import { buildServer } from '../../../src/server.js';
import type { LlmEvent } from '../../../src/types.js';

export const USER = 'admin';
export const AGENT = 'demo';

export const ONTOLOGY_YAML = [
  'metadata:',
  '  ontology_id: 1',
  '  ontology_name: 原材料采购和库存',
  '  scenario_id: 2',
  '  scenario_name: 生产调度',
  'behaviors:',
  '  - name: B1',
  '    title: 创建采购单',
  '    op_type: command',
].join('\n');

export interface LayaStub {
  baseUrl: string;
  /** 每次判定收到的 `state`（时间正序） */
  states: string[];
  close(): Promise<void>;
}

export interface LayaStubOptions {
  /** `need_rewrite` 题的分数（缺省 0.95） */
  needRewrite?: number;
  /** 只对 `need_rewrite` 那一批延迟响应（毫秒）——用于把阶段预算耗尽 */
  rewriteDelayMs?: number;
  /** 直接返回该 HTTP 状态码（模拟判定服务故障） */
  failStatus?: number;
}

export async function startLaya(options: LayaStubOptions = {}): Promise<LayaStub> {
  const states: string[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
    req.on('end', () => {
      const body = JSON.parse(raw) as { state: string; questions: Record<string, unknown> };
      states.push(body.state);
      const isRewrite = Object.hasOwn(body.questions, 'need_rewrite');
      const reply = () => {
        if (options.failStatus) {
          res.writeHead(options.failStatus, { 'content-type': 'application/json' });
          res.end('{"detail":"判定服务故障"}');
          return;
        }
        const answers: Record<string, { type: 'noul'; noul: number }> = {};
        for (const qid of Object.keys(body.questions)) {
          answers[qid] = {
            type: 'noul',
            noul: isRewrite ? (options.needRewrite ?? 0.95) : 0.9,
          };
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ model: 'laya-multilingual', answers }));
      };
      if (isRewrite && options.rewriteDelayMs) setTimeout(reply, options.rewriteDelayMs);
      else reply();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    states,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export interface LlmLog {
  /** 改写请求里的 user 消息正文（用于断言素材） */
  rewritePrompts: string[];
  /** 主对话调用次数 */
  mainCalls: number;
}

export interface FakeLlmOptions {
  /** 改写调用直接抛错 */
  rewriteFails?: boolean;
  /** 改写调用一直挂到超时 / 中止（模拟慢模型） */
  rewriteHangs?: boolean;
  /** 改写结果（缺省 `REWRITTEN` 口径） */
  rewriteText?: string;
  /** 改写只回 thinking、不回 content（模拟空输出） */
  rewriteEmpty?: boolean;
}

/**
 * 主对话 + 改写共用一个 fake provider：按 `systemPrompt` 区分用途。
 *
 * 判据用"输入改写助手"而不是"tools 是否为空"——主对话在纯聊天轮次也可能不带工具，
 * 那样会把改写与主对话混在一起，测试就再也测不出"改写走了哪条通道"。
 */
export function fakeLlm(log: LlmLog, options: FakeLlmOptions = {}): LlmProvider {
  return {
    async *streamChat(req: LlmChatRequest) {
      if (req.systemPrompt.includes('输入改写助手')) {
        log.rewritePrompts.push(req.messages[0]?.content ?? '');
        if (options.rewriteFails) throw new Error('改写模型 503');
        if (options.rewriteHangs) {
          await new Promise<void>((resolve) => {
            if (req.signal.aborted) {
              resolve();
              return;
            }
            req.signal.addEventListener('abort', () => resolve(), { once: true });
          });
          return;
        }
        if (options.rewriteEmpty) {
          yield { type: 'thinking_delta', delta: '只有思考' } as LlmEvent;
          yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } } as LlmEvent;
          return;
        }
        yield { type: 'content_delta', delta: options.rewriteText ?? '分析上批原材料采购单的到货延迟' } as LlmEvent;
        yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } } as LlmEvent;
        return;
      }
      log.mainCalls += 1;
      yield { type: 'content_delta', delta: '本轮回答' } as LlmEvent;
      yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } } as LlmEvent;
    },
  };
}

export interface AgentOptions {
  /** 输入重写开关（写进 frontmatter 才会被运行侧读到） */
  rewrite: boolean;
  /** 意图聚焦开关（缺省 true） */
  focus?: boolean;
}

/** 按部署产物形态写数字人（SOUL 开关 + 技能 + 本体） */
export function writeAgent(root: string, options: AgentOptions): void {
  const dir = agentDir(root, USER, AGENT);
  fs.mkdirSync(dir, { recursive: true });
  const lines = ['soul_version: 1'];
  if (options.focus ?? true) lines.push('intent_focus: true');
  if ((options.focus ?? true) && options.rewrite) lines.push('input_rewrite: true');
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

  const ontoDir = path.join(dir, 'ontology', '生产调度', '原材料采购和库存');
  fs.mkdirSync(ontoDir, { recursive: true });
  fs.writeFileSync(path.join(ontoDir, 'ontology.yaml'), ONTOLOGY_YAML, 'utf8');
}

export interface RewriteEnv {
  app: FastifyInstance;
  root: string;
  laya: LayaStub;
  llmLog: LlmLog;
  close(): Promise<void>;
}

export interface SetupOptions {
  rewrite: boolean;
  focus?: boolean;
  laya?: LayaStubOptions;
  llm?: FakeLlmOptions;
  /** 追加到 `intent_focus` 块的配置行（如 `  rewrite_timeout_ms: 400`） */
  intentFocusLines?: string[];
}

/** 起一套"真 HTTP + 桩模型"环境；`close()` 负责收干净（含临时目录） */
export async function setupRewriteEnv(options: SetupOptions): Promise<RewriteEnv> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-chat-rewrite-'));
  const laya = await startLaya(options.laya ?? {});
  const llmLog: LlmLog = { rewritePrompts: [], mainCalls: 0 };

  const configPath = path.join(root, 'config.yaml');
  fs.writeFileSync(
    configPath,
    [
      'models:',
      '  - model: test-model',
      '    api_key: test-key',
      'intent_focus:',
      `  base_url: ${laya.baseUrl}`,
      '  api_key: dev-key',
      '  model: laya-multilingual',
      ...(options.intentFocusLines ?? []),
    ].join('\n'),
    'utf8',
  );
  const config = loadConfig({
    env: { PUBLIC_BASE_URL: 'http://backend:3000', OPT_AGENT_ROOT: root },
    configPath,
  });

  writeAgent(root, {
    rewrite: options.rewrite,
    ...(options.focus !== undefined ? { focus: options.focus } : {}),
  });
  fs.mkdirSync(path.join(root, 'users', USER), { recursive: true });

  const app = await buildServer({ config, llmProvider: fakeLlm(llmLog, options.llm ?? {}) });
  await app.inject({ method: 'POST', url: `/api/agents/${AGENT}/select` });

  return {
    app,
    root,
    laya,
    llmLog,
    close: async () => {
      await app.close();
      await laya.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export function ctxOf(app: FastifyInstance): AppContext {
  return (app as unknown as { ctx: AppContext }).ctx;
}

/** 发一轮消息（走真实 SSE 路由；`inject` 会在 done 后收尾） */
export function send(app: FastifyInstance, threadId: string, content: string) {
  return app.inject({
    method: 'POST',
    url: `/api/threads/${threadId}/messages`,
    headers: { accept: 'text/event-stream' },
    payload: { content },
  });
}
