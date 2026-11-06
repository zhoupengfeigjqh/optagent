/**
 * 实验脚本：本体能力聚焦（016 能力层）——**技能默认通过**，只测行为。
 *
 * 为什么跳过技能层：技能层 noul 分数受阈值 0.8 卡口，实测「高强度钢板的供应商是谁」
 * 对 raw-material-inventory 只有 0.69，还没到能力层就短路了。能力层（行为）才是
 * 真正决定「下一步动作卡片」候选范围的一层，需要单独标定。
 *
 * 与线上链路一致（唯一差异：技能层判定替换成"全部默认通过"）：
 *   loadSkillHeaders → loadOntologyIndex → buildSkillCandidates →（全部入选）→
 *   buildCapabilityCandidates → buildCapabilityQuestions → LayaClient.decide。
 *
 * 运行：`npx tsx --env-file=.env.local scripts/capability-experiment.ts`
 */
import { prepareState } from '../src/domain/intent-focus/state.js';
import {
  buildCapabilityCandidates,
  buildCapabilityQuestions,
} from '../src/domain/intent-focus/candidates.js';
import { loadFocusEnv, loadFocusFixture } from './lib/focus-fixture.js';

/** 测试用例：`state` = 实际送入判定的输入；`want` = 期望命中的行为名（仅用于对照） */
const CASES: Array<{ state: string; want: string }> = [
  { state: '帮我查一下高强度钢板的库存还有多少', want: 'QueryInventory' },
  { state: '创建一笔高强度钢板的采购单，从宝钢采购 50 吨，11 月 10 号到位', want: 'CreatePurchaseRecord' },
  { state: 'PO-20231027-001 这批货到了，帮我办理入库', want: 'ReceiveRawMaterial' },
  { state: '查一下最近高强度钢板的采购记录', want: 'QueryPurchaseRecords' },
  { state: 'XX钢铁集团的联系人和电话是多少', want: 'QuerySuppliers' },
  { state: '宝钢供应高强度钢板的交货周期和最小起订量', want: 'QuerySupplierCapability' },
  { state: '那张还没入库的采购单帮我取消掉', want: 'CancelPurchaseRecord' },
  { state: '高强度钢板的基本信息，单位和安全库存', want: 'QueryRawMaterials' },
];

const env = loadFocusEnv();
const { config, client, index, skillResult } = loadFocusFixture(env);

async function main(): Promise<void> {
  const capabilityResult = buildCapabilityCandidates(
    skillResult.candidates,
    index,
    config.maxCapabilities,
  );
  const questions = buildCapabilityQuestions(capabilityResult.candidates);

  console.log(`技能候选（默认通过）：${skillResult.candidates.map((c) => c.header.name).join('、')}`);
  console.log(`行为候选 ${capabilityResult.candidates.length} 道（阈值 ${config.ontologyThreshold}）：`);
  for (const c of capabilityResult.candidates) {
    console.log(`  ${c.qid.padEnd(4)} [行为] ${questions[c.qid]!.instructions}`);
  }
  console.log('');

  for (const { state, want } of CASES) {
    const prepared = prepareState(state);
    const result = await client.decide(prepared.state, questions, config.timeoutMs);
    console.log(`===== state = "${prepared.state}"${prepared.truncated ? '（已截断）' : ''} ｜ 期望=${want} =====`);

    if (!result.ok) {
      console.log(`  -> 判定失败：${result.reason}${result.status ? `(${result.status})` : ''} ${result.message}\n`);
      continue;
    }

    const entries = capabilityResult.candidates
      .map((c) => ({ c, score: result.scores[c.qid] }))
      .filter((e) => typeof e.score === 'number')
      .sort((a, b) => (b.score as number) - (a.score as number));

    for (const { c, score } of entries) {
      const pass = (score as number) > config.ontologyThreshold;
      const title = c.title || c.name;
      console.log(`  ${(score as number).toFixed(4)}  ${pass ? '✓' : ' '}  ${c.qid.padEnd(4)} 行为「${title}」`);
    }

    const passed = entries.filter((e) => (e.score as number) > config.ontologyThreshold);
    const hit = passed.some((e) => e.c.name === want);
    console.log(
      `  >> 入选 ${passed.length} 项：${passed.map((e) => `「${e.c.title || e.c.name}」`).join('、') || '（无）'} ｜ 期望命中=${hit ? '是' : '否'}\n`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
