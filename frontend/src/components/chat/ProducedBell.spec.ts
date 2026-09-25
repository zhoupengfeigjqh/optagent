/**
 * 组件测试：后台产出铃铛（R11，契约 §10.5 ⑤⑥⑦）
 *
 * 守住五条：
 * 1. **未读角标**：0 时不显示；有未读时显示数字，且**读屏名称**带上条数（双通道）；
 * 2. **未读叹号**：未读条有叹号（带 `未读` 无障碍名称），已读条没有；
 * 3. **点开才标记已读**——打开面板本身 MUST NOT 标记（⑤）；
 * 4. **标题只认摘要**：`summary` 缺省时给**可读兜底**，MUST NOT 把落盘文件名
 *    （`{会话UUID}_{job_id}`，纯机读）顶上来当标题——2026-09-25 实测反馈的教训；
 * 5. **正文双视图**：点开走 `produced.text()`（而**不是** `files` 预览接口），
 *    读取失败给**局部降级文案**而不是把整面板变成错误态；
 * 6. **元信息**：工具名 / 数字人名称 / 状态 / 创建与完成时间；缺数字人或工具名时
 *    给可读兜底（`未知数字人` / `未知工具`），不留白。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { computed, ref, type ComputedRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProducedItem } from '../../api/produced'
import { PRODUCED_JSON_MAX_CHARS } from '../../utils/produced-content'
import BaseDialog from '../common/BaseDialog.vue'
import ProducedBell from './ProducedBell.vue'

/** 用 `vi.hoisted` 承载桩，避开 `vi.mock` 工厂的提升限制（`unknown` 便于测试内直接赋具体类型） */
const h = vi.hoisted(() => ({ store: null as unknown }))

vi.mock('../../composables/useProduced', () => ({ useProduced: () => h.store }))

function item(
  jobId: string,
  readAt?: string,
  summary?: string,
  agentName?: string,
): ProducedItem {
  return {
    job_id: jobId,
    tool: 'ocr__ocr_image',
    size: 1024,
    filename: `th_1_${jobId}.txt`,
    status: 'done',
    created_at: '2026-09-25T02:00:00.000Z',
    finished_at: '2026-09-25T02:00:00.000Z',
    relPath: `临时空间/后台产出/th_1_${jobId}.txt`,
    ...(readAt === undefined ? {} : { read_at: readAt }),
    ...(summary === undefined ? {} : { summary }),
    ...(agentName === undefined ? {} : { agent_name: agentName }),
  }
}

