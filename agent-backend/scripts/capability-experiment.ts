import { prepareState } from '../src/domain/intent-focus/state.js';
import {
  buildCapabilityCandidates,
  buildCapabilityQuestions,
} from '../src/domain/intent-focus/candidates.js';
import { loadFocusEnv, loadFocusFixture } from './lib/focus-fixture.js';

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
