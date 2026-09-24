/**
 * 滚动摘要（FR-017/018）：正文池达上限即归档一批，池子左边界 = 归档游标（见 context-window）。
 *
 * - 每轮结束 trigger()：窗口外攒满 batchSize（20）条 → fire-and-forget 增量重写
 *   （旧摘要 + 新归档 20 条 → LLM 合并 → 新摘要）
 * - per-thread Promise 链串行互斥；失败记日志、保留旧摘要，绝不阻塞对话
 * - 存储：threads/{thread_id}/summary.json  { "summary": "...", "covered_count": 40 }
 *
 * domain 层不依赖 infra 的 LlmProvider 具体类型，仅依赖结构化的最小接口。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { LlmEvent } from '../types.js';
import { ARCHIVE_BATCH_MESSAGES, POOL_MAX_MESSAGES } from './context-window.js';
import { threadDir } from './dirs.js';
import type { HistoryStore } from './history.js';

/** 摘要生成所需的最小 LLM 接口（与 infra 的 LlmProvider 结构兼容） */
export interface SummaryLlm {
  streamChat(req: {
    systemPrompt: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    tools: never[];
    thinking: boolean;
    signal: AbortSignal;
  }): AsyncIterable<LlmEvent>;
}

export interface SummaryData {
  summary: string;
  coveredCount: number;
}

export interface SummaryDeps {
  /** 惰性获取 LLM（默认模型） */
  llm: () => SummaryLlm;
  logger?: { warn(msg: string): void };
  /** 池子上限：池子（= 总数 - 已归档）达到它即归档一批（默认见 `context-window`） */
  poolMax?: number;
  /** 窗口外攒满 N 条触发一次增量重写（默认 20） */
  batchSize?: number;
  /** 摘要生成超时（默认 60s） */
  timeoutMs?: number;
}

const EMPTY: SummaryData = { summary: '', coveredCount: 0 };

export class SummaryStore {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly poolMax: number;
  private readonly batchSize: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly root: string,
    private readonly history: HistoryStore,
    private readonly deps: SummaryDeps,
  ) {
    this.poolMax = deps.poolMax ?? POOL_MAX_MESSAGES;
    this.batchSize = deps.batchSize ?? ARCHIVE_BATCH_MESSAGES;
    this.timeoutMs = deps.timeoutMs ?? 60_000;
  }

  private filePath(userId: string, threadId: string): string {
    return path.join(threadDir(this.root, userId, threadId), 'summary.json');
  }

  /** 读取摘要；文件缺失/损坏按空摘要处理（损坏告警） */
  read(userId: string, threadId: string): SummaryData {
    const file = this.filePath(userId, threadId);
    if (!fs.existsSync(file)) return { ...EMPTY };
    try {
      const obj = JSON.parse(fs.readFileSync(file, 'utf8')) as { summary?: unknown; covered_count?: unknown };
      if (typeof obj.summary === 'string' && typeof obj.covered_count === 'number') {
        return { summary: obj.summary, coveredCount: obj.covered_count };
      }
      throw new Error('字段缺失');
    } catch {
      this.deps.logger?.warn(`summary.json 损坏按空摘要处理（user=${userId} thread=${threadId}）`);
      return { ...EMPTY };
    }
  }

  /**
   * 每轮对话结束后调用：窗口外攒满一批则增量重写。
   * 返回链上 Promise（永不 reject），调用方可 void 掉（fire-and-forget）。
   */
  trigger(userId: string, threadId: string): Promise<void> {
    const key = `${userId}/${threadId}`;
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(() => this.maybeArchive(userId, threadId)).catch(() => {});
    this.chains.set(key, next);
    return next;
  }

  private async maybeArchive(userId: string, threadId: string): Promise<void> {
    try {
      const messages = this.history.readAll(userId, threadId);
      const { summary, coveredCount } = this.read(userId, threadId);
      // 池子（= 总数 - 已归档）达上限才归档：一次调用清掉一整格，池子回到保留长度
      // —— 正因为触发点是"池子满"、且只归档池内最早的若干条，
      //    归档游标恒等于池子左边界，不会出现"既不在正文也不在摘要"的消息
      if (messages.length - coveredCount < this.poolMax) return;
      const archived = messages.slice(coveredCount, coveredCount + this.batchSize);
      const next = await this.rewrite(summary, archived);
      fs.mkdirSync(path.dirname(this.filePath(userId, threadId)), { recursive: true });
      fs.writeFileSync(
        this.filePath(userId, threadId),
        JSON.stringify({ summary: next, covered_count: coveredCount + archived.length }, null, 2),
        'utf8',
      );
    } catch (err) {
      // FR-018：失败记日志、保留旧摘要，不阻塞对话
      this.deps.logger?.warn(
        `摘要生成失败，沿用旧摘要（user=${userId} thread=${threadId}）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 增量重写：旧摘要 + 新归档消息 → LLM 合并；返回新摘要文本 */
  private async rewrite(
    oldSummary: string,
    archived: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<string> {
    const transcript = archived.map((m) => `${m.role === 'user' ? '用户' : '数字人'}：${m.content}`).join('\n');
    const prompt = oldSummary
      ? `以下是一段对话的既有摘要与后续新增的对话内容，请将它们合并为一份更新的摘要，保留关键事实、结论与用户偏好，直接输出摘要正文：\n\n【既有摘要】\n${oldSummary}\n\n【新增对话】\n${transcript}`
      : `请为以下对话生成一份摘要，保留关键事实、结论与用户偏好，直接输出摘要正文：\n\n${transcript}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let text = '';
      for await (const ev of this.deps.llm().streamChat({
        systemPrompt: '你是对话摘要助手，输出简洁、信息密度高的中文摘要。',
        messages: [{ role: 'user', content: prompt }],
        tools: [],
        thinking: false,
        signal: controller.signal,
      })) {
        if (ev.type === 'content_delta') text += ev.delta;
        else if (ev.type === 'error') throw new Error(`${ev.code}: ${ev.message}`);
      }
      if (!text.trim()) throw new Error('摘要为空');
      return text.trim();
    } finally {
      clearTimeout(timer);
    }
  }
}
