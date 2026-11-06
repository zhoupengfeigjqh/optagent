/**
 * 单元测试：下一步动作提示（007 修订 · Tail Protocol + 016 能力驱动）。
 *
 * 分五组守住五条硬约束（口径见 `src/domain/next-actions.ts` 文件头）：
 * - **解析与合规**：模型输出脏（代码块围栏 / 裸数组 / 超长 / 夹工具名 / 非祈使句 / 指代）时逐条丢弃；
 * - **`tool_tips` 不校验**：只读字段与截断到 5 条，不比对运行时工具、不查名字是否在目录、不去重、不改写；
 * - **尾部块捕获**：`<next_actions>` 块对用户完全不可见，正文逐字无损（跨增量 / 误前缀 / 块后正文）；
 * - **轮末定稿**：同步解析 + 原子写快照，永不抛错；明确 0 条不告警、非法输出与"全部不合规"告警附归因；
 * - **存储**：会话级单快照（只留最新一轮）、`clear` 同步清空、读取侧按新形状过滤旧口径快照。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_ACTIONS,
  MAX_TOOL_TIPS_PER_ACTION,
  NextActionsStore,
  PROMPT_MAX_CHARS,
  buildTailInstruction,
  effectiveNextActionsMax,
  isCompliantPrompt,
  parseActions,
  renderToolTipsInstruction,
  sanitizeActions,
  sanitizeActionsWithStats,
  type NextActionsFinalizeInput,
} from '../../src/domain/next-actions.js';
import { TailCapture } from '../../src/domain/next-actions-tail.js';
import { threadDir } from '../../src/domain/dirs.js';
import type { FocusToolTip } from '../../src/domain/intent-focus/types.js';

const TOOL_TIPS: FocusToolTip[] = [
  {
    name: 'QueryPurchaseRecords',
    title: '查询采购订单信息',
    ontology_id: '1',
    ontology_name: '采购管理',
  },
  { name: 'QueryInventory', title: '查询库存数量', ontology_id: '1', ontology_name: '采购管理' },
];

function action(prompt: string, toolTips?: unknown[]): Record<string, unknown> {
  return { prompt, ...(toolTips === undefined ? {} : { tool_tips: toolTips }) };
}

/** 合法绑定：模型从目录里照抄的第一条 */
const bound = (prompt: string): Record<string, unknown> => action(prompt, [TOOL_TIPS[0]]);

describe('parseActions —— 输出容错解析', () => {
  it('顶层裸数组 / 对象包裹 / 代码块围栏三种形态都能解析', () => {
    expect(parseActions('[{"prompt":"甲"}]')).toEqual([{ prompt: '甲' }]);
    expect(parseActions('{"actions":[{"prompt":"甲"}]}')).toEqual([{ prompt: '甲' }]);
    expect(parseActions('```json\n{"actions":[{"prompt":"甲"}]}\n```')).toEqual([{ prompt: '甲' }]);
    expect(parseActions('```\n[{"prompt":"甲"}]\n```')).toEqual([{ prompt: '甲' }]);
  });

  it('非法 JSON / 空串 / 不是数组 → 空（不抛错）', () => {
    expect(parseActions('')).toEqual([]);
    expect(parseActions('   ')).toEqual([]);
    expect(parseActions('模型说：我建议你……')).toEqual([]);
    expect(parseActions('{"actions":"不是数组"}')).toEqual([]);
    expect(parseActions('42')).toEqual([]);
  });
});

