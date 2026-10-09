/**
 * 组件测试：新建 MCP 服务弹窗（2026-09-27；**2026-10-03 两步流程**）
 *
 * 守住的口径：
 * 1. 第一步只收基础字段，点「连接并获取工具」即**探测**（不创建）；
 * 2. 探测失败（连不上）→ 留在第一步、给出可读原因、**不创建任何记录**；
 * 3. 探测成功 → 进入工具勾选步：**默认不勾选、至少选一个**才能创建；
 * 4. 提交的载荷含 `allowed_tools`（trim 后的名称，`allowed_tools` 只在这一步给一次）；
 * 5. 校验判定与详情页表单**共用** `validateMcpBasics`（同一实现，不各写一套）；
 * 6. 失败（重名 409 / 连不上 / 校验失败）时**弹窗不关、输入不丢**（宪章原则九）；
 * 7. 处理中**禁止关闭**（Esc / 取消按钮皆然），避免"以为没建成"而重复创建；
 * 8. 可访问性：原生 `<dialog>` + 打开即聚焦服务名称（宪章原则四）。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import McpCreateDialog from './McpCreateDialog.vue'

const createMcpService = vi.fn()
const probeMcpTarget = vi.fn()

vi.mock('../../api/mcp', () => ({
  listMcpServices: vi.fn(),
  getMcpService: vi.fn(),
  createMcpService: (...a: unknown[]) => createMcpService(...a),
  saveMcpServiceConfig: vi.fn(),
  deleteMcpService: vi.fn(),
  testMcpService: vi.fn(),
  probeMcpTarget: (...a: unknown[]) => probeMcpTarget(...a),
  fetchMcpStats: vi.fn(),
}))

const TOOLS = [
  { name: 'ocr_image', description: '识别图片文字', parameters: {} },
  { name: 'ocr_pdf', description: '识别 PDF', parameters: {} },
]

/** 探测成功的默认结果 */
function probeOk() {
  probeMcpTarget.mockResolvedValue({
    ok: true,
    tools: TOOLS,
    tools_truncated: false,
    error: null,
    error_code: null,
    target: { transport: 'http', url: 'http://h:8000/mcp', command: null },
    checked_at: 'x',
  })
}

function mountDialog(open = true) {
  return mount(McpCreateDialog, { props: { open } })
}

function confirm(wrapper: ReturnType<typeof mountDialog>) {
  return wrapper.find('[data-test="confirm"]')
}

function cancel(wrapper: ReturnType<typeof mountDialog>) {
  return wrapper.find('[data-test="cancel"]')
}

function create(wrapper: ReturnType<typeof mountDialog>) {
  return wrapper.find('[data-test="create"]')
}

async function fillBasics(
  wrapper: ReturnType<typeof mountDialog>,
  values: { name?: string; description?: string; url?: string; headers?: string } = {},
): Promise<void> {
  if (values.name !== undefined) await wrapper.find('#mcp-create-name').setValue(values.name)
  if (values.description !== undefined) {
    await wrapper.find('#mcp-create-description').setValue(values.description)
  }
  if (values.url !== undefined) await wrapper.find('#mcp-create-url').setValue(values.url)
  if (values.headers !== undefined) {
    await wrapper.find('#mcp-create-headers').setValue(values.headers)
  }
}

/** 走完第一步：填基础信息 → 探测 → 进入工具勾选步 */
async function gotoStepTwo(
  wrapper: ReturnType<typeof mountDialog>,
  values: { name?: string; description?: string; url?: string; headers?: string } = {},
): Promise<void> {
  await fillBasics(wrapper, {
    name: values.name ?? 'ocr',
    url: values.url ?? 'http://h:8000/mcp',
    ...(values.description !== undefined ? { description: values.description } : {}),
    ...(values.headers !== undefined ? { headers: values.headers } : {}),
  })
  await confirm(wrapper).trigger('click')
  await flushPromises()
}

