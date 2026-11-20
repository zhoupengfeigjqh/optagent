#!/usr/bin/env node
/**
 * 指代判定离线评测（027 / SC-001）。
 *
 * 逐条把标注集送进**真实 Laya**（`POST /v1/systemone`，单条 `noul` 命题），
 * 输出总准确率、代指召回（漏判率）与独立问句误判率，并按类别拆分。
 *
 * 用法：
 *   LAYA_BASE_URL=http://127.0.0.1:8103 \
 *   LAYA_API_KEY=dev-key \
 *   node scripts/eval-need-rewrite.mjs
 *
 *   node scripts/eval-need-rewrite.mjs --dry-run   # 不联网，只校验标注集与命题同源
 *
 * 退出码：0 = 达标（SC-001）；1 = 未达标 / 标注集不合规 / 命题与实现不同源；2 = 缺配置。
 *
 * 为什么是 .mjs 而不是 .ts：这是**离线人工执行**的评测脚本，不属于门禁路径
 * （见 plan「测试与验证策略」最后一行），用纯 ESM 可以直接 `node` 跑，
 * 不需要为它在仓库里引入 `tsx` 这类新依赖（宪章原则六）。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const FIXTURE = path.join('tests', 'fixtures', 'rewrite-labeled-set.json');
const PROMPT_SOURCE = path.join('src', 'domain', 'intent-focus', 'rewrite-prompt.ts');
const QID = 'need_rewrite';
/** 判定素材长度与 `state.ts` 的 `prepareState` 同口径（尾部 200 字） */
const STATE_MAX_CHARS = 200;
const CATEGORIES = ['anaphora', 'standalone', 'short', 'long_paste'];
const MIN_PER_CATEGORY = 6;
const MIN_TOTAL = 30;

const dryRun = process.argv.includes('--dry-run');
const baseUrl = (process.env.LAYA_BASE_URL ?? '').replace(/\/+$/, '');
const apiKey = process.env.LAYA_API_KEY ?? '';
const model = process.env.LAYA_MODEL ?? 'laya-multilingual';
const threshold = Number(process.env.REWRITE_THRESHOLD ?? 0.8);

function die(message, code = 1) {
  console.error(`\n[失败] ${message}`);
  process.exit(code);
}

/** 与 `prepareState` 同口径：只取尾部 200 字（长粘贴的评测必须与线上一致） */
function tailState(text) {
  const chars = Array.from(text.trim());
  return chars.length <= STATE_MAX_CHARS
    ? chars.join('')
    : chars.slice(chars.length - STATE_MAX_CHARS).join('');
}

/**
 * 从 TS 源码里取命题题面，并校验脚本内联的那份与它逐字一致。
 *
 * 为什么做这一步：评测脚本必须与线上问的是**同一个问题**，否则测出来的
 * 准确率与线上无关。TS 不能直接 import，因此在启动时做一次"同源校验"，
 * 任何一侧改文案都会立刻在评测里炸出来。
 */
function readQuestionFromSource() {
  if (!fs.existsSync(PROMPT_SOURCE)) die(`找不到命题源文件：${PROMPT_SOURCE}`);
  const source = fs.readFileSync(PROMPT_SOURCE, 'utf8');
  const matched = /instructions:\s*'([^']+)'/.exec(source);
  if (!matched) die('未能从 rewrite-prompt.ts 解析出 instructions（源文件结构已变？）');
  return matched[1];
}

function question() {
  return {
    type: 'noul',
    instructions: INSTRUCTIONS,
    criteria: {
      true: '含明确代指词（如上文、上述、这个、它、该结果）',
      false: '语义自足，不依赖上文即可理解',
    },
  };
}

const INSTRUCTIONS = '该输入含有明确代指，需结合上文才能理解';

function loadFixture() {
  if (!fs.existsSync(FIXTURE)) die(`找不到标注集：${FIXTURE}`);
  const payload = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length < MIN_TOTAL) die(`标注集不足：${items.length} < ${MIN_TOTAL}`);
  for (const category of CATEGORIES) {
    const count = items.filter((item) => item.category === category).length;
    if (count < MIN_PER_CATEGORY) die(`类别 ${category} 不足：${count} < ${MIN_PER_CATEGORY}`);
  }
  for (const item of items) {
    if (typeof item.text !== 'string' || item.text.trim() === '') die(`条目 ${item.id} 缺少 text`);
    if (typeof item.expect_need_rewrite !== 'boolean') die(`条目 ${item.id} 缺少 expect_need_rewrite`);
  }
  return items;
}