describe('isCompliantPrompt —— 合规判定（唯一实现）', () => {
  const toolNames = new Set(['QueryPurchaseRecords']);

  it('祈使句且不超过 50 字 → 通过；51 字 / 空串 → 丢弃', () => {
    expect(isCompliantPrompt('甲'.repeat(PROMPT_MAX_CHARS), toolNames)).toBe(true);
    expect(isCompliantPrompt('甲'.repeat(PROMPT_MAX_CHARS + 1), toolNames)).toBe(false);
    expect(isCompliantPrompt('', toolNames)).toBe(false);
  });

  it('命中本体能力名（大小写不敏感）→ 丢弃', () => {
    expect(isCompliantPrompt('先用 QueryPurchaseRecords 看一下', toolNames)).toBe(false);
    expect(isCompliantPrompt('调用 QUERYPURCHASERECORDS 查订单', toolNames)).toBe(false);
  });

  it('含 snake_case / kebab-case / CamelCase 形态 token → 丢弃（即便不在目录里）', () => {
    expect(isCompliantPrompt('先做 query_order 再汇报', toolNames)).toBe(false);
    expect(isCompliantPrompt('看看 data-prep 里的表', toolNames)).toBe(false);
    expect(isCompliantPrompt('用 QueryOrder 查订单', toolNames)).toBe(false);
  });

  it('普通拉丁词不误杀（"Excel 文件"是合法中文表述）', () => {
    expect(isCompliantPrompt('整理 Excel 文件的表头', toolNames)).toBe(true);
    expect(isCompliantPrompt('把结果导出为 CSV 清单', toolNames)).toBe(true);
  });

  it('016：陈述 / 疑问 / 条件 / 建议式开头一律不是祈使句', () => {
    expect(isCompliantPrompt('你可以先查一下订单', toolNames)).toBe(false);
    expect(isCompliantPrompt('建议核对这批发票', toolNames)).toBe(false);
    expect(isCompliantPrompt('是否需要看看库存', toolNames)).toBe(false);
    expect(isCompliantPrompt('如果缺料就补货', toolNames)).toBe(false);
  });

  it('016：含指代 / 占位表述（信息不明确）→ 丢弃', () => {
    expect(isCompliantPrompt('查询这个订单', toolNames)).toBe(false);
    expect(isCompliantPrompt('梳理相关数据', toolNames)).toBe(false);
  });
});

describe('sanitizeActions —— 只校验 prompt；tool_tips 原样透传', () => {
  it('tool_tips 原样保留（不补字段、不改写、不比对运行时工具）', () => {
    const raw = action('查询高强度钢板的采购单记录', [
      { name: 'QueryPurchaseRecords', title: '查询采购订单信息', ontology_id: '1', ontology_name: '采购管理' },
    ]);
    const out = sanitizeActions([raw], TOOL_TIPS);

    expect(out).toHaveLength(1);
    expect(out[0]!.tool_tips).toEqual([
      { name: 'QueryPurchaseRecords', title: '查询采购订单信息', ontology_id: '1', ontology_name: '采购管理' },
    ]);
  });

  it('016：目录外的名字照旧保留（不校验存在性）', () => {
    const out = sanitizeActions(
      [action('核对这批发票的金额', [{ name: 'NotInCatalog', title: '随便写的', ontology_id: '999', ontology_name: null }])],
      TOOL_TIPS,
    );

    expect(out[0]!.tool_tips[0]!.name).toBe('NotInCatalog');
  });

  it('016：字段缺失 / 元素非对象 → 字段留空，条目照留（卡片不消失）', () => {
    const out = sanitizeActions([action('核对这批发票的金额', [{}, 'oops'])], TOOL_TIPS);

    expect(out).toHaveLength(1);
    expect(out[0]!.tool_tips).toEqual([
      { name: '', title: '', ontology_id: '', ontology_name: null },
      { name: '', title: '', ontology_id: '', ontology_name: null },
    ]);
  });

  it('016：`tool_tips` 缺失 → 空数组，卡片照常下发', () => {
    const out = sanitizeActions([action('核对这批发票的金额')], TOOL_TIPS);

    expect(out).toHaveLength(1);
    expect(out[0]!.tool_tips).toEqual([]);
  });

  it('016：单卡 `tool_tips` 超过 5 条 → 截断到 5 条（唯一的数据处理）', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      name: `T${i}`,
      title: `能力${i}`,
      ontology_id: '1',
      ontology_name: '采购管理',
    }));
    const out = sanitizeActions([action('核对这批发票的金额', many)], TOOL_TIPS);

    expect(out[0]!.tool_tips).toHaveLength(MAX_TOOL_TIPS_PER_ACTION);
    expect(out[0]!.tool_tips.map((t) => t.name)).toEqual(['T0', 'T1', 'T2', 'T3', 'T4']);
  });

  it('不合规条目只丢自己；重复提示词去重；条数超上限取前 N 条', () => {
    const raw = [
      bound('甲'.repeat(PROMPT_MAX_CHARS + 1)), // 超长 → 丢
      bound(''), // 空 → 丢
      bound('先做 query_order'), // 夹标识符 → 丢
      { prompt: 123, tool_tips: [TOOL_TIPS[0]] }, // 类型错 → 丢
      'not-an-object',
      bound('整理共享空间的表格'),
      bound('整理共享空间的表格'), // 重复 → 丢
      bound('按交付日期梳理订单风险'),
      bound('按月汇总这批订单的数量'),
      bound('第四条应当被条数上限截掉'),
    ];

    const out = sanitizeActions(raw, TOOL_TIPS);

    expect(out.map((a) => a.prompt)).toEqual([
      '整理共享空间的表格',
      '按交付日期梳理订单风险',
      '按月汇总这批订单的数量',
    ]);
    expect(out).toHaveLength(MAX_ACTIONS);
  });

  it('丢弃归因可分辨（原则九）：只统计 prompt 不合规与超上限', () => {
    const { actions, stats } = sanitizeActionsWithStats(
      [bound('按交付日期梳理订单风险'), action('建议核对这批发票'), 'not-an-object'],
      TOOL_TIPS,
    );

    expect(actions.map((a) => a.prompt)).toEqual(['按交付日期梳理订单风险']);
    expect(stats.droppedOther).toBe(2);
    expect(stats.droppedOverLimit).toBe(0);
  });
});

