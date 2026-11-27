import { flushPromises, mount } from '@vue/test-utils'
import { computed, ref, type ComputedRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProducedItem } from '../../api/produced'
import { PRODUCED_JSON_MAX_CHARS } from '../../utils/produced-content'
import type { ViewLinkTarget } from '../../utils/view-link'
import BaseDialog from '../common/BaseDialog.vue'
import ProducedBell from './ProducedBell.vue'

const h = vi.hoisted(() => ({ store: null as unknown, toast: null as unknown }))

vi.mock('../../composables/useProduced', () => ({ useProduced: () => h.store }))
vi.mock('../../composables/useToast', () => ({ useToast: () => h.toast }))

function item(jobId: string, readAt?: string, summary?: string, agentName?: string): ProducedItem {
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
  onNewItems: ReturnType<typeof vi.fn>
  emitNew: (added: readonly ProducedItem[]) => void
}

function makeStore(items: ProducedItem[]): FakeStore {
  const list = ref(items)
  const listeners = new Set<(added: readonly ProducedItem[]) => void>()
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
    onNewItems: vi.fn((listener: (added: readonly ProducedItem[]) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    emitNew: (added) => {
      for (const listener of [...listeners]) listener(added)
    },
  }
}

let store: FakeStore
let toast: { push: ReturnType<typeof vi.fn> }

beforeEach(() => {
  store = makeStore([])
  h.store = store
  toast = { push: vi.fn() }
  h.toast = toast
})

function mountBell() {
  return mount(ProducedBell)
}

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
    expect(wrapper.find('.produced-bell').attributes('title')).toBe('后台记录，点击查看')
  })

  it('有未读：角标显示条数，且按钮的**无障碍名称**里带上条数（不只靠视觉）', () => {
    store = makeStore([item('a'), item('b'), item('c', '2026-09-25T03:00:00.000Z')])
    h.store = store

    const wrapper = mountBell()

    const badge = wrapper.find('.produced-bell__badge')
    expect(badge.text()).toBe('2')
    expect(badge.attributes('aria-hidden')).toBe('true') // 角标对读屏隐藏，避免重复播报
    expect(wrapper.find('.produced-bell').attributes('aria-label')).toBe('后台记录，2 条未读')
    expect(wrapper.find('.produced-bell').attributes('title')).toBe('后台记录：2 条未读，点击查看')
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

  it('有摘要 → 标题主段是摘要、副段是「工具名 · job_id」；元信息不再重复工具名', async () => {
    store = makeStore([item('a', undefined, '识别到 47 行文字')])
    h.store = store

    const wrapper = mountBell()
    await openPanel(wrapper)

    expect(wrapper.find('.produced-title__summary').text()).toBe('识别到 47 行文字')
    expect(wrapper.find('.produced-title__tag').text()).toBe('ocr__ocr_image · a')
    expect(wrapper.find('.produced-item__meta').text()).not.toContain('ocr__ocr_image')
    expect(wrapper.find('.produced-item__meta').text()).toContain('1.0 KB')
  })

  it('摘要缺省 → 给**可读兜底**，且 MUST NOT 把机读文件名当标题（2026-09-25 反馈）', async () => {
    store = makeStore([item('a')])
    h.store = store

    const wrapper = mountBell()
    await openPanel(wrapper)

    const title = wrapper.find('.produced-title__summary').text()
    expect(title).toBe('后台任务结果（该任务未提供摘要）')
    expect(title).not.toContain('th_1_a.txt')
    // 兜底文案会撞车，靠副段的 job_id 区分——这正是它进标题的理由
    expect(wrapper.find('.produced-title__tag').text()).toContain('a')
  })

  it('副段悬停给**完整**值（省略号不该让人拿不到原文）', async () => {
    const longId = 'ocr_1790123456789_8bcccfd2'
    store = makeStore([item(longId)])
    h.store = store

    const wrapper = mountBell()
    await openPanel(wrapper)

    const tag = wrapper.find('.produced-title__tag')
    expect(tag.text()).toBe('ocr__ocr_image · ocr_17901234…cfd2')
    expect(tag.attributes('title')).toBe(`ocr__ocr_image · ${longId}`)
  })
})