interface FakeStore {
  items: ReturnType<typeof ref<ProducedItem[]>>
  loading: ReturnType<typeof ref<boolean>>
  error: ReturnType<typeof ref<unknown>>
  unreadCount: ComputedRef<number>
  refresh: ReturnType<typeof vi.fn>
  markRead: ReturnType<typeof vi.fn>
  text: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

function makeStore(items: ProducedItem[]): FakeStore {
  const list = ref(items)
  return {
    items: list,
    loading: ref(false),
    error: ref(null),
    unreadCount: computed(() => list.value.filter((i) => i.read_at === undefined).length),
    refresh: vi.fn().mockResolvedValue(undefined),
    markRead: vi.fn().mockResolvedValue(undefined),
    text: vi.fn().mockResolvedValue('识别结果正文'),
    start: vi.fn(),
    stop: vi.fn(),
  }
}

let store: FakeStore

beforeEach(() => {
  store = makeStore([])
  h.store = store
})

function mountBell() {
  return mount(ProducedBell)
}

/** 打开面板（点铃铛） */
async function openPanel(wrapper: ReturnType<typeof mountBell>): Promise<void> {
  await wrapper.find('.produced-bell').trigger('click')
}

describe('ProducedBell —— 挂载与订阅', () => {
  it('挂载即拉一次列表（离线补齐）并订阅信号（在线即时）', () => {
    mountBell()

    expect(store.refresh).toHaveBeenCalledTimes(1)
    expect(store.start).toHaveBeenCalledTimes(1)
  })

  it('卸载时退订（不留悬挂连接）', () => {
    mountBell().unmount()

    expect(store.stop).toHaveBeenCalledTimes(1)
  })
})

describe('ProducedBell —— 未读角标', () => {
  it('无未读：不渲染角标；按钮名称不出现条数', () => {
    store = makeStore([item('a', '2026-09-25T03:00:00.000Z')])
    h.store = store

    const wrapper = mountBell()

    expect(wrapper.find('.produced-bell__badge').exists()).toBe(false)
    expect(wrapper.find('.produced-bell').attributes('aria-label')).toBe('后台记录')
  })

  it('有未读：角标显示条数，且按钮的**无障碍名称**里带上条数（不只靠视觉）', () => {
    store = makeStore([item('a'), item('b'), item('c', '2026-09-25T03:00:00.000Z')])
    h.store = store

    const wrapper = mountBell()

    const badge = wrapper.find('.produced-bell__badge')
    expect(badge.text()).toBe('2')
    expect(badge.attributes('aria-hidden')).toBe('true') // 角标对读屏隐藏，避免重复播报
    expect(wrapper.find('.produced-bell').attributes('aria-label')).toBe('后台记录，2 条未读')
  })
})

describe('ProducedBell —— 列表视图', () => {
  it('空态给可读引导（而不是一片空白）', async () => {
    const wrapper = mountBell()

    await openPanel(wrapper)

    expect(wrapper.text()).toContain('还没有后台任务结果')
  })

  it('错误态优先于空态展示（有错就报错，不装作"没有产出"）', async () => {
    store.error.value = { code: 'NETWORK_ERROR', message: 'boom' }
    const wrapper = mountBell()

    await openPanel(wrapper)

    // `ErrorNotice` 经 `toUserMessage` 把错误码映射成中文文案（不是原样回显 message）
    expect(wrapper.text()).toContain('网络异常')
    expect(wrapper.text()).not.toContain('还没有后台任务结果')
  })

  it('未读条带叹号（含 `未读` 无障碍名称），已读条没有叹号', async () => {
    store = makeStore([item('a'), item('b', '2026-09-25T03:00:00.000Z')])
    h.store = store

    const wrapper = mountBell()
    await openPanel(wrapper)

    const flags = wrapper.findAll('.produced-item__flag')
    expect(flags).toHaveLength(1)
    expect(flags[0]!.attributes('aria-label')).toBe('未读')
  })

  it('有摘要 → 标题就是摘要，并带上工具名与体积', async () => {
    store = makeStore([item('a', undefined, '识别到 47 行文字')])
    h.store = store

    const wrapper = mountBell()
    await openPanel(wrapper)

    expect(wrapper.find('.produced-item__summary').text()).toBe('识别到 47 行文字')
    expect(wrapper.find('.produced-item__meta').text()).toContain('ocr__ocr_image')
    expect(wrapper.find('.produced-item__meta').text()).toContain('1.0 KB')
  })

  it('摘要缺省 → 给**可读兜底**，且 MUST NOT 把机读文件名当标题（2026-09-25 反馈）', async () => {
    store = makeStore([item('a')])
    h.store = store

    const wrapper = mountBell()
    await openPanel(wrapper)

    const title = wrapper.find('.produced-item__summary').text()
    expect(title).toBe('后台任务结果（该任务未提供摘要）')
    expect(title).not.toContain('th_1_a.txt')
  })
})

describe('ProducedBell —— 元信息（工具 / 数字人 / 创建与完成时间 / 状态）', () => {
  it('列表项带工具名、数字人名称、状态与创建/完成时间', async () => {
    store = makeStore([item('a', undefined, '识别到 47 行文字', '生产调度助手')])
    h.store = store

    const wrapper = mountBell()
    await openPanel(wrapper)

    const meta = wrapper.find('.produced-item__meta').text()
    expect(meta).toContain('工具：ocr__ocr_image')
    expect(meta).toContain('数字人：生产调度助手')
    expect(meta).toContain('状态：done') // 原样透出，不做 done → 已完成 的翻译
    expect(meta).toContain('创建：')
    expect(meta).toContain('完成：')
  })

  it('缺数字人 / 工具名 → 给可读兜底而不是留白', async () => {
    const bare: ProducedItem = { ...item('a'), tool: '' }
    store = makeStore([bare])
    h.store = store

    const wrapper = mountBell()
    await openPanel(wrapper)

    const meta = wrapper.find('.produced-item__meta').text()
    expect(meta).toContain('数字人：未知数字人')
    expect(meta).toContain('工具：未知工具')
  })

  it('点开某条：内容视图同样显示元信息，并附加正文', async () => {
    store = makeStore([item('a', undefined, '识别到 47 行文字', '生产调度助手')])
    store.text.mockResolvedValue('产能表\n冲压 1200')
    h.store = store

    const wrapper = mountBell()
    await openPanel(wrapper)
    await wrapper.find('.produced-item__button').trigger('click')
    await flushPromises()

    const meta = wrapper.find('.produced-content__meta').text()
    expect(meta).toContain('数字人：生产调度助手')
    expect(meta).toContain('状态：done')
    expect(wrapper.find('.produced-content__body').text()).toContain('冲压 1200')
  })
})

describe('ProducedBell —— 正文结构化展示（JSON ⇄ 原始）', () => {
  /** 打开面板并点开第一条 */
  async function openFirst(wrapper: ReturnType<typeof mountBell>): Promise<void> {
    await openPanel(wrapper)
    await wrapper.find('.produced-item__button').trigger('click')
    await flushPromises()
  }

  it('正文是 JSON 对象 → 默认结构化，并可一键切回原始 JSON', async () => {
    store = makeStore([item('a')])
    store.text.mockResolvedValue('{"status":"success","message":"识别到 2 行文字"}')
    h.store = store

    const wrapper = mountBell()
    await openFirst(wrapper)

    expect(wrapper.find('.produced-json').exists()).toBe(true)
    expect(wrapper.text()).toContain('success')

    const toggle = wrapper.find('.produced-content__view-toggle')
    expect(toggle.text()).toContain('按原始 JSON 查看')

    await toggle.trigger('click')
    expect(wrapper.find('.produced-json').exists()).toBe(false)
    expect(wrapper.find('.produced-content__body').text()).toContain('"status"')

    await toggle.trigger('click')
    expect(wrapper.find('.produced-json').exists()).toBe(true)
  })

  it('正文不是 JSON（纯文本）→ 原样展示，且**不给切换**（没有另一种形态可切）', async () => {
    store = makeStore([item('a')])
    store.text.mockResolvedValue('产能表\n冲压 1200')
    h.store = store

    const wrapper = mountBell()
    await openFirst(wrapper)

    expect(wrapper.find('.produced-content__view-toggle').exists()).toBe(false)
    expect(wrapper.find('.produced-json').exists()).toBe(false)
    expect(wrapper.find('.produced-content__body').text()).toContain('冲压 1200')
  })

  it('正文过大 → 回落原文并说明原因', async () => {
    store = makeStore([item('a')])
    store.text.mockResolvedValue('x'.repeat(PRODUCED_JSON_MAX_CHARS + 1))
    h.store = store

    const wrapper = mountBell()
    await openFirst(wrapper)

    expect(wrapper.find('.produced-json').exists()).toBe(false)
    expect(wrapper.find('.produced-content__body').exists()).toBe(true)
    expect(wrapper.find('.produced-panel__hint').text()).toContain('原始文本')
  })

  it('切到原始后返回列表再进新条目 → 回到结构化（不残留上一次的形态）', async () => {
    store = makeStore([item('a')])
    store.text.mockResolvedValue('{"status":"success"}')
    h.store = store

    const wrapper = mountBell()
    await openFirst(wrapper)
    await wrapper.find('.produced-content__view-toggle').trigger('click')
    expect(wrapper.find('.produced-json').exists()).toBe(false)

    await wrapper.find('.produced-content__back').trigger('click')
    await openFirst(wrapper)

    expect(wrapper.find('.produced-json').exists()).toBe(true)
    expect(wrapper.find('.produced-content__view-toggle').text()).toContain('按原始 JSON 查看')
  })
})

describe('ProducedBell —— 已读时机与正文视图（§10.5 ⑤⑦）', () => {
  it('**打开面板不标记已读**（否则"未读"无从表达）', async () => {
    store = makeStore([item('a')])
    h.store = store

    const wrapper = mountBell()
    await openPanel(wrapper)
    await flushPromises()

    expect(store.markRead).not.toHaveBeenCalled()
    expect(store.unreadCount.value).toBe(1)
  })

  it('点开某条 → 标记该条已读 + 拉正文 + 切到内容视图', async () => {
    store = makeStore([item('a', undefined, '识别到 47 行文字')])
    store.text.mockResolvedValue('产能表\n冲压 1200')
    h.store = store

    const wrapper = mountBell()
    await openPanel(wrapper)
    await wrapper.find('.produced-item__button').trigger('click')
    await flushPromises()

    expect(store.markRead).toHaveBeenCalledWith(['a'])
    expect(store.text).toHaveBeenCalledWith('a')
    expect(wrapper.find('.produced-content__body').text()).toContain('冲压 1200')
  })

  it('「返回列表」回到列表态，并清掉上一条正文（不残留）', async () => {
    store = makeStore([item('a')])
    h.store = store

    const wrapper = mountBell()
    await openPanel(wrapper)
    await wrapper.find('.produced-item__button').trigger('click')
    await flushPromises()

    await wrapper.find('.produced-content__back').trigger('click')

    expect(wrapper.find('.produced-content__body').exists()).toBe(false)
    expect(wrapper.findAll('.produced-item')).toHaveLength(1)
  })

  it('正文字读取失败 → **局部降级文案**，而不是把整面板变成错误态', async () => {
    store = makeStore([item('a')])
    store.text.mockResolvedValue(null) // store 已吞掉错误并返回 null
    h.store = store

    const wrapper = mountBell()
    await openPanel(wrapper)
    await wrapper.find('.produced-item__button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('内容不可读')
    expect(wrapper.text()).toContain('已被清理')
    // 列表仍在（面板没被错误态接管）
    expect(wrapper.find('.produced-item').exists()).toBe(false) // 已切到内容视图
    expect(wrapper.findComponent(BaseDialog).props('open')).toBe(true)
  })

  it('关闭面板回到列表态（下次打开不残留正文）', async () => {
    store = makeStore([item('a')])
    h.store = store

    const wrapper = mountBell()
    await openPanel(wrapper)
    expect(wrapper.findComponent(BaseDialog).props('open')).toBe(true)

    await wrapper.find('.produced-item__button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.produced-content__body').exists()).toBe(true)

    await wrapper.findComponent(BaseDialog).vm.$emit('close')
    await flushPromises()

    expect(wrapper.findComponent(BaseDialog).props('open')).toBe(false)
    // 已回到列表态：重新打开就能看到列表（而不是停在上一条正文）
    await openPanel(wrapper)
    expect(wrapper.find('.produced-content__body').exists()).toBe(false)
  })
})