/* ---------- 尾部块捕获与轮末定稿（007 修订 · Tail Protocol） ---------- */

let root: string;
let warns: string[];

const logger = () => ({ warn: (msg: string) => warns.push(msg) });

/** 本用例使用的数字人（夹具路径与 `finInput.agentName` 同值） */
const AGENT = 'demo';

function file(userId: string, agentName: string, threadId: string): string {
  return path.join(threadDir(root, userId, agentName, threadId), 'next-actions.json');
}

function finInput(overrides: Partial<NextActionsFinalizeInput> = {}): NextActionsFinalizeInput {
  return {
    userId: 'admin',
    threadId: 'th_1',
    messageId: 'm-1',
    agentName: 'demo',
    tailText: JSON.stringify({
      actions: [bound('按交付日期梳理订单风险'), bound('按月汇总这批订单的数量')],
    }),
    focusToolTips: TOOL_TIPS,
    max: MAX_ACTIONS,
    ...overrides,
  };
}

function store() {
  return new NextActionsStore(root, { logger: logger() });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'next-actions-'));
  warns = [];
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('TailCapture —— 尾部块捕获状态机（用户永不可见块内容）', () => {
  it('整块一次到达：正文转发，块内容全部吞掉', () => {
    const t = new TailCapture();
    expect(t.push('回答正文')).toBe('回答正文');
    expect(t.push('<next_actions>{"actions":[]}</next_actions>')).toBe('');
    expect(t.flush()).toBe('');
    expect(t.captured).toBe('{"actions":[]}');
  });

  it('开标签跨增量拆分：逐字暂扣，正文完整、无重复', () => {
    const t = new TailCapture();
    let out = '';
    for (const ch of '正文<next_actions>A</next_actions>') out += t.push(ch);
    out += t.flush();
    expect(out).toBe('正文');
    expect(t.captured).toBe('A');
  });

  it('疑似前缀误判（正文真写了半截标签样文本）→ 冲刷为正文，不丢失', () => {
    const t = new TailCapture();
    let out = t.push('前面提到 <next_act');
    expect(out).toBe('前面提到 ');
    out += t.push(' 中的内容继续');
    out += t.flush();
    expect(out).toBe('前面提到 <next_act 中的内容继续');
    expect(t.captured).toBe('');
  });

  it('闭标签后的内容恢复正常转发（容错块后继续说话）', () => {
    const t = new TailCapture();
    const out = t.push('<next_actions>{"actions":[]}</next_actions>补充说明');
    expect(out).toBe('补充说明');
    expect(t.captured).toBe('{"actions":[]}');
  });

  it('双块取首：完整捕获后第二个块按正文转发', () => {
    const t = new TailCapture();
    t.push('<next_actions>{"actions":[]}</next_actions>');
    expect(t.push('<next_actions>x</next_actions>')).toBe('<next_actions>x</next_actions>');
    expect(t.captured).toBe('{"actions":[]}');
  });

  it('开标签未见闭标签（流在捕获中结束）→ 捕获到半截原文，交由解析层判非法', () => {
    const t = new TailCapture();
    t.push('正文<next_actions>{"actions":[');
    expect(t.captured).toBe('{"actions":[');
  });

  it('超限兜底：丢弃卡片，后续正文恢复转发（降级不打扰用户）', () => {
    const t = new TailCapture();
    t.push('<next_actions>' + 'x'.repeat(64 * 1024 + 1));
    expect(t.overflowed).toBe(true);
    expect(t.captured).toBe('');
    expect(t.push('后续正文')).toBe('后续正文');
  });
});

