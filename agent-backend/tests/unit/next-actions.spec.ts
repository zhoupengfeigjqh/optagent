/**
 * 单元测试：下一步动作提示（007 修订 · Tail Protocol）。
 *
 * 分五组守住五条硬约束（口径见 `src/domain/next-actions.ts` 文件头）：
 * - **解析与合规**：模型输出脏（代码块围栏 / 裸数组 / 超长 / 夹工具名）时逐条丢弃，绝不透出工具标识符；
 * - **工具引用与引导**：引用只认本轮装配出来的清单，越界只丢引用、保留卡片文本；
 * - **尾部块捕获**：`<next_actions>` 块对用户完全不可见，正文逐字无损（跨增量 / 误前缀 / 块后正文）；
 * - **轮末定稿**：同步解析 + 原子写快照，永不抛错；明确 0 条不告警、非法输出告警附节选；
 * - **存储**：会话级单快照（只留最新一轮）、`clear` 同步清空、读取不再判数字人（修订 G4）。
 *
 * 全链路（含 done 直推）见 `tests/integration/next-actions-rounds.spec.ts`。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_ACTIONS,
  NextActionsStore,
  PROMPT_MAX_CHARS,
  buildTailInstruction,
  isCompliantPrompt,
  parseActions,
  sanitizeActions,
  type NextActionsFinalizeInput,
} from '../../src/domain/next-actions.js';
import { TailCapture } from '../../src/domain/next-actions-tail.js';
import { buildStarterGuidance } from '../../src/domain/soul.js';
import { threadDir } from '../../src/domain/dirs.js';
import type { RuntimeToolBrief } from '../../src/types.js';

const TOOLS: RuntimeToolBrief[] = [
  { name: 'read_file', description: '读取文件' },
  { name: 'erp__query_order', description: '查询订单' },
];

function action(prompt: string, tools?: unknown[]): Record<string, unknown> {
  return { prompt, ...(tools === undefined ? {} : { tools }) };
}

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
  const toolNames = new Set(['read_file', 'erp__query_order']);

  it('全中文且不超过 50 字 → 通过；51 字 / 空串 → 丢弃', () => {
    expect(isCompliantPrompt('甲'.repeat(PROMPT_MAX_CHARS), toolNames)).toBe(true);
    expect(isCompliantPrompt('甲'.repeat(PROMPT_MAX_CHARS + 1), toolNames)).toBe(false);
    expect(isCompliantPrompt('', toolNames)).toBe(false);
  });

  it('命中可用工具名（含 MCP 暴露名，大小写不敏感）→ 丢弃', () => {
    expect(isCompliantPrompt('先用 read_file 看一下文件', toolNames)).toBe(false);
    expect(isCompliantPrompt('调用 ERP__QUERY_ORDER 查订单', toolNames)).toBe(false);
  });

  it('含 snake_case / kebab-case / CamelCase 形态 token → 丢弃（即便不在工具清单里）', () => {
    expect(isCompliantPrompt('先做 query_order 再汇报', toolNames)).toBe(false);
    expect(isCompliantPrompt('看看 data-prep 里的表', toolNames)).toBe(false);
    expect(isCompliantPrompt('用 QueryOrder 查订单', toolNames)).toBe(false);
  });

  it('普通拉丁词不误杀（"Excel 文件"是合法中文表述）', () => {
    expect(isCompliantPrompt('整理 Excel 文件的表头', toolNames)).toBe(true);
    expect(isCompliantPrompt('把结果导出为 CSV 清单', toolNames)).toBe(true);
  });
});

describe('sanitizeActions —— 逐条校验、裁剪与引导铸造', () => {
  it('合法引用保留并生成与问题实例同款的隐藏引导', () => {
    const out = sanitizeActions(
      [action('按交付日期梳理这批订单的风险', [{ kind: 'mcp', service: 'erp', name: 'query_order' }])],
      TOOLS,
    );

    expect(out).toHaveLength(1);
    expect(out[0]!.tools).toEqual([{ kind: 'mcp', service: 'erp', name: 'query_order' }]);
    expect(out[0]!.guidance).toBe(
      buildStarterGuidance([{ kind: 'mcp', service: 'erp', name: 'query_order' }]),
    );
  });

  it('模型把 MCP 工具写成 builtin + 暴露名 → 落盘为规范引用（kind=mcp + 服务名）', () => {
    // 线上实测：清单只给暴露名，模型照抄时 `kind` 靠猜
    const out = sanitizeActions(
      [action('按交付日期梳理订单风险', [{ kind: 'builtin', name: 'erp__query_order' }])],
      TOOLS,
    );

    expect(out[0]!.tools).toEqual([{ kind: 'mcp', service: 'erp', name: 'query_order' }]);
    // `tools` 与 `guidance` 同源：两者都由暴露名拼出，任何消费方重建引导都得到同一串
    expect(out[0]!.guidance).toBe(
      buildStarterGuidance([{ kind: 'mcp', service: 'erp', name: 'query_order' }]),
    );
  });

  it('越界引用只丢该引用，**卡片文本保留**（边界情况·工具引用越界）', () => {
    const out = sanitizeActions(
      [action('整理一下共享空间的表格', [{ kind: 'builtin', name: 'not_enabled' }])],
      TOOLS,
    );

    expect(out.map((a) => a.prompt)).toEqual(['整理一下共享空间的表格']);
    expect(out[0]!.tools).toEqual([]);
    expect(out[0]!.guidance).toBe('');
  });

  it('可用工具清单为空 → 所有引用被丢弃（无处可指）', () => {
    const out = sanitizeActions(
      [action('整理一下表格', [{ kind: 'mcp', service: 'erp', name: 'query_order' }])],
      [],
    );

    expect(out[0]!.tools).toEqual([]);
  });

  it('引导超长（>500 字）→ 丢掉引导而保留卡片', () => {
    const longName = 'x'.repeat(600);
    const out = sanitizeActions(
      [action('整理一下表格', [{ kind: 'builtin', name: longName }])],
      [{ name: longName, description: '' }],
    );

    expect(out[0]!.guidance).toBe('');
    expect(out[0]!.tools).toHaveLength(1);
  });

  it('不合规条目只丢自己；重复提示词去重；条数超上限取前 N 条', () => {
    const raw = [
      action('甲'.repeat(PROMPT_MAX_CHARS + 1)), // 超长 → 丢
      action(''), // 空 → 丢
      action('先做 query_order'), // 夹标识符 → 丢
      { prompt: 123 }, // 类型错 → 丢
      'not-an-object',
      action('整理共享空间的表格'),
      action('整理共享空间的表格'), // 重复 → 丢
      action('按交付日期梳理订单风险'),
      action('按月汇总这批订单的数量'),
      action('第四条应当被条数上限截掉'),
    ];

    const out = sanitizeActions(raw, TOOLS);

    expect(out.map((a) => a.prompt)).toEqual([
      '整理共享空间的表格',
      '按交付日期梳理订单风险',
      '按月汇总这批订单的数量',
    ]);
    expect(out).toHaveLength(MAX_ACTIONS);
  });

  it('kind 非法 / MCP 缺服务名 / 重名引用 → 该引用丢弃', () => {
    const out = sanitizeActions(
      [
        action('整理一下共享空间的表格', [
          { kind: 'unknown', name: 'read_file' },
          { kind: 'mcp', name: 'query_order' },
          { kind: 'builtin', name: 'read_file' },
          { kind: 'builtin', name: 'read_file' },
          { name: 'read_file' },
        ]),
      ],
      TOOLS,
    );

    expect(out[0]!.tools).toEqual([{ kind: 'builtin', name: 'read_file' }]);
  });
});

/* ---------- 尾部块捕获与轮末定稿（007 修订 · Tail Protocol） ---------- */

