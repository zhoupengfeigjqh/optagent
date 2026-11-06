/**
 * 稳定性实验：同一输入连跑 N 次，量化技能层 noul 分数的抖动区间。
 *
 * 与线上链路一致：真实 `loadConfig` + 真实 `LayaClient` + 真实技能候选构造
 * （`loadSkillHeaders` → `loadOntologyIndex` → `buildSkillCandidates` → `buildSkillQuestions`），
 * 只测**技能批**（能力层依赖技能入选，技能不过线就短路）。
 *
 * 运行：`npx tsx --env-file=.env.local scripts/laya-stability.ts`
 */
import { buildSkillQuestions } from '../src/domain/intent-focus/candidates.js';
import { loadFocusEnv, loadFocusFixture } from './lib/focus-fixture.js';

const INPUT = '高强度钢板的供应商是谁';
const RUNS = 5;

const env = loadFocusEnv();
const { config, client, skillResult } = loadFocusFixture(env);

async function main(): Promise<void> {
  const questions = buildSkillQuestions(skillResult.candidates);

  console.log(`state = ${JSON.stringify(INPUT)}`);
  console.log(`技能候选 ${Object.keys(questions).length} 道：`);
  for (const [qid, q] of Object.entries(questions)) {
    console.log(`  ${qid}  ${q.instructions}`);
  }
  console.log('');

  const scores: number[] = [];
  for (let i = 1; i <= RUNS; i++) {
    const result = await client.decide(INPUT, questions, config.timeoutMs);
    const score = result.ok ? (result.scores.s1 ?? Number.NaN) : Number.NaN;
    scores.push(score);
    console.log(
      `第 ${i} 次  s1 noul = ${result.ok ? (result.scores.s1 ?? '(缺)').toFixed(4) : `失败:${result.reason}`}`,
    );
  }

  const valid = scores.filter((n) => Number.isFinite(n));
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  console.log('\n===== 抖动统计 =====');
  console.log(`样本：${valid.map((n) => n.toFixed(4)).join('、')}`);
  console.log(`min=${min.toFixed(4)}  max=${max.toFixed(4)}  均值=${mean.toFixed(4)}`);
  console.log(`阈值 0.8 → 过线次数 ${valid.filter((n) => n > 0.8).length}/${valid.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