describe('NextActionsStore.finalize —— 轮末同步定稿（永不抛错）', () => {
  it('合法尾部 → 写快照 + 返回下发形态（prompt + tool_tips）', () => {
    const view = store().finalize(finInput());

    expect(view?.message_id).toBe('m-1');
    expect(view?.actions.map((a) => a.prompt)).toEqual([
      '按交付日期梳理订单风险',
      '按月汇总这批订单的数量',
    ]);
    const snapshot = JSON.parse(fs.readFileSync(file('admin', AGENT, 'th_1'), 'utf8')) as {
      message_id: string;
      agent_name: string;
      created_at: string;
      actions: Array<{ prompt: string; tool_tips: FocusToolTip[] }>;
    };
    expect(snapshot.message_id).toBe('m-1');
    expect(snapshot.agent_name).toBe('demo');
    expect(snapshot.created_at).toBeTruthy();
    expect(snapshot.actions[0]!.tool_tips).toEqual([TOOL_TIPS[0]]);
    expect(warns.filter((w) => w.includes('下一步动作提示'))).toEqual([]);
  });

  it('空尾部（开关关闭 / 模型省略）→ 不写快照、不告警', () => {
    expect(store().finalize(finInput({ tailText: '' }))).toBeUndefined();
    expect(fs.existsSync(file('admin', AGENT, 'th_1'))).toBe(false);
    expect(warns).toEqual([]);
  });

  it('产出 0 条（模型**明确**判定"无需下一步"）→ 不写快照，且**不告警**（FR-005）', () => {
    expect(store().finalize(finInput({ tailText: '{"actions":[]}' }))).toBeUndefined();

    expect(fs.existsSync(file('admin', AGENT, 'th_1'))).toBe(false);
    expect(warns.filter((w) => w.includes('下一步动作提示'))).toEqual([]);
  });

  it('输出非法 → 不写快照，且告警附原文节选（FR-041）', () => {
    expect(store().finalize(finInput({ tailText: '我觉得可以先看看订单' }))).toBeUndefined();

    expect(fs.existsSync(file('admin', AGENT, 'th_1'))).toBe(false);
    const warned = warns.find((w) => w.includes('尾部块非法或为空'));
    expect(warned).toBeDefined();
    expect(warned).toContain('msg=m-1');
    expect(warned).toContain('我觉得可以先看看订单');
  });

  it('有候选条目但 prompt 全不合规 → 不写快照，且告警给出候选条数（FR-041）', () => {
    const tail = JSON.stringify({
      actions: [bound('建议核对这批发票'), bound('你可以先查一下订单')],
    });

    expect(store().finalize(finInput({ tailText: tail }))).toBeUndefined();

    expect(fs.existsSync(file('admin', AGENT, 'th_1'))).toBe(false);
    const warned = warns.find((w) => w.includes('全部被丢弃'));
    expect(warned).toBeDefined();
    expect(warned).toContain('候选 2 条');
    expect(warned).toContain('prompt 不合规 2');
  });

  it('部分条目 prompt 不合规 → 其余照常下发，并留痕可归因', () => {
    const tail = JSON.stringify({
      actions: [bound('按交付日期梳理订单风险'), bound('建议核对这批发票')],
    });

    const view = store().finalize(finInput({ tailText: tail }));

    expect(view?.actions.map((a) => a.prompt)).toEqual(['按交付日期梳理订单风险']);
    const warned = warns.find((w) => w.includes('部分条目 prompt 不合规'));
    expect(warned).toBeDefined();
    expect(warned).toContain('不合规 1');
    expect(warned).toContain('保留 1 条');
  });

  it('条数上限压到 2（SOUL 配置与提示词同源）→ 只落 2 条', () => {
    const tail = JSON.stringify({
      actions: [bound('第一条'), bound('第二条'), bound('第三条'), bound('第四条')],
    });

    store().finalize(finInput({ tailText: tail, max: 2 }));

    const snapshot = JSON.parse(fs.readFileSync(file('admin', AGENT, 'th_1'), 'utf8')) as {
      actions: Array<{ prompt: string }>;
    };
    expect(snapshot.actions.map((a) => a.prompt)).toEqual(['第一条', '第二条']);
  });

  it('写盘失败 → 永不抛错、不返回卡片视图（done 不带、刷新也不残留旧卡）', () => {
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });
    try {
      expect(store().finalize(finInput())).toBeUndefined();
      expect(warns.some((w) => w.includes('写入失败'))).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('NextActionsStore —— 读取与清空', () => {
  it('read 下发形态：message_id + 动作（tool_tips 原样）', () => {
    store().finalize(finInput());

    const view = store().read('admin', AGENT, 'th_1');

    expect(view?.message_id).toBe('m-1');
    expect(view?.actions[0]).toMatchObject({
      prompt: '按交付日期梳理订单风险',
      tool_tips: [TOOL_TIPS[0]],
    });
  });

  it('读取侧不按"当前选中数字人"过滤——快照在即下发（作用域由路径承载，009）', () => {
    store().finalize(finInput());
    expect(store().read('admin', AGENT, 'th_1')?.message_id).toBe('m-1');
  });

  it('存量快照：旧口径（tools / guidance）条目在读取侧被过滤', () => {
    const target = file('admin', AGENT, 'th_1');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      JSON.stringify({
        message_id: 'm-old',
        agent_name: 'demo',
        created_at: new Date().toISOString(),
        actions: [
          { prompt: '旧口径的无工具卡片', tools: [], guidance: '' },
          { prompt: '旧口径的有工具卡片', tools: [{ kind: 'builtin', name: 'read_file' }], guidance: 'x' },
        ],
      }),
      'utf8',
    );

    expect(store().read('admin', AGENT, 'th_1')).toBeUndefined();
  });

  it('无快照 / 损坏 JSON / 超 64KB / actions 为空 → undefined，且仅损坏与超限告警', () => {
    const s = store();

    expect(s.read('admin', AGENT, 'th_1')).toBeUndefined(); // 无快照：最常见路径，不告警
    expect(warns).toHaveLength(0);

    const target = file('admin', AGENT, 'th_1');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '{ 半个 JSON', 'utf8');
    expect(s.read('admin', AGENT, 'th_1')).toBeUndefined();
    expect(warns.some((w) => w.includes('损坏'))).toBe(true);

    fs.writeFileSync(target, JSON.stringify({ message_id: 'm', agent_name: 'demo', actions: [] }));
    expect(s.read('admin', AGENT, 'th_1')).toBeUndefined(); // actions 为空 → 等同无提示

    fs.writeFileSync(target, `{"pad":"${'x'.repeat(70 * 1024)}"}`, 'utf8');
    expect(s.read('admin', AGENT, 'th_1')).toBeUndefined();
    expect(warns.some((w) => w.includes('大小上限'))).toBe(true);
  });

  it('clear 同步清空上一轮快照（轮开始即无卡片，语义与旧链版一致）', () => {
    const s = store();
    s.finalize(finInput());
    expect(fs.existsSync(file('admin', AGENT, 'th_1'))).toBe(true);

    s.clear('admin', AGENT, 'th_1');
    expect(fs.existsSync(file('admin', AGENT, 'th_1'))).toBe(false);
  });

  it('新一轮覆盖旧快照（会话级只保留最新一轮；历史轮次不保留）', () => {
    const s = store();
    s.finalize(finInput());
    s.finalize(
      finInput({
        messageId: 'm-2',
        tailText: JSON.stringify({ actions: [bound('第二轮的建议')] }),
      }),
    );

    const snapshot = JSON.parse(fs.readFileSync(file('admin', AGENT, 'th_1'), 'utf8')) as {
      message_id: string;
      actions: Array<{ prompt: string }>;
    };
    expect(snapshot.message_id).toBe('m-2');
    expect(snapshot.actions.map((a) => a.prompt)).toEqual(['第二轮的建议']);
  });

  it('原子替换：正常路径不残留 .tmp 文件', () => {
    store().finalize(finInput());

    const dir = path.dirname(file('admin', AGENT, 'th_1'));
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('buildTailInstruction —— 尾部块指令装配（System Prompt 末尾追加）', () => {
  it('含协议样例、条数上限与能力目录（模型只能从这里抄）', () => {
    const text = buildTailInstruction(TOOL_TIPS, 2);

    expect(text).toContain('<next_actions>');
    expect(text).toContain('0~2');
    expect(text).toContain('QueryPurchaseRecords');
    expect(text).toContain('查询采购订单信息');
    expect(text).toContain("ontology_id=1");
    expect(text).toContain('50 字');
  });

  it('016：祈使句 / 单一任务 / 信息明确 / 宁缺毋滥 / tool_tips ≤5', () => {
    const text = buildTailInstruction(TOOL_TIPS, MAX_ACTIONS);

    expect(text).toContain('祈使句');
    expect(text).toContain('一次只描述一个任务');
    expect(text).toContain('已明确、已知的事实');
    expect(text).toContain('1~5 个元素');
    expect(text).toContain('宁缺毋滥');
    expect(text).toContain('输出 {"actions":[]}');
  });

  it('无 capability → 目录提示直接输出空 actions', () => {
    const text = buildTailInstruction([], MAX_ACTIONS);

    expect(text).toContain('本轮没有可提示的本体能力');
    expect(text).toContain('{"actions":[]}');
  });
});

describe('renderToolTipsInstruction —— 卡片点击轮的隐藏提示段', () => {
  it('空数组 → 空串（不追加任何内容）', () => {
    expect(renderToolTipsInstruction([])).toBe('');
  });

  it('非空 → 逐条渲染 name/title/ontology，并注明"不要改用其它能力"', () => {
    const text = renderToolTipsInstruction(TOOL_TIPS);

    expect(text).toContain('name=QueryPurchaseRecords');
    expect(text).toContain('title=查询采购订单信息');
    expect(text).toContain("ontology_name=采购管理");
    expect(text).toContain('不要改用其它能力');
  });
});

describe('effectiveNextActionsMax —— 本轮是否追加尾部指令的唯一判据', () => {
  it('开关关闭（max 为 undefined）→ 不追加', () => {
    expect(effectiveNextActionsMax(undefined, TOOL_TIPS)).toBeUndefined();
  });

  it('016：开关开启但本轮无 Laya 能力 → 不追加（无能力就不产卡片）', () => {
    expect(effectiveNextActionsMax(MAX_ACTIONS, [])).toBeUndefined();
  });

  it('开关开启且本轮有能力 → 返回本轮上限（照常追加）', () => {
    expect(effectiveNextActionsMax(MAX_ACTIONS, TOOL_TIPS)).toBe(MAX_ACTIONS);
    expect(effectiveNextActionsMax(2, TOOL_TIPS)).toBe(2);
  });
});