let root: string;
let warns: string[];

const logger = () => ({ warn: (msg: string) => warns.push(msg) });

function file(userId: string, threadId: string): string {
  return path.join(threadDir(root, userId, threadId), 'next-actions.json');
}

function finInput(overrides: Partial<NextActionsFinalizeInput> = {}): NextActionsFinalizeInput {
  return {
    userId: 'admin',
    threadId: 'th_1',
    messageId: 'm-1',
    agentName: 'demo',
    tailText: JSON.stringify({
      actions: [
        action('按交付日期梳理订单风险', [{ kind: 'builtin', name: 'read_file' }]),
        action('按月汇总这批订单的数量'),
      ],
    }),
    availableTools: TOOLS,
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
  it('合法尾部 → 写快照 + 返回下发形态（卡片与回答同轮产出）', () => {
    const view = store().finalize(finInput());

    expect(view?.message_id).toBe('m-1');
    expect(view?.actions.map((a) => a.prompt)).toEqual([
      '按交付日期梳理订单风险',
      '按月汇总这批订单的数量',
    ]);
    const snapshot = JSON.parse(fs.readFileSync(file('admin', 'th_1'), 'utf8')) as {
      message_id: string;
      agent_name: string;
      created_at: string;
      actions: Array<{ prompt: string; guidance: string }>;
    };
    expect(snapshot.message_id).toBe('m-1');
    expect(snapshot.agent_name).toBe('demo');
    expect(snapshot.created_at).toBeTruthy();
    expect(snapshot.actions[0]!.guidance).toContain('read_file');
  });

  it('空尾部（开关关闭 / 模型省略）→ 不写快照、不告警', () => {
    expect(store().finalize(finInput({ tailText: '' }))).toBeUndefined();
    expect(fs.existsSync(file('admin', 'th_1'))).toBe(false);
    expect(warns).toEqual([]);
  });

  it('产出 0 条（模型**明确**判定"无需下一步"）→ 不写快照，且**不告警**（FR-005）', () => {
    expect(store().finalize(finInput({ tailText: '{"actions":[]}' }))).toBeUndefined();

    expect(fs.existsSync(file('admin', 'th_1'))).toBe(false);
    // 闲聊轮次不该刷日志：这是"模型选择 0 条"，不是降级
    expect(warns.filter((w) => w.includes('下一步动作提示'))).toEqual([]);
  });

  it('输出非法 → 不写快照，且告警附原文节选（FR-041）', () => {
    expect(store().finalize(finInput({ tailText: '我觉得可以先看看订单' }))).toBeUndefined();

    expect(fs.existsSync(file('admin', 'th_1'))).toBe(false);
    const warned = warns.find((w) => w.includes('尾部块非法或为空'));
    expect(warned).toBeDefined();
    expect(warned).toContain('msg=m-1');
    expect(warned).toContain('我觉得可以先看看订单');
  });

  it('有候选条目但全部不合规 → 不写快照，且告警给出候选条数（FR-041）', () => {
    const tail = JSON.stringify({
      actions: [action('先做 query_order'), action('再看 read_file 的结果')],
    });

    expect(store().finalize(finInput({ tailText: tail }))).toBeUndefined();

    expect(fs.existsSync(file('admin', 'th_1'))).toBe(false);
    const warned = warns.find((w) => w.includes('全部不合规'));
    expect(warned).toBeDefined();
    expect(warned).toContain('候选 2 条');
  });

  it('条数上限压到 2（SOUL 配置与提示词同源）→ 只落 2 条', () => {
    const tail = JSON.stringify({
      actions: [action('第一条'), action('第二条'), action('第三条'), action('第四条')],
    });

    store().finalize(finInput({ tailText: tail, max: 2 }));

    const snapshot = JSON.parse(fs.readFileSync(file('admin', 'th_1'), 'utf8')) as {
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
  it('read 下发形态：message_id + 动作（tools 带 exposed_name、guidance 始终出现）', () => {
    const tail = JSON.stringify({
      actions: [action('按交付日期梳理订单风险', [{ kind: 'mcp', service: 'erp', name: 'query_order' }])],
    });
    store().finalize(finInput({ tailText: tail }));

    const view = store().read('admin', 'th_1');

    expect(view?.message_id).toBe('m-1');
    expect(view?.actions[0]).toMatchObject({
      prompt: '按交付日期梳理订单风险',
      tools: [{ kind: 'mcp', name: 'query_order', service: 'erp', exposed_name: 'erp__query_order' }],
      guidance: '本轮请优先使用以下工具完成任务：erp__query_order',
    });
  });

  it('修订 G4：读取不再判"当前选中数字人"——快照在即下发（卡片与数字人切换无关）', () => {
    // 独立生成链时代的两条读取判据（归属开关 / 归属数字人 = 当前选中）已删除：
    // 生成侧由提示词装配期的开关门控（关着开关就不会产出快照），读取侧再判只会
    // 造成"切换数字人后卡片消失"。因此这里只断言：快照在 → 无条件下发。
    store().finalize(finInput());
    expect(store().read('admin', 'th_1')?.message_id).toBe('m-1');
  });

  it('无快照 / 损坏 JSON / 超 64KB / actions 为空 → undefined，且仅损坏与超限告警', () => {
    const s = store();

    expect(s.read('admin', 'th_1')).toBeUndefined(); // 无快照：最常见路径，不告警
    expect(warns).toHaveLength(0);

    const target = file('admin', 'th_1');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '{ 半个 JSON', 'utf8');
    expect(s.read('admin', 'th_1')).toBeUndefined();
    expect(warns.some((w) => w.includes('损坏'))).toBe(true);

    fs.writeFileSync(target, JSON.stringify({ message_id: 'm', agent_name: 'demo', actions: [] }));
    expect(s.read('admin', 'th_1')).toBeUndefined(); // actions 为空 → 等同无提示

    fs.writeFileSync(target, `{"pad":"${'x'.repeat(70 * 1024)}"}`, 'utf8');
    expect(s.read('admin', 'th_1')).toBeUndefined();
    expect(warns.some((w) => w.includes('大小上限'))).toBe(true);
  });

  it('clear 同步清空上一轮快照（轮开始即无卡片，语义与旧链版一致）', () => {
    const s = store();
    s.finalize(finInput());
    expect(fs.existsSync(file('admin', 'th_1'))).toBe(true);

    s.clear('admin', 'th_1');
    expect(fs.existsSync(file('admin', 'th_1'))).toBe(false);
  });

  it('新一轮覆盖旧快照（会话级只保留最新一轮；历史轮次不保留）', () => {
    const s = store();
    s.finalize(finInput());
    s.finalize(finInput({ messageId: 'm-2', tailText: '{"actions":[{"prompt":"第二轮的建议"}]}' }));

    const snapshot = JSON.parse(fs.readFileSync(file('admin', 'th_1'), 'utf8')) as {
      message_id: string;
      actions: Array<{ prompt: string }>;
    };
    expect(snapshot.message_id).toBe('m-2');
    expect(snapshot.actions.map((a) => a.prompt)).toEqual(['第二轮的建议']);
  });

  it('原子替换：正常路径不残留 .tmp 文件', () => {
    store().finalize(finInput());

    const dir = path.dirname(file('admin', 'th_1'));
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('buildTailInstruction —— 尾部块指令装配（System Prompt 末尾追加）', () => {
  it('含协议样例、条数上限与工具目录（模型只能引用它看得到的清单）', () => {
    const text = buildTailInstruction(TOOLS, 2);

    expect(text).toContain('<next_actions>');
    expect(text).toContain('0~2');
    expect(text).toContain('read_file');
    expect(text).toContain('erp__query_order');
    expect(text).toContain('50 字');
  });

  it('无可用工具 → 目录提示 tools 一律留空', () => {
    const text = buildTailInstruction([], MAX_ACTIONS);

    expect(text).toContain('没有可用工具');
  });
});