describe('ProducedBell —— 元信息（工具 / 数字人 / 创建与完成时间 / 状态）', () => {
  it('列表项带工具名、数字人名称、状态与创建/完成时间', async () => {
    store = makeStore([item('a', undefined, '识别到 47 行文字', '生产调度助手')])
    h.store = store

    const wrapper = mountBell()
    await openPanel(wrapper)

    const meta = wrapper.find('.produced-item__meta').text()
    expect(meta).toContain('数字人：生产调度助手')
    expect(meta).toContain('状态：done')
    expect(meta).toContain('创建：')
    expect(meta).toContain('完成：')
    expect(wrapper.find('.produced-title__tag').text()).toContain('ocr__ocr_image')
  })

  it('缺数字人 / 工具名 → 给可读兜底而不是留白', async () => {
    const bare: ProducedItem = { ...item('a'), tool: '' }
    store = makeStore([bare])
    h.store = store

    const wrapper = mountBell()
    await openPanel(wrapper)

    const meta = wrapper.find('.produced-item__meta').text()
    expect(meta).toContain('数字人：未知数字人')
    expect(wrapper.find('.produced-title__tag').text()).toBe('未知工具 · a')
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
    expect(wrapper.findAll('.produced-title')).toHaveLength(1)
    expect(wrapper.find('.produced-content__head .produced-title__summary').text()).toBe(
      '识别到 47 行文字',
    )
    expect(wrapper.find('.produced-content__head .produced-title__tag').text()).toBe(
      'ocr__ocr_image · a',
    )
  })
})

