// 意图聚焦（noul）提示语标定 / A/B 对比。
//
// 为什么要有 A/B：`instructions` 与 `criteria` 的措辞是**实测参数**，不是文案问题——
// 同一工具换一种问法，分数可能从 0.84 掉到 0.01（见 `src/domain/intent-focus.ts` 注释）。
// 换措辞必须用同一批业务输入跑两遍，看"命中 / 入选精确率 / 误选最高分"三项，而不是凭语感。
//
// 前置：
//   1) `npm run build`（脚本读 dist，不读源码——保证 current 模板与生产逐字一致）
//   2) Laya 已起在 8103：`docker compose up -d laya`（或 `docker run -p 8103:8000 ...`）
// 用法：
//   node scripts/calibrate-intent-focus.mjs [--prompt all|current|hybrid|proposed] [--threshold 0.5]
//                                          [--base http://127.0.0.1:8103] [--key dev-laya-key]
// 判读：
//   - `top1`：模型认得对的那个工具吗（语义方向对不对）；
//   - `入选精确率`：≥ 阈值被采纳的里边有多少是对的（直接影响聚焦提示质量）；
//   - `误选最高分`：不该入选的工具里分数最高的那个（阈值能不能切开，看这个比看精确率更早发现退化）；
//   - `召回`：该选的在不在（漏选比误选更隐蔽——用户只觉得"这次没聚焦"）。
import { argv } from 'node:process';
import { log, table } from 'node:console';

import {
  buildQuestions,
  displayNameOf,
  selectActions,
} from '../dist/src/domain/intent-focus.js';
import { LayaClient } from '../dist/src/infra/laya-client.js';

const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const BASE = arg('base', 'http://127.0.0.1:8103');
const KEY = arg('key', 'dev-laya-key');
const THRESHOLD = Number(arg('threshold', '0.5'));
const MODE = arg('prompt', 'all');

/** 候选工具（`label` 与生产同形：内置工具中文名 / MCP `server: tool`） */
const TOOLS = [
  { name: 'read_file', label: '读取文件', description: '读取用户上传或指定的本地文件' },
  { name: 'list_dir', label: '列目录', description: '列出目录内容以定位文件' },
  { name: 'erp__query_order', label: 'erp: query_order', description: '查询 ERP 订单的交付日期、数量与状态' },
  { name: 'erp__query_bom', label: 'erp: query_bom', description: '查询货品 BOM 与工艺路线' },
  { name: 'schedule_query', label: 'schedule: query', description: '查询排程与产能占用' },
  { name: 'web_search', label: '联网检索', description: '联网检索公开信息' },
  { name: 'calendar_query', label: 'calendar: query', description: '查询日历与会议安排' },
  { name: 'doc_summarize', label: '文档摘要', description: '对文档做摘要与要点抽取' },
];

/** 期望工具；`null` = 这一轮本来就不该调工具 */
const CASES = [
  { q: '这批订单按交付日期看，哪些可能延期？帮我梳理风险。', want: 'erp__query_order' },
  { q: '把 D:\\数据\\订单明细.xlsx 里的表头解释一下', want: 'read_file' },
  { q: '今天北京天气怎么样，适合安排户外施工吗', want: null },
  { q: '帮我写一段给客户的致歉邮件，说明交付延期两周', want: null },
  { q: '产能瓶颈在哪条产线？这周还剩多少可用工时', want: 'schedule_query' },
  { q: '这个月哪些订单的 BOM 还没齐套', want: 'erp__query_bom' },
  { q: '我刚上传的合同里的违约责任条款是怎么写的', want: 'read_file' },
  { q: '下周有哪些会议和客户拜访', want: 'calendar_query' },
  { q: '把这份 30 页的技术方案压成 5 条要点', want: 'doc_summarize' },
  { q: '订单 A1023 为什么延期，是物料问题还是产能问题', want: 'erp__query_order' },
];

/**
 * 提案模板：`本轮用户发起的任务是否需要使用 X ？` + `需要 / 不需要`。
 *
 * 展示名仍走生产的 `displayNameOf`（label 优先、40 字截断）——A/B 只改句式与判据，
 * 展示名保持一致，否则测出来的差异无法归因。
 */
function buildProposedQuestions(candidates) {
  const questions = {};
  for (const candidate of candidates) {
    questions[candidate.name] = {
      type: 'noul',
      instructions: `本轮用户发起的任务是否需要使用 ${displayNameOf(candidate)} ？`,
      criteria: { true: '需要', false: '不需要' },
    };
  }
  return questions;
}

/**
 * 折中模板：**只换判据**，句式保持生产现状。
 *
 * 存在的理由：两句改动的证据强度不同——"工具式句式"有实测支撑（任务式曾掉到 0.012），
 * "判据越朴素越好"只有方向性结论。分开测才能知道分数变化该归因给谁。
 */
function buildHybridQuestions(candidates) {
  const questions = {};
  for (const [name, question] of Object.entries(buildQuestions(candidates))) {
    questions[name] = { ...question, criteria: { true: '需要', false: '不需要' } };
  }
  return questions;
}

