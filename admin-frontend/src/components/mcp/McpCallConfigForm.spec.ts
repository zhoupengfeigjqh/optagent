/**
 * 组件测试：MCP 调用配置表单（T118；原"服务级配置表单"，2026-09-15 更名）
 *
 * 守住 `FR-056`：**连接地址按运行形态分别声明**、至少一个。
 * （writable / permission_scope 已按 2026-09-15 的产品决定从配置中移除。）
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import McpCallConfigForm from './McpCallConfigForm.vue'
import type { McpServiceDetail } from '../../api/types'

const fetchRuntimeForms = vi.fn()
const testMcpService = vi.fn()

vi.mock('../../api/platform', () => ({
  fetchRuntimeForms: (...a: unknown[]) => fetchRuntimeForms(...a),
  fetchSettings: vi.fn(),
  saveSettings: vi.fn(),
  fetchHealth: vi.fn(),
}))

vi.mock('../../api/mcp', () => ({
  testMcpService: (...a: unknown[]) => testMcpService(...a),
}))

const SERVICE: McpServiceDetail = {
  name: 'ocr',
  transport: 'http',
  status: 'running',
  in_compose: true,
  description: 'OCR 识别服务',
  endpoints: { container_network: 'http://ocr:8000/mcp' },
  command: null,
  args: null,
  file_args: { ocr_image: { image: 'url' } },
  tools: [
    { name: 'ocr_image', description: '识别图片中的文字', parameters: {} },
    { name: 'parse_excel', description: '解析 Excel 文件', parameters: {} },
  ],
  tools_truncated: false,
  tools_error: null,
  compose_declaration: null,
  references: [],
  revision: 1,
}

function mountForm(service: McpServiceDetail = SERVICE) {
  return mount(McpCallConfigForm, { props: { service } })
}

beforeEach(() => {
  fetchRuntimeForms.mockReset().mockResolvedValue({
    items: [
      { value: 'container_network', label: '容器编排内网', hint: '如 http://ocr:8000/mcp' },
      { value: 'host_local', label: '宿主机本地', hint: '如 http://127.0.0.1:8000/mcp' },
    ],
  })
})

describe('McpServiceConfigForm', () => {
  it('按运行形态分组渲染地址输入框（FR-056）', async () => {
    const wrapper = mountForm()
    await flushPromises()
    expect(wrapper.text()).toContain('容器编排内网')
    expect(wrapper.text()).toContain('宿主机本地')
    // 已配置的形态预填，未配置的为空
    const inputs = wrapper.findAll('input[type="text"]')
    expect((inputs[1]?.element as HTMLInputElement).value).toBe('http://ocr:8000/mcp')
  })

  it('保存时只提交已填写的形态，并去掉空值', async () => {
    const wrapper = mountForm()
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('保存调用配置'))?.trigger('click')

    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, unknown>
    expect(payload.endpoints).toEqual({ container_network: 'http://ocr:8000/mcp' })
    // 已废弃字段 MUST NOT 再出现在提交载荷里
    expect(payload.writable).toBeUndefined()
    expect(payload.permission_scope).toBeUndefined()
  })

  it('全部形态都为空时报错且不提交（不会静默回退）', async () => {
    const wrapper = mountForm({ ...SERVICE, endpoints: {} })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('保存调用配置'))?.trigger('click')

    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.text()).toContain('至少需要一个运行形态的连接地址')
  })

  it('文件参数映射为非法 JSON 时报错且不提交', async () => {
    const wrapper = mountForm({ ...SERVICE, file_args: {} })
    await flushPromises()
    await wrapper.find('#mcp-file-args').setValue('{不是 JSON')
    await wrapper.findAll('button').find((b) => b.text().includes('保存调用配置'))?.trigger('click')

    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.text()).toContain('不是合法 JSON 对象')
  })

  it('stdio 传输时展示启动命令与参数输入（且命令必填由后端判定）', async () => {
    const wrapper = mountForm({ ...SERVICE, transport: 'stdio', command: 'python', args: ['-u', 'srv.py'] })
    await flushPromises()
    expect(wrapper.find('#mcp-command').exists()).toBe(true)
    expect((wrapper.find('#mcp-args').element as HTMLTextAreaElement).value).toBe('-u\nsrv.py')
  })

  it('http 传输时不展示启动命令', async () => {
    const wrapper = mountForm()
    await flushPromises()
    expect(wrapper.find('#mcp-command').exists()).toBe(false)
  })

  it('说明"缺目标形态地址会阻止部署"（不静默回退）', async () => {
    const wrapper = mountForm()
    await flushPromises()
    expect(wrapper.text()).toContain('阻止部署')
  })

  it('边界：形态列表不可得时退化为已有形态键，仍可编辑', async () => {
    fetchRuntimeForms.mockRejectedValue(new Error('boom'))
    const wrapper = mountForm()
    await flushPromises()
    expect(wrapper.text()).toContain('container_network')
  })

  it('边界：保存中禁用保存按钮（发起测试按钮不受影响）', async () => {
    const wrapper = mount(McpCallConfigForm, { props: { service: SERVICE, busy: true } })
    await flushPromises()
    const save = wrapper.findAll('button').find((b) => b.text().includes('保存'))
    const test = wrapper.findAll('button').find((b) => b.text().includes('发起测试'))
    expect(save?.attributes('disabled')).toBeDefined()
    expect(test?.attributes('disabled')).toBeUndefined()
  })

  it('回归：操作区按钮不重复（发起测试 / 保存调用配置 各一个）', async () => {
    const wrapper = mountForm()
    await flushPromises()
    const testButtons = wrapper.findAll('button').filter((b) => b.text().includes('发起测试'))
    const saveButtons = wrapper.findAll('button').filter((b) => b.text().includes('保存调用配置'))
    expect(testButtons).toHaveLength(1)
    expect(saveButtons).toHaveLength(1)
    // 顺序：发起测试在前（绿色）
    expect(testButtons[0]?.classes()).toContain('btn--success')
  })

  it('发起测试：以表单当前值（未保存也生效）探测，且无需先保存', async () => {
    testMcpService.mockReset().mockResolvedValue({
      ok: false,
      connectivity: { ok: false, duration_ms: 0, error_code: 'MCP_CONNECTION_REFUSED', message: 'x' },
      capability: { ok: false, method: 'ping', duration_ms: 0, error_code: 'MCP_NOT_ATTEMPTED', message: 'y' },
      target: { transport: 'http', url: 'http://ocr:9999/mcp', command: null },
      checked_at: '2026-09-15T00:00:00.000Z',
    })
    const wrapper = mountForm({ ...SERVICE, endpoints: { container_network: 'http://ocr:9999/mcp' } })
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text().includes('发起测试'))?.trigger('click')
    await flushPromises()

    // 探测目标 = 表单当前值，而非已保存的旧地址
    expect(testMcpService).toHaveBeenCalledWith('ocr', {
      transport: 'http',
      endpoints: { container_network: 'http://ocr:9999/mcp' },
    })
    // 测试与保存相互独立：未点保存也能测
    expect(wrapper.emitted('save')).toBeUndefined()
    // 结果以弹窗展示（jsdom 降级为 open 属性）
    expect(wrapper.find('dialog').attributes('open')).toBeDefined()
    expect(wrapper.text()).toContain('实际测试：streamable-http → http://ocr:9999/mcp')
    expect(wrapper.text()).toContain('测试未通过')
  })

  it('调用人工确认：默认 never 直跑，保存 payload 带 confirmation', async () => {
    const wrapper = mountForm()
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('保存调用配置'))?.trigger('click')

    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, unknown>
    expect(payload.confirmation).toBe('never')
  })

  it('调用人工确认：选「全部工具」保存 always', async () => {
    const wrapper = mountForm()
    await flushPromises()
    await wrapper.find('#mcp-confirmation-mode').setValue('always')
    await wrapper.findAll('button').find((b) => b.text().includes('保存调用配置'))?.trigger('click')

    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, unknown>
    expect(payload.confirmation).toBe('always')
  })

  it('调用人工确认：按工具模式从清单勾选 → { tools }；一个都没勾不提交', async () => {
    const wrapper = mountForm()
    await flushPromises()
    await wrapper.find('#mcp-confirmation-mode').setValue('custom')

    // 一个都没勾：报错且不提交
    await wrapper.findAll('button').find((b) => b.text().includes('保存调用配置'))?.trigger('click')
    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.text()).toContain('至少勾选一个工具')

    // 勾选清单里的两个工具
    const boxes = wrapper.findAll('.mcp-config-form__tools input[type="checkbox"]')
    await boxes[0]?.setValue(true)
    await boxes[1]?.setValue(true)
    await wrapper.findAll('button').find((b) => b.text().includes('保存调用配置'))?.trigger('click')

    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, unknown>
    expect(payload.confirmation).toEqual({ tools: ['ocr_image', 'parse_excel'] })
  })

  it('调用人工确认：服务工具清单不可得时回退手填文本', async () => {
    const wrapper = mountForm({ ...SERVICE, tools: [], tools_error: 'probe failed' })
    await flushPromises()
    await wrapper.find('#mcp-confirmation-mode').setValue('custom')

    await wrapper.find('#mcp-confirmation-tools').setValue('query_price\n\ncreate_order  ')
    await wrapper.findAll('button').find((b) => b.text().includes('保存调用配置'))?.trigger('click')

    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, unknown>
    expect(payload.confirmation).toEqual({ tools: ['query_price', 'create_order'] })
  })

  it('调用人工确认：编辑已配置 { tools } 的服务时预填勾选状态', async () => {
    const wrapper = mountForm({ ...SERVICE, confirmation: { tools: ['parse_excel'] } })
    await flushPromises()

    const mode = wrapper.find('#mcp-confirmation-mode')
    expect((mode.element as HTMLSelectElement).value).toBe('custom')
    const boxes = wrapper.findAll('.mcp-config-form__tools input[type="checkbox"]')
    expect((boxes[0]?.element as HTMLInputElement).checked).toBe(false)
    expect((boxes[1]?.element as HTMLInputElement).checked).toBe(true)
  })

  it('调用人工确认：已保存但清单未包含的工具保留展示，可取消勾选', async () => {
    // 存量的 legacy_tool 不在当前探测清单里：不得静默丢弃
    const wrapper = mountForm({ ...SERVICE, confirmation: { tools: ['legacy_tool'] } })
    await flushPromises()
    await wrapper.find('#mcp-confirmation-mode').setValue('custom')

    const orphan = wrapper.find('.mcp-config-form__tool--orphan')
    expect(orphan.exists()).toBe(true)
    expect(orphan.text()).toContain('legacy_tool')

    // 保持勾选 → 保存仍带上
    await wrapper.findAll('button').find((b) => b.text().includes('保存调用配置'))?.trigger('click')
    let payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, unknown>
    expect(payload.confirmation).toEqual({ tools: ['legacy_tool'] })

    // 取消勾选（并勾一个清单内工具，避免空清单校验拦截）→ 保存不再带
    await wrapper.find('.mcp-config-form__tool--orphan input[type="checkbox"]').setValue(false)
    await wrapper.findAll('.mcp-config-form__tools input[type="checkbox"]')[0]?.setValue(true)
    await wrapper.findAll('button').find((b) => b.text().includes('保存调用配置'))?.trigger('click')
    payload = wrapper.emitted('save')?.[1]?.[0] as Record<string, unknown>
    expect(payload.confirmation).toEqual({ tools: ['ocr_image'] })
  })
})
