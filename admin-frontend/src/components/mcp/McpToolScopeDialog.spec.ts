/**
 * 组件测试：工具范围弹窗（2026-10-15）
 *
 * 守住六条口径：
 * 1. **以本次探测结果为基准**预勾选当前白名单；白名单里已不存在的工具勾不了、但要**如实提示**
 *    （保存后会移出范围，MUST NOT 静默消失）；
 * 2. **至少勾一个**：空范围在平台语义里 = 不限制（数字人反而看到全部工具），本地先拦且不发请求；
 * 3. **载荷是"重放"**：`PUT` 是全量替换，故只改白名单也必须带上其余字段——但 **MUST NOT 带 `headers`**
 *    （详情回的是掩码，带回去等于把真令牌换成掩码）；
 * 4. **失败不关窗、勾选不丢**（并发冲突时管理员重试即可）；
 * 5. 取消 / Esc 一律**不改动任何东西**（不发请求）；
 * 6. **关窗必须真的退出模态态**：先 `close()` 再兜底清 `open`（顺序反了 = 整页假死，2026-10-16）。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServiceDetail, McpToolInfo } from '../../api/types'
import McpToolScopeDialog from './McpToolScopeDialog.vue'

const saveMcpServiceConfig = vi.fn()

vi.mock('../../api/mcp', () => ({
  listMcpServices: vi.fn(),
  getMcpService: vi.fn(),
  createMcpService: vi.fn(),
  saveMcpServiceConfig: (...a: unknown[]) => saveMcpServiceConfig(...a),
  deleteMcpService: vi.fn(),
  testMcpService: vi.fn(),
  probeMcpTarget: vi.fn(),
  fetchMcpStats: vi.fn(),
}))

const OCR: McpToolInfo = { name: 'ocr_image', description: '识别图片', parameters: {} }
const PDF: McpToolInfo = { name: 'ocr_pdf', description: '识别 PDF', parameters: {} }
const PRICE: McpToolInfo = { name: 'query_price', description: '查价', parameters: {} }

const SERVICE: McpServiceDetail = {
  name: 'ocr',
  transport: 'http',
  description: 'OCR 识别服务',
  url: 'http://192.168.1.2:8000/mcp',
  command: null,
  args: null,
  file_args: { ocr_image: { image: 'url' } },
  confirmation: 'always',
  rules_fields: { ocr_image: 'rules' },
  async_tools: ['ocr_image'],
  allowed_tools: ['ocr_image', 'gone_tool'],
  missing_tools: ['gone_tool'],
  // 详情回显的只有掩码：本弹窗 MUST NOT 把它带回去
  headers: { 'X-MCP-Token': '6UuE…F3Z' },
  tools: [OCR],
  tools_truncated: false,
  available_tools: [OCR, PDF, PRICE],
  available_tools_truncated: false,
  tools_error: null,
  references: [],
  revision: 7,
}

function mountDialog(service: McpServiceDetail = SERVICE) {
  return mount(McpToolScopeDialog, { props: { open: false, service } })
}

/** 打开弹窗（走 `open` 变化的那条路径，与真实用法一致） */
async function openDialog(service: McpServiceDetail = SERVICE) {
  const wrapper = mountDialog(service)
  await wrapper.setProps({ open: true })
  await flushPromises()
  return wrapper
}

/** 勾选状态：`{[工具名]: 是否勾选}` */
function checkedMap(wrapper: ReturnType<typeof mountDialog>): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  for (const box of wrapper.findAll<HTMLInputElement>('[data-test="tool"]')) {
    map[String(box.element.value)] = box.element.checked
  }
  return map
}

async function toggle(wrapper: ReturnType<typeof mountDialog>, name: string): Promise<void> {
  const box = wrapper
    .findAll<HTMLInputElement>('[data-test="tool"]')
    .find((item) => item.element.value === name)
  await box?.setValue(!box.element.checked)
}

function dialogEl(wrapper: ReturnType<typeof mountDialog>): HTMLDialogElement {
  return wrapper.find('dialog').element as HTMLDialogElement
}

/**
 * 给 jsdom 的 `<dialog>` 补一个**按 HTML 规范语义**的 `close()`。
 *
 * 为什么必须补：jsdom 至今没有 `HTMLDialogElement.showModal()` / `close()`，组件只能走
 * 降级路径（`setAttribute('open')` + 兜底 `removeAttribute`）——**关闭顺序写反了也测不出来**，
 * 这正是 2026-10-16「点取消/保存后整页点不动、只能刷新」能溜到实机的原因。
 *
 * 这里实现规范里最要命的那一步：**没有 `open` 属性就直接返回**。于是"先摘 `open` 再 `close()`"
 * 会让 `close()` 变成空操作（`calls` 不增加）→ 测试当场报红，而这个空操作在真浏览器里
 * 就是"弹窗仍留在 top layer 的模态态 → 页面其余部分继续 inert"。
 */
function stubClose(el: HTMLDialogElement): { calls: number } {
  const state = { calls: 0 }
  Object.defineProperty(el, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      if (!this.hasAttribute('open')) return
      state.calls += 1
      this.removeAttribute('open')
    },
  })
  return state
}

beforeEach(() => {
  saveMcpServiceConfig.mockReset().mockResolvedValue({
    name: 'ocr',
    description: 'OCR 识别服务',
    transport: 'http',
    url: 'http://192.168.1.2:8000/mcp',
    command: null,
    args: null,
    file_args: {},
    confirmation: 'always',
    rules_fields: {},
    async_tools: [],
    allowed_tools: ['ocr_image', 'ocr_pdf'],
    headers: { 'X-MCP-Token': '6UuE…F3Z' },
    updated_at: '2026-10-15T00:00:00.000Z',
    revision: 8,
    affected_agents: ['u1/agent-a'],
  })
})