const TEMPLATES = {
  current: { title: '现状：是否要求使用 + 冗余判据', build: (tools) => buildQuestions(tools) },
  hybrid: { title: '折中：是否要求使用 + 极简判据', build: buildHybridQuestions },
  proposed: { title: '提案：任务是否需要使用 + 极简判据', build: buildProposedQuestions },
};

async function ensureReady() {
  try {
    const res = await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    log(`Laya 不可达（${BASE}/healthz）：${err.message}`);
    log('先起服务：docker compose up -d laya（冷启动约 2 分钟，readyz 就绪后再跑）');
    process.exit(1);
  }
}

/** 跑一套模板，返回逐条明细与汇总 */
async function evaluate(client, build) {
  const rows = [];
  const stat = { top1Hit: 0, selTotal: 0, selCorrect: 0, wantTotal: 0, wantHit: 0, noneOk: 0, noise: [], ms: [] };

  for (const c of CASES) {
    const started = Date.now();
    const decided = await client.decide(c.q, build(TOOLS));
    const ms = Date.now() - started;
    stat.ms.push(ms);

    if (!decided.ok) {
      rows.push({ q: c.q.slice(0, 12), want: c.want ?? '(无)', top1: `ERR:${decided.reason}`, sel: '-', ok: false, noise: '-', ms });
      continue;
    }

    const entries = Object.entries(decided.scores).sort((a, b) => b[1] - a[1]);
    const [topName, topScore] = entries[0] ?? ['(空)', 0];
    const picked = selectActions({ candidates: TOOLS, scores: decided.scores, threshold: THRESHOLD }).actions.map(
      (a) => a.tools[0],
    );
    const wrong = picked.filter((name) => name !== c.want);
    // 误选最高分：不该入选的工具里分最高的那个（越接近阈值越危险）
    const noise = wrong.length > 0 ? Math.max(...wrong.map((name) => decided.scores[name] ?? 0)) : 0;

    if (c.want === null) {
      if (picked.length === 0) stat.noneOk += 1;
    } else {
      stat.wantTotal += 1;
      if (picked.includes(c.want)) stat.wantHit += 1;
      if (topName === c.want) stat.top1Hit += 1;
    }
    stat.selTotal += picked.length;
    stat.selCorrect += picked.filter((name) => name === c.want).length;
    stat.noise.push(noise);

    // 展示只留前 3 个：noul 一旦切不开，入选集合会很长，全打印会把表格撑爆
    const selText =
      picked.length > 3
        ? `${picked.slice(0, 3).join(',')}…(${picked.length})`
        : picked.length > 0
          ? picked.join(',')
          : '(空)';
    rows.push({
      q: c.q.slice(0, 12),
      want: c.want ?? '(无)',
      top1: `${topName} ${topScore.toFixed(3)}`,
      sel: selText,
      ok: c.want === null ? picked.length === 0 : picked.includes(c.want),
      noise: noise.toFixed(3),
      ms,
    });
  }

  const noneTotal = CASES.filter((c) => c.want === null).length;
  const avg = (list) => (list.length > 0 ? list.reduce((s, v) => s + v, 0) / list.length : 0);
  return {
    rows,
    summary: {
      top1: `${stat.top1Hit}/${stat.wantTotal}`,
      precision: stat.selTotal > 0 ? `${stat.selCorrect}/${stat.selTotal}` : '—',
      recall: `${stat.wantHit}/${stat.wantTotal}`,
      none: `${stat.noneOk}/${noneTotal}`,
      noiseMax: avg(stat.noise).toFixed(3),
      ms: Math.round(avg(stat.ms)),
    },
  };
}

const client = new LayaClient({ baseUrl: BASE, model: 'laya-multilingual', apiKey: KEY, timeoutMs: 8000 });

await ensureReady();

const modes = MODE === 'all' || MODE === 'both' ? Object.keys(TEMPLATES) : [MODE];
const results = {};
for (const mode of modes) {
  const template = TEMPLATES[mode];
  if (!template) {
    log(`未知 --prompt：${mode}（可选 all / current / hybrid / proposed）`);
    process.exit(1);
  }
  log(`\n=== ${mode}｜${template.title} ===`);
  const result = await evaluate(client, template.build);
  results[mode] = result;
  table(result.rows);
  log(
    `汇总：top1 ${result.summary.top1}｜精确率 ${result.summary.precision}｜召回 ${result.summary.recall}｜` +
      `无工具 ${result.summary.none}｜误选最高分 ${result.summary.noiseMax}｜平均 ${result.summary.ms}ms`,
  );
}

if (modes.length > 1) {
  log('\n=== 汇总对比（top1 / 精确率 / 召回 / 无工具 越大越好；误选最高分越小越好）===');
  table(
    modes.map((mode) => ({
      模板: mode,
      top1: results[mode].summary.top1,
      精确率: results[mode].summary.precision,
      召回: results[mode].summary.recall,
      无工具: results[mode].summary.none,
      误选最高分: results[mode].summary.noiseMax,
      平均ms: results[mode].summary.ms,
    })),
  );
}
log(`\nthreshold=${THRESHOLD}｜口径：noul 分数非概率，阈值需按候选集标定`);
