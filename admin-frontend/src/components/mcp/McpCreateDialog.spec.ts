/**
 * 组件测试：新建 MCP 服务弹窗（2026-09-27）。
 *
 * 守住的口径：
 * 1. 只收基础字段（名称/用途描述/传输方式/连接地址或启动命令），**不做在线测试**（测试在详情页）；
 * 2. 校验判定与详情页表单**共用** `validateMcpBasics`（同一实现，不各写一套）；
 * 3. 失败（重名 409 / 校验失败）时**弹窗不关、输入不丢**（宪章原则九：错误可感知）；
 * 4. 创建中**禁止关闭**（Esc / 取消按钮皆然），避免"以为没建成"而重复创建；
 * 5. 可访问性：原生 `<dialog>` + 打开即聚焦服务名称（宪章原则四）。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import McpCreateDialog from './McpCreateDialog.vue'

const createMcpService = vi.fn()

vi.mock('../../api/mcp', () => ({
  listMcpServices: vi.fn(),
  getMcpService: vi.fn(),
  createMcpService: (...a: unknown[]) => createMcpService(...a),
  saveMcpServiceConfig: vi.fn(),
  deleteMcpService: vi.fn(),
  testMcpService: vi.fn(),
  fetchMcpStats: vi.fn(),
}))

function mountDialog(open = true) {
  return mount(McpCreateDialog, { props: { open } })
}

function confirm(wrapper: ReturnType<typeof mountDialog>) {
  return wrapper.find('[data-test="confirm"]')
}

function cancel(wrapper: ReturnType<typeof mountDialog>) {
  return wrapper.find('[data-test="cancel"]')
}

async function fillBasics(
  wrapper: ReturnType<typeof mountDialog>,
  values: { name?: string; description?: string; url?: string } = {},
): Promise<void> {
  if (values.name !== undefined) await wrapper.find('#mcp-create-name').setValue(values.name)
  if (values.description !== undefined) {
    await wrapper.find('#mcp-create-description').setValue(values.description)
  }
  if (values.url !== undefined) await wrapper.find('#mcp-create-url').setValue(values.url)
}

beforeEach(() => {
  createMcpService.mockReset().mockResolvedValue({ name: 'new-mcp' })
})

describe('McpCreateDialog —— 打开与关闭', () => {
  it('打开时展示全部基础字段，并聚焦服务名称输入框', async () => {
    // 焦点断言要求元素真的在文档里（`focus()` 对脱离文档的节点无效）
    const wrapper = mount(McpCreateDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    expect(wrapper.find('#mcp-create-name').exists()).toBe(true)
    expect(wrapper.find('#mcp-create-description').exists()).toBe(true)
    expect(wrapper.find('#mcp-create-transport').exists()).toBe(true)
    expect(wrapper.find('#mcp-create-url').exists()).toBe(true)
    expect(document.activeElement?.id).toBe('mcp-create-name')

    wrapper.unmount()
  })

  it('空闲时 Esc → 关闭（update:open=false）', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('dialog').trigger('cancel')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('`open` 转 false → 关闭原生对话框', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    expect(wrapper.find('dialog').attributes('open')).toBeDefined()

    await wrapper.setProps({ open: false })
    await flushPromises()

    expect(wrapper.find('dialog').attributes('open')).toBeUndefined()
  })
})

describe('McpCreateDialog —— 校验（与详情页表单同一实现）', () => {
  it('服务名非法 → 报错且不提交', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await fillBasics(wrapper, { name: 'bad name', url: 'http://h:8000/mcp' })

    await confirm(wrapper).trigger('click')
    await flushPromises()

    expect(createMcpService).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('服务名非法')
  })

  it('连接地址为空 → 报错且不提交', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await fillBasics(wrapper, { name: 'ocr', url: '' })

    await confirm(wrapper).trigger('click')
    await flushPromises()

    expect(createMcpService).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('连接地址必填')
  })

  it('连接地址不是 http(s) 绝对地址 → 报错且不提交', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await fillBasics(wrapper, { name: 'ocr', url: '192.168.1.2:8000/mcp' })

    await confirm(wrapper).trigger('click')
    await flushPromises()

    expect(createMcpService).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('连接地址须为')
  })

  it('切到 stdio：显示启动命令、隐藏连接地址；启动命令为空则报错', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await wrapper.find('#mcp-create-transport').setValue('stdio')

    expect(wrapper.find('#mcp-create-command').exists()).toBe(true)
    expect(wrapper.find('#mcp-create-url').exists()).toBe(false)

    await fillBasics(wrapper, { name: 'srv' })
    await confirm(wrapper).trigger('click')
    await flushPromises()

    expect(createMcpService).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('启动命令必填')
  })
})

describe('McpCreateDialog —— 提交与失败处理', () => {
  it('合法输入 → 只提交基础字段（名称 trim，writable/permission_scope 等废弃字段不得出现）', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await fillBasics(wrapper, {
      name: '  new-mcp  ',
      description: '排产服务',
      url: '  http://192.168.1.2:9000/mcp  ',
    })

    await confirm(wrapper).trigger('click')
    await flushPromises()

    expect(createMcpService).toHaveBeenCalledWith({
      name: 'new-mcp',
      description: '排产服务',
      transport: 'http',
      url: 'http://192.168.1.2:9000/mcp',
    })
  })

  it('stdio 提交只带启动命令，不带连接地址', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await wrapper.find('#mcp-create-transport').setValue('stdio')
    await fillBasics(wrapper, { name: 'srv' })
    await wrapper.find('#mcp-create-command').setValue('  python  ')

    await confirm(wrapper).trigger('click')
    await flushPromises()

    expect(createMcpService).toHaveBeenCalledWith({
      name: 'srv',
      description: '',
      transport: 'stdio',
      command: 'python',
    })
  })

  it('创建成功 → 关闭弹窗 + 播报 + `created`（父级据此导航并自动测试一次）', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await fillBasics(wrapper, { name: 'new-mcp', url: 'http://h:8000/mcp' })

    await confirm(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.emitted('created')).toEqual([['new-mcp']])
    expect(wrapper.emitted('update:open')).toEqual([[false]])
    expect(wrapper.emitted('announce')?.[0]?.[0]).toContain('已创建')
  })

  it('重名 409 → 显示可读文案、弹窗不关、输入保留', async () => {
    createMcpService.mockRejectedValue({
      code: 'ADM_MCP_SERVICE_EXISTS',
      message: 'MCP 服务名称已存在：new-mcp',
    })
    const wrapper = mountDialog()
    await flushPromises()
    await fillBasics(wrapper, { name: 'new-mcp', description: '排产服务', url: 'http://h:8000/mcp' })

    await confirm(wrapper).trigger('click')
    await flushPromises()

    // 前端按 code 分派文案，MUST NOT 直接展示后端 message
    expect(wrapper.text()).toContain('MCP 服务名称已存在，请换一个名称')
    expect(wrapper.emitted('created')).toBeUndefined()
    expect(wrapper.emitted('update:open')).toBeUndefined()
    expect(wrapper.find('dialog').attributes('open')).toBeDefined()
    expect((wrapper.find('#mcp-create-name').element as HTMLInputElement).value).toBe('new-mcp')
    expect((wrapper.find('#mcp-create-description').element as HTMLInputElement).value).toBe(
      '排产服务',
    )
  })

  it('创建中：两个按钮均禁用，且 Esc/取消都关不掉（避免重复创建）', async () => {
    let resolveCreate: ((value: unknown) => void) | undefined
    createMcpService.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve
        }),
    )
    const wrapper = mountDialog()
    await flushPromises()
    await fillBasics(wrapper, { name: 'new-mcp', url: 'http://h:8000/mcp' })

    await confirm(wrapper).trigger('click')
    await flushPromises()

    expect(confirm(wrapper).attributes('disabled')).toBeDefined()
    expect(cancel(wrapper).attributes('disabled')).toBeDefined()

    await wrapper.find('dialog').trigger('cancel')
    await cancel(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.emitted('update:open')).toBeUndefined()

    resolveCreate?.({ name: 'new-mcp' })
    await flushPromises()
    expect(wrapper.emitted('created')).toEqual([['new-mcp']])
  })

  it('重新打开时清空上一次的输入与报错（每次新建都是全新表单）', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await fillBasics(wrapper, { name: 'bad name', url: 'x' })
    await confirm(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('服务名非法')

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await flushPromises()

    expect((wrapper.find('#mcp-create-name').element as HTMLInputElement).value).toBe('')
    expect(wrapper.text()).not.toContain('服务名非法')
  })
})