beforeEach(() => {
  createMcpService.mockReset().mockResolvedValue({ name: 'new-mcp' })
  probeMcpTarget.mockReset()
  probeOk()
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

describe('McpCreateDialog —— 第一步：校验（与详情页表单同一实现）', () => {
  it('服务名非法 → 报错且不探测、不创建', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await fillBasics(wrapper, { name: 'bad name', url: 'http://h:8000/mcp' })

    await confirm(wrapper).trigger('click')
    await flushPromises()

    expect(probeMcpTarget).not.toHaveBeenCalled()
    expect(createMcpService).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('服务名非法')
  })

  it('连接地址为空 / 非 http(s) 绝对地址 → 报错且不探测', async () => {
    for (const url of ['', '192.168.1.2:8000/mcp']) {
      const wrapper = mountDialog()
      await flushPromises()
      await fillBasics(wrapper, { name: 'ocr', url })

      await confirm(wrapper).trigger('click')
      await flushPromises()

      expect(probeMcpTarget).not.toHaveBeenCalled()
      expect(createMcpService).not.toHaveBeenCalled()
      expect(wrapper.text()).toMatch(/连接地址(必填|须为)/)
    }
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

    expect(probeMcpTarget).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('启动命令必填')
  })
})

describe('McpCreateDialog —— 第一步：探测', () => {
  it('探测成功 → 进入工具勾选步（探测载荷用 trim 后的值）', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await fillBasics(wrapper, { name: '  ocr  ', url: '  http://h:8000/mcp  ' })

    await confirm(wrapper).trigger('click')
    await flushPromises()

    expect(probeMcpTarget).toHaveBeenCalledWith({
      name: 'ocr',
      transport: 'http',
      url: 'http://h:8000/mcp',
      // 请求头（2026-10-08）：未填写即显式提交 {}（不带令牌的服务）
      headers: {},
    })
    expect(wrapper.findAll('[data-test="tool"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('已连接成功')
    // 还没创建
    expect(createMcpService).not.toHaveBeenCalled()
  })

  it('连不上 → 留在第一步、给出可读原因、**不创建任何记录**', async () => {
    probeMcpTarget.mockResolvedValue({
      ok: false,
      tools: [],
      tools_truncated: false,
      error: 'MCP 服务 ocr 不可达：连接被拒绝',
      error_code: 'ADM_RUNTIME_UNREACHABLE',
      target: { transport: 'http', url: 'http://h:8000/mcp', command: null },
      checked_at: 'x',
    })
    const wrapper = mountDialog()
    await flushPromises()
    await gotoStepTwo(wrapper)

    expect(wrapper.text()).toContain('无法连接该服务')
    expect(wrapper.text()).toContain('连接被拒绝')
    expect(wrapper.find('[data-test="tool"]').exists()).toBe(false)
    expect(createMcpService).not.toHaveBeenCalled()
    expect(wrapper.find('dialog').attributes('open')).toBeDefined()
  })

  it('探测成功但服务没有任何工具 → 提示无法创建，且创建按钮禁用', async () => {
    probeMcpTarget.mockResolvedValue({
      ok: true,
      tools: [],
      tools_truncated: false,
      error: null,
      error_code: null,
      target: { transport: 'http', url: 'http://h:8000/mcp', command: null },
      checked_at: 'x',
    })
    const wrapper = mountDialog()
    await flushPromises()
    await gotoStepTwo(wrapper)

    expect(wrapper.text()).toContain('未暴露任何工具')
    expect(create(wrapper).attributes('disabled')).toBeDefined()
  })
})

describe('McpCreateDialog —— 第二步：勾选并创建', () => {
  it('默认不勾选，且未勾选时创建被拦下（至少选一个）', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await gotoStepTwo(wrapper)

    for (const box of wrapper.findAll<HTMLInputElement>('[data-test="tool"]')) {
      expect(box.element.checked).toBe(false)
    }

    await create(wrapper).trigger('click')
    await flushPromises()

    expect(createMcpService).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('至少勾选一个可见工具')
  })

  it('勾选后创建 → 载荷含 allowed_tools（基础字段一并带上）', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await gotoStepTwo(wrapper, { name: 'ocr', description: '排产服务' })

    await wrapper.findAll('[data-test="tool"]')[1]!.setValue(true)
    await create(wrapper).trigger('click')
    await flushPromises()

    expect(createMcpService).toHaveBeenCalledWith({
      name: 'ocr',
      description: '排产服务',
      transport: 'http',
      url: 'http://h:8000/mcp',
      allowed_tools: ['ocr_pdf'],
      // 请求头（2026-10-08）：未填写即显式提交 {}（该服务不需要令牌）
      headers: {},
    })
  })

  it('「全选」/「清空」两个快捷动作可用', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await gotoStepTwo(wrapper)

    await wrapper.find('[data-test="select-all"]').trigger('click')
    for (const box of wrapper.findAll<HTMLInputElement>('[data-test="tool"]')) {
      expect(box.element.checked).toBe(true)
    }

    await wrapper.find('[data-test="clear-all"]').trigger('click')
    for (const box of wrapper.findAll<HTMLInputElement>('[data-test="tool"]')) {
      expect(box.element.checked).toBe(false)
    }
  })

  it('「上一步」回到基础信息步（输入保留）', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await gotoStepTwo(wrapper, { name: 'ocr' })

    await wrapper.find('[data-test="back"]').trigger('click')
    await flushPromises()

    expect((wrapper.find('#mcp-create-name').element as HTMLInputElement).value).toBe('ocr')
    expect(wrapper.find('[data-test="tool"]').exists()).toBe(false)
  })

  it('stdio 提交只带启动命令与白名单，不带连接地址', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await wrapper.find('#mcp-create-transport').setValue('stdio')
    await fillBasics(wrapper, { name: 'srv' })
    await wrapper.find('#mcp-create-command').setValue('  python  ')
    await confirm(wrapper).trigger('click')
    await flushPromises()

    await wrapper.findAll('[data-test="tool"]')[0]!.setValue(true)
    await create(wrapper).trigger('click')
    await flushPromises()

    expect(createMcpService).toHaveBeenCalledWith({
      name: 'srv',
      description: '',
      transport: 'stdio',
      command: 'python',
      allowed_tools: ['ocr_image'],
    })
  })

  it('创建成功 → 关闭弹窗 + 播报 + `created`（父级据此导航并自动测试一次）', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await gotoStepTwo(wrapper, { name: 'new-mcp' })

    await wrapper.findAll('[data-test="tool"]')[0]!.setValue(true)
    await create(wrapper).trigger('click')
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
    await gotoStepTwo(wrapper, { name: 'new-mcp', description: '排产服务' })

    await wrapper.findAll('[data-test="tool"]')[0]!.setValue(true)
    await create(wrapper).trigger('click')
    await flushPromises()

    // 前端按 code 分派文案，MUST NOT 直接展示后端 message
    expect(wrapper.text()).toContain('MCP 服务名称已存在，请换一个名称')
    expect(wrapper.emitted('created')).toBeUndefined()
    expect(wrapper.emitted('update:open')).toBeUndefined()
    expect(wrapper.find('dialog').attributes('open')).toBeDefined()

    // 输入不丢：失败后停在勾选步，回上一步仍能看到原值（不必重填）
    await wrapper.find('[data-test="back"]').trigger('click')
    await flushPromises()
    expect((wrapper.find('#mcp-create-name').element as HTMLInputElement).value).toBe('new-mcp')
    expect((wrapper.find('#mcp-create-description').element as HTMLInputElement).value).toBe(
      '排产服务',
    )
  })

  it('创建中：按钮均禁用，且 Esc/取消都关不掉（避免重复创建）', async () => {
    let resolveCreate: ((value: unknown) => void) | undefined
    createMcpService.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve
        }),
    )
    const wrapper = mountDialog()
    await flushPromises()
    await gotoStepTwo(wrapper, { name: 'new-mcp' })
    await wrapper.findAll('[data-test="tool"]')[0]!.setValue(true)

    await create(wrapper).trigger('click')
    await flushPromises()

    expect(create(wrapper).attributes('disabled')).toBeDefined()
    expect(cancel(wrapper).attributes('disabled')).toBeDefined()

    await wrapper.find('dialog').trigger('cancel')
    await cancel(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.emitted('update:open')).toBeUndefined()

    resolveCreate?.({ name: 'new-mcp' })
    await flushPromises()
    expect(wrapper.emitted('created')).toEqual([['new-mcp']])
  })

  it('重新打开时回到第一步并清空输入与报错（每次新建都是全新流程）', async () => {
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
    expect(wrapper.find('[data-test="tool"]').exists()).toBe(false)
  })
})

