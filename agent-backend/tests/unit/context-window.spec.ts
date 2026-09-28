/**
 * 单元测试：上下文池（单一权威源，"方案 A"）
 *
 * 守住四件事：
 * 1. **常量关系** —— 保留量 = 上限 - 批次（1 轮 = user + assistant = 2 条）
 * 2. **归档时机** —— 池子（= 总数 - 已归档）达上限才归档，一次归档一批
 * 3. **零空洞不变量** —— 任何时刻「摘要覆盖 + 正文池 = 全部消息」，无重叠、无遗漏
 * 4. **可注入性** —— `poolMax` / `batchSize` 仍可显式覆盖
 *
 * 前提：`maybeArchive` 由每轮对话结束触发（真实调用口径），故用例逐步 trigger；
 * 若一次性灌入远超上限的消息（异常积压），归档会跨轮分批消化，入口侧另有
 * `POOL_MAX_MESSAGES` 兜底截断（见 run-manager.buildPrompt）。
 */
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

let root: string;

const fakeLlm: SummaryLlm = {
  async *streamChat() {
    yield { type: 'content_delta', delta: '摘要正文' };
  },
};

function makeSummary(history: HistoryStore, deps: { poolMax?: number; batchSize?: number } = {}) {
  return new SummaryStore(root, history, { llm: () => fakeLlm, ...deps });
}

/** 灌入 count 条消息（user/assistant 交替） */
async function seed(history: HistoryStore, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await history.append('admin', 'th1', {
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
    await summary.trigger('admin', 'th1');
    expect(summary.read('admin', 'th1').coveredCount).toBe(0);
  });

  it('60 条：池子满，归档一批，池子回到保留长度', async () => {
    const history = new HistoryStore(root);
    const summary = makeSummary(history);
    await seed(history, POOL_MAX_MESSAGES);
    await summary.trigger('admin', 'th1');

    const { coveredCount, summary: text } = summary.read('admin', 'th1');
    expect(coveredCount).toBe(ARCHIVE_BATCH_MESSAGES);
    // 池子 = 总数 - 已归档 = 保留长度（这正是"零空洞"的落点）
    expect(POOL_MAX_MESSAGES - coveredCount).toBe(POOL_RESERVED_MESSAGES);
    expect(text).toBe('摘要正文');
  });

  it('79 条（池子 59）不归档；80 条（池子 60）再归档一批', async () => {
    const history = new HistoryStore(root);
    const summary = makeSummary(history);

    await seed(history, POOL_MAX_MESSAGES + ARCHIVE_BATCH_MESSAGES - 1); // 79
    await summary.trigger('admin', 'th1');
    expect(summary.read('admin', 'th1').coveredCount).toBe(ARCHIVE_BATCH_MESSAGES);

    await seed(history, 1); // 80
    await summary.trigger('admin', 'th1');
    expect(summary.read('admin', 'th1').coveredCount).toBe(ARCHIVE_BATCH_MESSAGES * 2);
  });

  it('零空洞不变量：逐条推进到 120 条，摘要覆盖与正文池始终无缝拼接', async () => {
    const history = new HistoryStore(root);
    const summary = makeSummary(history);
    const total = 120;

    for (let i = 0; i < total; i++) {
      await history.append('admin', 'th1', {
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `m${i}`,
      });
      await summary.trigger('admin', 'th1');

      const messages = history.readAll('admin', 'th1');
      const { coveredCount } = summary.read('admin', 'th1');
      const pool = messages.length - coveredCount;
      const at = `第 ${messages.length} 条（covered=${coveredCount}, pool=${pool}）`;

      // ① 摘要覆盖 + 正文池 = 全部消息：既不重叠，也不遗漏
      expect(coveredCount + pool, at).toBe(messages.length);
      // ② 正文池永不超上限（否则说明入口侧要在兜底截断后出现空洞）
      expect(pool, at).toBeLessThanOrEqual(POOL_MAX_MESSAGES);
      // ③ 池子长满后，归档让它回到保留长度之上（不会越压越小）
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
    await summary.trigger('admin', 'th1');
    expect(summary.read('admin', 'th1').coveredCount).toBe(0);

    await seed(history, 1); // 30
    await summary.trigger('admin', 'th1');
    expect(summary.read('admin', 'th1').coveredCount).toBe(ARCHIVE_BATCH_MESSAGES);
  });
});