describe('McpToolScopeDialog —— 打开时的基准与预勾选', () => {
  it('以本次探测结果为准渲染全部候选，并按当前白名单预勾选', async () => {
    const wrapper = await openDialog()

    expect(wrapper.findAll('[data-test="tool"]')).toHaveLength(3)
    expect(checkedMap(wrapper)).toEqual({
      ocr_image: true,
      ocr_pdf: false,
      query_price: false,
    })
  })

  it('白名单里已不存在的工具：勾不了，但 MUST 如实提示保存后会被移出', async () => {
    const wrapper = await openDialog()

    // 它不在候选清单里，所以没有对应的复选框
    expect(checkedMap(wrapper)).not.toHaveProperty('gone_tool')
    const alert = wrapper.find('[data-test="missing"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('gone_tool')
    expect(alert.text()).toContain('将从范围中移除')
  })

  it('探测到 0 个工具：不给勾选、保存按钮禁用（基准为空，勾选等于凭空造范围）', async () => {
    const wrapper = await openDialog({
      ...SERVICE,
      allowed_tools: [],
      available_tools: [],
    })

    expect(wrapper.find('[data-test="empty-catalog"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="tool"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="save"]').attributes('disabled')).toBeDefined()
  })
})

describe('McpToolScopeDialog —— 保存', () => {
  it('勾选增减后保存：载荷**重放**其余字段、不带 `headers`，成功后回传结果并关窗', async () => {
    const wrapper = await openDialog()
    await toggle(wrapper, 'ocr_pdf')

    await wrapper.find('[data-test="save"]').trigger('click')
    await flushPromises()

    expect(saveMcpServiceConfig).toHaveBeenCalledTimes(1)
    const [name, payload] = saveMcpServiceConfig.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('ocr')
    expect(payload.allowed_tools).toEqual(['ocr_image', 'ocr_pdf'])
    expect(payload.revision).toBe(7)
    // 全量替换语义：其余字段原样带上，否则会被服务端补成默认值
    expect(payload.file_args).toEqual({ ocr_image: { image: 'url' } })
    expect(payload.rules_fields).toEqual({ ocr_image: 'rules' })
    expect(payload.async_tools).toEqual(['ocr_image'])
    expect(payload.confirmation).toBe('always')
    expect(payload.description).toBe('OCR 识别服务')
    expect(payload.transport).toBe('http')
    // 掩码 MUST NOT 回传（那会把真令牌换成掩码）
    expect(payload.headers).toBeUndefined()

    expect(wrapper.emitted('saved')?.at(-1)).toEqual([
      { allowed_tools: ['ocr_image', 'ocr_pdf'], revision: 8, affected: ['u1/agent-a'] },
    ])
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('全部取消勾选 → 本地拦下、**不发请求**（空范围语义是"不限制"，与"一个都不给"相反）', async () => {
    const wrapper = await openDialog()
    await toggle(wrapper, 'ocr_image')

    await wrapper.find('[data-test="save"]').trigger('click')
    await flushPromises()

    expect(saveMcpServiceConfig).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="local-error"]').text()).toContain('不限制')
    expect(wrapper.emitted('update:open')).toBeUndefined()
  })

  it('保存失败（如并发冲突）→ 不关窗、勾选不丢，错误可读', async () => {
    saveMcpServiceConfig.mockRejectedValue({
      code: 'ADM_CONFIG_REVISION_CONFLICT',
      message: '内容已被他处修改',
    })
    const wrapper = await openDialog()
    await toggle(wrapper, 'ocr_pdf')

    await wrapper.find('[data-test="save"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(wrapper.emitted('update:open')).toBeUndefined()
    expect(wrapper.text()).toContain('内容已被他处修改')
    // 勾选原样保留，管理员重试即可
    expect(checkedMap(wrapper).ocr_pdf).toBe(true)
  })

  it('取消 → 只关窗，不发任何请求（"取消"= 不改动白名单）', async () => {
    const wrapper = await openDialog()

    await wrapper.find('[data-test="cancel"]').trigger('click')

    expect(saveMcpServiceConfig).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })
})

describe('McpToolScopeDialog —— 关窗必须真的退出模态态（2026-10-16 假死缺陷）', () => {
  it('取消关窗：MUST 先 `close()` 再兜底清 `open`（顺序反了 `close()` 变空操作 → 弹窗留在模态态、整页假死）', async () => {
    const wrapper = await openDialog()
    const el = dialogEl(wrapper)
    const closeState = stubClose(el)

    await wrapper.find('[data-test="cancel"]').trigger('click')
    // 父级 `v-model:open` 回落（真实用法里由 `McpArea` 驱动）
    await wrapper.setProps({ open: false })
    await flushPromises()

    expect(closeState.calls).toBe(1)
    expect(el.hasAttribute('open')).toBe(false)
  })

  it('保存成功关窗：同样必须真关（`close()` 生效），而不是只把属性摘掉', async () => {
    const wrapper = await openDialog()
    const el = dialogEl(wrapper)
    const closeState = stubClose(el)
    await toggle(wrapper, 'ocr_pdf')

    await wrapper.find('[data-test="save"]').trigger('click')
    await flushPromises()
    await wrapper.setProps({ open: false })
    await flushPromises()

    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
    expect(closeState.calls).toBe(1)
    expect(el.hasAttribute('open')).toBe(false)
  })

  it('组件卸载时（详情切走 / 卸载）也要真关，不留模态残留', async () => {
    const wrapper = await openDialog()
    const el = dialogEl(wrapper)
    const closeState = stubClose(el)

    wrapper.unmount()

    expect(closeState.calls).toBe(1)
    expect(el.hasAttribute('open')).toBe(false)
  })
})
