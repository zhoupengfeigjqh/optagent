/**
 * 实验脚本：意图聚焦判定（**真实调用 Laya**，与线上链路一致）。
 *
 * 与 `consumeTurn` 里 `IntentFocusRunner.judge` 走完全相同的路径：
 * `loadConfig` 读真实 `config.yaml`（解析 `$DECIS_API_KEY`）→ `LayaClient` 真调
 * `POST /v1/systemone` → 真实 `IntentFocusRunner`（真实数据目录 + 真实分批判定）。
 *
 * 唯一两处差异（对判定结果无影响，仅用于观测/不污染数据）：
 * 1. `client` 包了一层，把每道题面与真实 noul 分数打印出来；
 * 2. 不传 `store`——留档省略（否则会写进 `生产调度测试/threads/exp-thread`）。
 *
 * 运行：`npx tsx --env-file=.env.local scripts/intent-focus-experiment.ts`
 * （`--env-file` 提供 `DECIS_API_KEY`，与 dev 脚本同款）。
 */
import {
  IntentFocusRunner,
  type IntentFocusClient,
} from '../src/domain/intent-focus/runner.js';
import { loadFocusEnv } from './lib/focus-fixture.js';

const { root, user, agent, config: focus, client: real } = loadFocusEnv();
const INPUT = '高强度钢板的供应商是谁';

/** 包装真实 LayaClient：只加打印，不改任何请求参数与返回值 */
const client: IntentFocusClient = {
  async decide(state, questions, timeoutMs) {
    console.log(
      `\n===== 调用 Laya /v1/systemone（state=${JSON.stringify(state)}，共 ${
        Object.keys(questions).length
      } 题）=====`,
    );
    for (const [qid, q] of Object.entries(questions)) {
      console.log(`  ${qid.padEnd(4)} ${q.instructions}`);
    }
    const result = await real.decide(state, questions, timeoutMs);
    if (result.ok) {
      for (const [qid] of Object.entries(questions)) {
        const score = result.scores[qid];
        console.log(`  -> ${qid.padEnd(4)} noul = ${score === undefined ? '(缺)' : score.toFixed(4)}`);
      }
    } else {
      console.log(
        `  -> 判定失败：${result.reason}${result.status ? `(${result.status})` : ''} ${result.message}`,
      );
    }
    return result;
  },
};

async function main(): Promise<void> {
  const runner = new IntentFocusRunner({
    root,
    config: focus,
    client,
    isEnabled: () => true,
  });

  console.log(`输入原文：${INPUT}`);
  const result = await runner.judge({
    userId: user,
    agentName: agent,
    threadId: 'exp-thread',
    messageId: 'exp-m',
    userInput: INPUT,
    skip: false,
  });

  console.log('\n===== 聚焦提示（追加到 systemExtra）=====');
  console.log(result.prompt === '' ? '（空串 = 本轮无聚焦提示）' : result.prompt);
  console.log('\n===== toolTips（下一步卡片候选范围）=====');
  console.log(JSON.stringify(result.toolTips, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
