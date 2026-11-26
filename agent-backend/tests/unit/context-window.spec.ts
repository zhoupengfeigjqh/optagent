import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ARCHIVE_BATCH_MESSAGES,
  POOL_MAX_MESSAGES,
  POOL_RESERVED_MESSAGES,
} from '../../src/domain/context-window.js';
import { HistoryStore } from '../../src/domain/history.js';
import { SummaryStore, type SummaryLlm } from '../../src/domain/summary.js';

const AGENT = 'demo';

let root: string;

const fakeLlm: SummaryLlm = {
  async *streamChat() {
    yield { type: 'content_delta', delta: '摘要正文' };
  },
};

function makeSummary(history: HistoryStore, deps: { poolMax?: number; batchSize?: number } = {}) {
  return new SummaryStore(root, history, { llm: () => fakeLlm, ...deps });
}

async function seed(history: HistoryStore, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await history.append('admin', AGENT, 'th1', {
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${i}`,
    });
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-pool-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('上下文池常量', () => {
  it('保留量 = 上限 - 批次', () => {
    expect(POOL_RESERVED_MESSAGES).toBe(POOL_MAX_MESSAGES - ARCHIVE_BATCH_MESSAGES);
  });

  it('池子上限 60 条（≈30 轮）、一次归档 20 条、归档后保留 40 条', () => {
    expect(POOL_MAX_MESSAGES).toBe(60);
    expect(ARCHIVE_BATCH_MESSAGES).toBe(20);
    expect(POOL_RESERVED_MESSAGES).toBe(40);
  });
});

describe('归档时机（池子达上限即归档）', () => {
  it('59 条：池子未满，不归档', async () => {
    const history = new HistoryStore(root);
    const summary = makeSummary(history);
    await seed(history, POOL_MAX_MESSAGES - 1);
    await summary.trigger('admin', AGENT, 'th1');
    expect(summary.read('admin', AGENT, 'th1').coveredCount).toBe(0);
  });

  it('60 条：池子满，归档一批，池子回到保留长度', async () => {
    const history = new HistoryStore(root);
    const summary = makeSummary(history);
    await seed(history, POOL_MAX_MESSAGES);
    await summary.trigger('admin', AGENT, 'th1');

    const { coveredCount, summary: text } = summary.read('admin', AGENT, 'th1');
    expect(coveredCount).toBe(ARCHIVE_BATCH_MESSAGES);
    expect(POOL_MAX_MESSAGES - coveredCount).toBe(POOL_RESERVED_MESSAGES);
    expect(text).toBe('摘要正文');
  });

  it('79 条（池子 59）不归档；80 条（池子 60）再归档一批', async () => {
    const history = new HistoryStore(root);
    const summary = makeSummary(history);

    await seed(history, POOL_MAX_MESSAGES + ARCHIVE_BATCH_MESSAGES - 1);
    await summary.trigger('admin', AGENT, 'th1');
    expect(summary.read('admin', AGENT, 'th1').coveredCount).toBe(ARCHIVE_BATCH_MESSAGES);

    await seed(history, 1);
    await summary.trigger('admin', AGENT, 'th1');
    expect(summary.read('admin', AGENT, 'th1').coveredCount).toBe(ARCHIVE_BATCH_MESSAGES * 2);
  });

  it('零空洞不变量：逐条推进到 120 条，摘要覆盖与正文池始终无缝拼接', async () => {
    const history = new HistoryStore(root);
    const summary = makeSummary(history);
    const total = 120;

    for (let i = 0; i < total; i++) {
      await history.append('admin', AGENT, 'th1', {
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `m${i}`,
      });
      await summary.trigger('admin', AGENT, 'th1');

      const messages = history.readAll('admin', AGENT, 'th1');
      const { coveredCount } = summary.read('admin', AGENT, 'th1');
      const pool = messages.length - coveredCount;
      const at = `第 ${messages.length} 条（covered=${coveredCount}, pool=${pool}）`;

      expect(coveredCount + pool, at).toBe(messages.length);
      // ② 正文池永不超上限（否则说明入口侧要在兜底截断后出现空洞）
      expect(pool, at).toBeLessThanOrEqual(POOL_MAX_MESSAGES);
      if (messages.length >= POOL_MAX_MESSAGES) {
        expect(pool, at).toBeGreaterThanOrEqual(POOL_RESERVED_MESSAGES);
      }
    }
  });
});

describe('参数可注入', () => {
  it('poolMax 显式覆盖：30 条即触发归档', async () => {
    const history = new HistoryStore(root);
    const summary = makeSummary(history, { poolMax: 30 });
    await seed(history, 29);
    await summary.trigger('admin', AGENT, 'th1');
    expect(summary.read('admin', AGENT, 'th1').coveredCount).toBe(0);

    await seed(history, 1);
    await summary.trigger('admin', AGENT, 'th1');
    expect(summary.read('admin', AGENT, 'th1').coveredCount).toBe(ARCHIVE_BATCH_MESSAGES);
  });
});
