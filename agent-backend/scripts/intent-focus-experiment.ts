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
 * **两种模式**（2026-11-08 合并原 `laya-stability.ts`：两者共用同一套 fixture 装配，
 * 分成两个入口只会让"改一处漏一处"）：
 * - 默认（`--runs` 缺省或 1）：完整判定一次，打印聚焦提示与 `toolTips`；
 * - `--runs N`（N > 1）：只测**技能批**（能力层依赖技能入选，技能不过线就短路），
 *   同一输入连跑 N 次，量化 noul 分数的抖动区间，供阈值定标。
 *
 * 运行：
 *   npx tsx --env-file=.env.local scripts/intent-focus-experiment.ts
 *   npx tsx --env-file=.env.local scripts/intent-focus-experiment.ts --runs 5
 * （`--env-file` 提供 `DECIS_API_KEY`，与 dev 脚本同款）。
 */
import { buildSkillQuestions } from '../src/domain/intent-focus/candidates.js';
import {
  IntentFocusRunner,
  type IntentFocusClient,
} from '../src/domain/intent-focus/runner.js';
import { loadFocusEnv, loadFocusFixture } from './lib/focus-fixture.js';

const INPUT = '高强度钢板的供应商是谁';

const env = loadFocusEnv();
const { root, user, agent, config: focus, client: real } = env;

/** 抖动样本的过线阈值：与 config.yaml 的技能层阈值同一口径 */
const PASS_THRESHOLD = 0.8;

/** `--runs N`：缺省 1（完整判定一次）；非法值按 1 处理，不抛错 */
function parseRuns(argv: readonly string[]): number {
  const at = argv.indexOf('--runs');
  if (at < 0) return 1;
  const parsed = Number(argv[at + 1]);
  return Number.isInteger(parsed) && parsed > 1 ? parsed : 1;
}

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

/** 默认模式：完整判定一次（技能批 + 能力批） */
async function runJudgeOnce(): Promise<void> {
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

/** `--runs N` 模式：只测技能批，连跑 N 次看抖动 */
async function runStability(runs: number): Promise<void> {
  const fixture = loadFocusFixture(env);
  const questions = buildSkillQuestions(fixture.skillResult.candidates);

  console.log(`输入原文：${INPUT}`);
  console.log(`技能候选 ${Object.keys(questions).length} 道：`);
  for (const [qid, q] of Object.entries(questions)) {
    console.log(`  ${qid}  ${q.instructions}`);
  }

  const scores: number[] = [];
  for (let i = 1; i <= runs; i++) {
    const result = await real.decide(INPUT, questions, focus.timeoutMs);
    const score = result.ok ? (result.scores.s1 ?? Number.NaN) : Number.NaN;
    scores.push(score);
    // 分三支写而不是嵌套三元：`(数字 | '(缺)').toFixed()` 在 strict 下不成立（types 收窄需要显式分支）
    let shown: string;
    if (!result.ok) shown = `失败:${result.reason}`;
    else if (result.scores.s1 === undefined) shown = '(缺)';
    else shown = result.scores.s1.toFixed(4);
    console.log(`第 ${i} 次  s1 noul = ${shown}`);
  }

  const valid = scores.filter((n) => Number.isFinite(n));
  if (valid.length === 0) {
    console.log('\n===== 抖动统计 =====');
    console.log('全部调用失败，无有效样本');
    return;
  }

  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  console.log('\n===== 抖动统计 =====');
  console.log(`样本：${valid.map((n) => n.toFixed(4)).join('、')}`);
  console.log(
    `min=${Math.min(...valid).toFixed(4)}  max=${Math.max(...valid).toFixed(4)}  均值=${mean.toFixed(4)}`,
  );
  console.log(
    `阈值 ${PASS_THRESHOLD} → 过线次数 ${valid.filter((n) => n > PASS_THRESHOLD).length}/${valid.length}`,
  );
}

async function main(): Promise<void> {
  const runs = parseRuns(process.argv);
  if (runs > 1) {
    await runStability(runs);
    return;
  }
  await runJudgeOnce();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