async function judge(state) {
  const res = await fetch(`${baseUrl}/v1/systemone`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ state, model, questions: { [QID]: question() } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`判定服务返回 ${res.status}`);
  const payload = await res.json();
  const noul = payload?.answers?.[QID]?.noul;
  if (typeof noul !== 'number' || !Number.isFinite(noul)) {
    throw new Error(`响应缺少 ${QID} 的 noul 分数`);
  }
  return noul;
}

async function main() {
  const sourceInstructions = readQuestionFromSource();
  if (sourceInstructions !== INSTRUCTIONS) {
    die(
      `命题与实现不同源：\n  脚本：${INSTRUCTIONS}\n  源码：${sourceInstructions}\n` +
        '请先同步 scripts/eval-need-rewrite.mjs 的 INSTRUCTIONS。',
    );
  }

  const items = loadFixture();
  console.log(`标注集 ${items.length} 条，阈值 ${threshold}，模型 ${model}`);
  console.log('命题同源校验：通过');

  if (dryRun) {
    const byCategory = Object.fromEntries(
      CATEGORIES.map((c) => [c, items.filter((i) => i.category === c).length]),
    );
    console.log('类别分布：', byCategory);
    console.log('\n[--dry-run] 未联网，以下为标注集内容：');
    for (const item of items) {
      console.log(
        `${item.id}\t${item.category}\t${item.expect_need_rewrite ? 'T' : 'F'}\t${item.text.slice(0, 40)}`,
      );
    }
    return;
  }

  if (!baseUrl) die('缺少 LAYA_BASE_URL（例如 http://127.0.0.1:8103）', 2);

  const rows = [];
  for (const item of items) {
    const score = await judge(tailState(item.text));
    const predicted = score > threshold;
    rows.push({ ...item, score, predicted, correct: predicted === item.expect_need_rewrite });
    const mark = predicted === item.expect_need_rewrite ? '✓' : '✗';
    console.log(`${mark} ${item.id}\t${item.score.toFixed(3)}\t${predicted ? '改写' : '不改'}\t${item.text.slice(0, 32)}`);
  }

  const total = rows.length;
  const correct = rows.filter((r) => r.correct).length;
  const accuracy = correct / total;

  // 误判率：期望"不改写"却被判为需要改写的比例（SC-001 ≤ 10%）
  const negatives = rows.filter((r) => r.expect_need_rewrite === false);
  const falsePositives = negatives.filter((r) => r.predicted === true);
  const fpRate = negatives.length === 0 ? 0 : falsePositives.length / negatives.length;

  // 漏判率：期望"改写"却判为不需要
  const positives = rows.filter((r) => r.expect_need_rewrite === true);
  const falseNegatives = positives.filter((r) => r.predicted === false);
  const fnRate = positives.length === 0 ? 0 : falseNegatives.length / positives.length;

  console.log('\n=== 结果 ===');
  console.log(`总准确率      ${(accuracy * 100).toFixed(1)}%  (${correct}/${total})`);
  console.log(`独立问句误判率 ${(fpRate * 100).toFixed(1)}%  (${falsePositives.length}/${negatives.length})`);
  console.log(`代指漏判率    ${(fnRate * 100).toFixed(1)}%  (${falseNegatives.length}/${positives.length})`);
  for (const category of CATEGORIES) {
    const subset = rows.filter((r) => r.category === category);
    const ok = subset.filter((r) => r.correct).length;
    console.log(`  ${category.padEnd(12)} ${ok}/${subset.length}`);
  }
  if (falsePositives.length > 0) {
    console.log('\n误判明细（期望不改写、却被判为需要改写）：');
    for (const row of falsePositives) console.log(`  ${row.id}\t${row.score.toFixed(3)}\t${row.text}`);
  }
  if (falseNegatives.length > 0) {
    console.log('\n漏判明细（期望改写、却判为不需要）：');
    for (const row of falseNegatives) console.log(`  ${row.id}\t${row.score.toFixed(3)}\t${row.text}`);
  }

  if (accuracy < 0.9 || fpRate > 0.1) {
    console.error('\n[未达标] SC-001 要求：准确率 ≥ 90% 且误判率 ≤ 10%');
    process.exit(1);
  }
  console.log('\n[达标] 准确率 ≥ 90%、误判率 ≤ 10%');
}

main().catch((err) => {
  console.error('\n[异常]', err instanceof Error ? err.message : err);
  process.exit(1);
});