describe('McpCreateDialog —— 请求头（2026-10-08）', () => {
  it('填了请求头 → 探测与创建**都带上**（带令牌的服务不带它就是 401）', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await gotoStepTwo(wrapper, {
      headers: '{"X-MCP-Token":"tk-1234567890"}',
    })
    expect(probeMcpTarget.mock.calls[0]?.[0].headers).toEqual({ 'X-MCP-Token': 'tk-1234567890' })

    await wrapper.find('[data-test="select-all"]').trigger('click')
    await create(wrapper).trigger('click')
    await flushPromises()

    expect(createMcpService.mock.calls[0]?.[0].headers).toEqual({ 'X-MCP-Token': 'tk-1234567890' })
  })

  it('不填 → 显式提交 `{}`（该服务不需要令牌，配置里不留悬念）', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await gotoStepTwo(wrapper)
    expect(probeMcpTarget.mock.calls[0]?.[0].headers).toEqual({})

    await wrapper.find('[data-test="select-all"]').trigger('click')
    await create(wrapper).trigger('click')
    await flushPromises()
    expect(createMcpService.mock.calls[0]?.[0].headers).toEqual({})
  })

  it('请求头写法非法 → **当场标红**（不等提交），且留在第一步、不发探测请求', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await fillBasics(wrapper, { name: 'ocr', url: 'http://h:8000/mcp' })
    await wrapper.find('#mcp-create-headers').setValue('X-MCP-Token: tk')
    await flushPromises()

    // 就地反馈（2026-10-08）：标签后标红 + 可读原因 + 输入框描红
    expect(wrapper.find('[data-test="headers-invalid"]').text()).toContain('格式错误')
    expect(wrapper.find('[data-test="headers-input"]').classes()).toContain('invalid')
    expect(wrapper.find('[data-test="headers-error"]').text()).toContain('合法 JSON')

    await confirm(wrapper).trigger('click')
    await flushPromises()
    expect(probeMcpTarget).not.toHaveBeenCalled()
    // 输入不丢：仍在第一步，基础字段可继续编辑
    expect(wrapper.find('#mcp-create-url').exists()).toBe(true)
  })

  it('stdio 传输不展示请求头输入（请求头是 HTTP 的概念）', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('#mcp-create-transport').setValue('stdio')
    expect(wrapper.find('#mcp-create-headers').exists()).toBe(false)
  })
})