describe('ProducedBell —— 正文结构化展示（JSON ⇄ 原始）', () => {
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

  it('结构化正文用**宽版**弹窗；列表与原始 JSON 视图用默认宽度', async () => {
    store = makeStore([item('a')])
    store.text.mockResolvedValue('{"status":"success","rows":[{"orderNo":"WO-1"}]}')
    h.store = store

    const wrapper = mountBell()
    await openPanel(wrapper)
    expect(wrapper.find('.base-dialog').classes()).not.toContain('base-dialog--wide')

    await wrapper.find('.produced-item__button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.base-dialog').classes()).toContain('base-dialog--wide')

    await wrapper.find('.produced-content__view-toggle').trigger('click')
    expect(wrapper.find('.base-dialog').classes()).not.toContain('base-dialog--wide')

    await wrapper.find('.produced-content__view-toggle').trigger('click')
    expect(wrapper.find('.base-dialog').classes()).toContain('base-dialog--wide')

    await wrapper.find('.produced-content__back').trigger('click')
    expect(wrapper.find('.base-dialog').classes()).not.toContain('base-dialog--wide')
  })

  it('正文不可结构化（纯文本）→ 内容视图也用默认宽度', async () => {
    store = makeStore([item('a')])
    store.text.mockResolvedValue('产能表\n冲压 1200')
    h.store = store

    const wrapper = mountBell()
    await openPanel(wrapper)
    await wrapper.find('.produced-item__button').trigger('click')
    await flushPromises()

    expect(wrapper.find('.produced-json').exists()).toBe(false)
    expect(wrapper.find('.base-dialog').classes()).not.toContain('base-dialog--wide')
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


describe('ProducedBell —— 后台任务完成提示', () => {
  it('新到达的产出：用 success 弹一条，文案带摘要', () => {
    const wrapper = mountBell()

    store.emitNew([item('j_1', undefined, '识别到 47 行文字')])

    expect(toast.push).toHaveBeenCalledTimes(1)
    const [level, text] = toast.push.mock.calls[0] as [string, string]
    expect(level).toBe('success')
    expect(text).toBe('后台任务完成：识别到 47 行文字')
    wrapper.unmount()
  })

  it('摘要缺省 → 用可读兜底（不把机读文件名顶上来）', () => {
    const wrapper = mountBell()

    store.emitNew([item('j_1')])

    expect(toast.push.mock.calls[0]![1]).toBe('后台任务完成：后台任务结果（该任务未提供摘要）')
    wrapper.unmount()
  })

  it('一次完成多条 → 合并成一条提示（不把 toast 位占满）', () => {
    const wrapper = mountBell()

    store.emitNew([item('j_1'), item('j_2'), item('j_3')])

    expect(toast.push).toHaveBeenCalledTimes(1)
    expect(toast.push.mock.calls[0]![1]).toBe('后台任务完成：3 个新结果')
    wrapper.unmount()
  })

  it('提示上的「查看」直接打开铃铛面板', async () => {
    const wrapper = mountBell()
    store.emitNew([item('j_1')])

    const action = toast.push.mock.calls[0]![2] as { label: string; run: () => void }
    expect(action.label).toBe('查看')
    action.run()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.produced-bell').attributes('aria-pressed')).toBe('true')
    wrapper.unmount()
  })

  it('卸载后退订：之后到达的产出不再弹', () => {
    const wrapper = mountBell()
    wrapper.unmount()

    store.emitNew([item('j_1')])

    expect(toast.push).not.toHaveBeenCalled()
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
    store.text.mockResolvedValue(null)
    h.store = store

    const wrapper = mountBell()
    await openPanel(wrapper)
    await wrapper.find('.produced-item__button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('内容不可读')
    expect(wrapper.text()).toContain('已被清理')
    expect(wrapper.find('.produced-item').exists()).toBe(false)
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
    await openPanel(wrapper)
    expect(wrapper.find('.produced-content__body').exists()).toBe(false)
  })
})

describe('ProducedBell —— 正文里的 viewUrl 点击（2026-10-20）', () => {
  const ORIGIN = window.location.origin

  it('点 viewUrl → 先关弹窗再上报 open-view（同源进面板由装配层决定）', async () => {
    store = makeStore([item('a')])
    store.text.mockResolvedValue('{"status":"success","viewUrl":"/datasource/x"}')
    h.store = store

    const wrapper = mountBell()
    await openPanel(wrapper)
    await wrapper.find('.produced-item__button').trigger('click')
    await flushPromises()

    await wrapper.find('.produced-json__link').trigger('click')

    expect(wrapper.emitted('open-view')).toEqual([
      [{ url: `${ORIGIN}/datasource/x`, name: '/datasource/x', kind: 'url' }],
    ])
    expect(wrapper.findComponent(BaseDialog).props('open')).toBe(false)
    expect(wrapper.find('.produced-json').exists()).toBe(false)
  })
})

describe('ProducedBell —— 文件产出（2026-10-21：BOM 回写的 xlsx）', () => {
  const FILE = 'th_1_总BOM_X_bom_1_ab.xlsx'

  function fileItem(): ProducedItem {
    return {
      ...item('bom_1'),
      tool: 'bom__bom_merge',
      filename: FILE,
      relPath: `临时空间/后台产出/${FILE}`,
    }
  }

  async function openFirstFile(wrapper: ReturnType<typeof mountBell>): Promise<void> {
    await openPanel(wrapper)
    await wrapper.find('.produced-item__button').trigger('click')
    await flushPromises()
  }

  it('点开**不读正文**（raw 是 text/plain，读二进制是乱码），给"打开 / 下载文件"', async () => {
    store = makeStore([fileItem()])
    h.store = store

    const wrapper = mountBell()
    await openFirstFile(wrapper)

    expect(store.text).not.toHaveBeenCalled()
    expect(store.markRead).toHaveBeenCalledWith(['bom_1'])
    expect(wrapper.text()).toContain('不在面板里按文本展示')
    expect(wrapper.find('.produced-content__view-toggle').text()).toContain('打开 / 下载文件')
  })

  it('点"打开 / 下载文件" → 先关弹窗，再以 `kind:file` + `filePath` 上报（与聊天区入口同一条路）', async () => {
    store = makeStore([fileItem()])
    h.store = store

    const wrapper = mountBell()
    await openFirstFile(wrapper)
    await wrapper.find('.produced-content__view-toggle').trigger('click')

    const [payload] = wrapper.emitted('open-view')![0] as [ViewLinkTarget]
    expect(payload.kind).toBe('file')
    expect(payload.filePath).toBe(`临时空间/后台产出/${FILE}`)
    expect(payload.name).toBe(FILE)
    expect(payload.url).toContain('/api/files/preview?')
    expect(wrapper.findComponent(BaseDialog).props('open')).toBe(false)
  })
})
