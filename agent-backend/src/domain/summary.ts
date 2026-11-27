import fs from 'node:fs';
import path from 'node:path';
import type { LlmEvent } from '../types.js';
import { disposeChain } from './chain.js';
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
  llm: () => SummaryLlm;
  logger?: { warn(msg: string): void };
  /** 池子上限：池子（= 总数 - 已归档）达到它即归档一批（默认见 `context-window`） */
  poolMax?: number;
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

  private filePath(userId: string, agentName: string, threadId: string): string {
    return path.join(threadDir(this.root, userId, agentName, threadId), 'summary.json');
  }

  read(userId: string, agentName: string, threadId: string): SummaryData {
    const file = this.filePath(userId, agentName, threadId);
    if (!fs.existsSync(file)) return { ...EMPTY };
    try {
      const obj = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        summary?: unknown;
        covered_count?: unknown;
      };
      if (typeof obj.summary === 'string' && typeof obj.covered_count === 'number') {
        return { summary: obj.summary, coveredCount: obj.covered_count };
      }
      throw new Error('字段缺失');
    } catch {
      this.deps.logger?.warn(
        `summary.json 损坏按空摘要处理（user=${userId} agent=${agentName} thread=${threadId}）`,
      );
      return { ...EMPTY };
    }
  }

  trigger(userId: string, agentName: string, threadId: string): Promise<void> {
    const key = `${userId}/${agentName}/${threadId}`;
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(() => this.maybeArchive(userId, agentName, threadId)).catch(() => {});
    this.chains.set(key, next);
    return next;
  }

  /**
   * 释放该会话的串行链内存（2026-10-27）：删会话时调用，等链排空后删键。
   * 安全性见 `disposeChain`（期间有新触发则保留不动）。
   */
  disposeThread(userId: string, agentName: string, threadId: string): Promise<void> {
    return disposeChain(this.chains, `${userId}/${agentName}/${threadId}`);
  }

  private async maybeArchive(userId: string, agentName: string, threadId: string): Promise<void> {
    try {
      const messages = this.history.readAll(userId, agentName, threadId);
      const { summary, coveredCount } = this.read(userId, agentName, threadId);
      // 池子（= 总数 - 已归档）达上限才归档：一次调用清掉一整格，池子回到保留长度
      // —— 正因为触发点是"池子满"、且只归档池内最早的若干条，
      if (messages.length - coveredCount < this.poolMax) return;
      const archived = messages.slice(coveredCount, coveredCount + this.batchSize);
      const next = await this.rewrite(summary, archived);
      fs.mkdirSync(path.dirname(this.filePath(userId, agentName, threadId)), { recursive: true });
      fs.writeFileSync(
        this.filePath(userId, agentName, threadId),
        JSON.stringify({ summary: next, covered_count: coveredCount + archived.length }, null, 2),
        'utf8',
      );
    } catch (err) {
      this.deps.logger?.warn(
        `摘要生成失败，沿用旧摘要（user=${userId} agent=${agentName} thread=${threadId}）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async rewrite(
    oldSummary: string,
    archived: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<string> {
    const transcript = archived
      .map((m) => `${m.role === 'user' ? '用户' : '数字人'}：${m.content}`)
      .join('\n');
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
