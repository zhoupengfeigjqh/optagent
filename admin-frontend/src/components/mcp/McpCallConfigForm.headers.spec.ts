import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import McpCallConfigForm from './McpCallConfigForm.vue'
import type { McpServiceConfigInput, McpServiceDetail } from '../../api/types'

const testMcpService = vi.fn()

vi.mock('../../api/mcp', () => ({
  testMcpService: (...a: unknown[]) => testMcpService(...a),
}))

const SERVICE: McpServiceDetail = {
  name: 'raw_inventory_purchase_function',
  transport: 'http',
  description: '本体侧自建发布',
  url: 'http://localhost:8021/mcp',
  command: null,
  args: null,
  file_args: {},
  tools: [{ name: 'sum_raw_not_arrival_qty', description: '求和', parameters: {} }],
  tools_truncated: false,
  available_tools: [{ name: 'sum_raw_not_arrival_qty', description: '求和', parameters: {} }],
  available_tools_truncated: false,
  tools_error: null,
  references: [],
  revision: 1,
  allowed_tools: [],
  missing_tools: [],
  headers: {},
}

const SERVICE_WITH_HEADERS: McpServiceDetail = {
  ...SERVICE,
  headers: { 'X-MCP-Token': '6UuE…3F' },
}

function mountForm(service: McpServiceDetail = SERVICE) {
  return mount(McpCallConfigForm, { props: { service } })
}

function submitted(wrapper: ReturnType<typeof mountForm>, index = 0): McpServiceConfigInput {
  return wrapper.emitted('submit')?.[index]?.[0] as McpServiceConfigInput
}

function testButton(wrapper: ReturnType<typeof mountForm>) {
  return wrapper.findAll('button').find((b) => b.text().includes('发起测试'))
}

async function save(wrapper: ReturnType<typeof mountForm>) {
  ;(wrapper.vm as unknown as { submit: () => void }).submit()
  await flushPromises()
}

beforeEach(() => {
  testMcpService.mockReset()
})

describe('McpCallConfigForm —— 请求头填写行（2026-10-08）', () => {
  it('输入框常驻且**可空**；留空提交时**不带** headers（= 服务端沿用存量，不丢令牌）', async () => {
    const wrapper = mountForm(SERVICE_WITH_HEADERS)
    await flushPromises()

    expect(wrapper.find('[data-test="headers-input"]').exists()).toBe(true)
    expect((wrapper.find('[data-test="headers-input"]').element as HTMLTextAreaElement).value).toBe(
      '',
    )
    expect(wrapper.find('[data-test="headers-view"]').text()).toContain('X-MCP-Token: 6UuE…3F')
    expect(wrapper.find('[data-test="headers-view"] .mcp-headers__ok').exists()).toBe(true)
    expect(wrapper.find('[data-test="headers-view"] .mcp-headers__current').exists()).toBe(true)

    await save(wrapper)
    expect(submitted(wrapper)).not.toHaveProperty('headers')
  })

  it('填写不合规 → **即刻标红**（标签后「格式错误！」+ 可读原因 + 输入框描红）；留空不算错', async () => {
    const wrapper = mountForm(SERVICE_WITH_HEADERS)
    await flushPromises()

    expect(wrapper.find('[data-test="headers-invalid"]').exists()).toBe(false)

    await wrapper.find('[data-test="headers-input"]').setValue('X-MCP-Token: tk')
    await flushPromises()
    expect(wrapper.find('[data-test="headers-invalid"]').text()).toContain('格式错误')
    expect(wrapper.find('[data-test="headers-input"]').classes()).toContain('invalid')
    expect(wrapper.find('[data-test="headers-input"]').attributes('aria-invalid')).toBe('true')
    expect(wrapper.find('[data-test="headers-error"]').text()).toContain('合法 JSON')

    await wrapper.find('[data-test="headers-input"]').setValue('{"X-MCP-Token":"tk-1234567890"}')
    await flushPromises()
    expect(wrapper.find('[data-test="headers-invalid"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="headers-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="headers-input"]').classes()).not.toContain('invalid')
  })

  it('点「清空全部请求头」后不再标红（输入框已禁用，避免自相矛盾的两个意图）', async () => {
    const wrapper = mountForm(SERVICE_WITH_HEADERS)
    await flushPromises()

    await wrapper.find('[data-test="headers-input"]').setValue('X-MCP-Token: tk')
    await flushPromises()
    expect(wrapper.find('[data-test="headers-invalid"]').exists()).toBe(true)

    await wrapper.find('[data-test="clear-headers"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="headers-invalid"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="headers-input"]').attributes('disabled')).toBeDefined()
  })

  it('未配置请求头 → 不显示掩码一览；留空提交同样不带 headers', async () => {
    const wrapper = mountForm()
    await flushPromises()

    expect(wrapper.find('[data-test="headers-view"]').exists()).toBe(false)
    await save(wrapper)
    expect(submitted(wrapper)).not.toHaveProperty('headers')
  })

  it('填写真实令牌 → 提交载荷带该请求头（原样，非掩码）', async () => {
    const wrapper = mountForm(SERVICE_WITH_HEADERS)
    await flushPromises()

    await wrapper.find('[data-test="headers-input"]').setValue('{"X-MCP-Token":"tk-1234567890"}')
    await save(wrapper)

    expect(submitted(wrapper).headers).toEqual({ 'X-MCP-Token': 'tk-1234567890' })
  })

  it('写法非法 → 本地报错且不提交（把 JSON 写错说成 JSON 写错，而不是一次 401）', async () => {
    const wrapper = mountForm(SERVICE_WITH_HEADERS)
    await flushPromises()

    await wrapper.find('[data-test="headers-input"]').setValue('X-MCP-Token: tk')
    await save(wrapper)

    expect(submitted(wrapper)).toBeUndefined()
    expect(wrapper.text()).toContain('合法 JSON')
  })

  it('掩码值直接粘贴 → 本地拦下（那会把令牌换成掩码）', async () => {
    const wrapper = mountForm(SERVICE_WITH_HEADERS)
    await flushPromises()

    await wrapper.find('[data-test="headers-input"]').setValue('{"X-MCP-Token":"6UuE…3F"}')
    await save(wrapper)

    expect(submitted(wrapper)).toBeUndefined()
    expect(wrapper.text()).toContain('掩码')
  })

  it('「清空全部请求头」：须显式点，提交 `{}`；可撤销回到"不修改"', async () => {
    const wrapper = mountForm(SERVICE_WITH_HEADERS)
    await flushPromises()

    await wrapper.find('[data-test="clear-headers"]').trigger('click')
    expect(wrapper.find('[data-test="headers-clear-warning"]').text()).toContain(
      '全部请求头将被清除',
    )
    // 清空态下输入框被禁用（避免"既清空又填写"的自相矛盾意图）
    expect(wrapper.find('[data-test="headers-input"]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-test="undo-clear-headers"]').trigger('click')
    expect(wrapper.find('[data-test="headers-input"]').attributes('disabled')).toBeUndefined()
    await save(wrapper)
    expect(submitted(wrapper)).not.toHaveProperty('headers')

    await wrapper.find('[data-test="clear-headers"]').trigger('click')
    await save(wrapper)
    expect(submitted(wrapper, 1).headers).toEqual({})
  })

  it('未配置时不提供「清空」入口（没什么可清的）', async () => {
    const wrapper = mountForm()
    await flushPromises()
    expect(wrapper.find('[data-test="clear-headers"]').exists()).toBe(false)
  })

  it('保存回执（headersOverride）就地刷新掩码并清空输入', async () => {
    const wrapper = mountForm(SERVICE_WITH_HEADERS)
    await flushPromises()
    await wrapper.find('[data-test="headers-input"]').setValue('{"X-MCP-Token":"tk-1234567890"}')

    await wrapper.setProps({ headersOverride: { 'X-MCP-Token': 'tk-1…90' } })
    await flushPromises()

    expect(wrapper.find('[data-test="headers-view"]').text()).toContain('tk-1…90')
    expect((wrapper.find('[data-test="headers-input"]').element as HTMLTextAreaElement).value).toBe(
      '',
    )
  })

  it('「发起测试」：留空不带 headers（服务端按已保存的连），填了带表单值', async () => {
    const wrapper = mountForm(SERVICE_WITH_HEADERS)
    await flushPromises()
    testMcpService.mockResolvedValue({
      ok: true,
      connectivity: { ok: true, duration_ms: 1 },
      capability: { ok: true, method: 'ping', duration_ms: 1 },
      checked_at: '2026-10-08T00:00:00.000Z',
    })

    await testButton(wrapper)?.trigger('click')
    await flushPromises()
    // 留空：界面手上只有掩码 → MUST NOT 把掩码当请求头发出去
    expect(testMcpService.mock.calls[0]?.[1]).not.toHaveProperty('headers')

    await wrapper.find('[data-test="headers-input"]').setValue('{"X-MCP-Token":"tk-1234567890"}')
    await testButton(wrapper)?.trigger('click')
    await flushPromises()

    expect(testMcpService.mock.calls[1]?.[1].headers).toEqual({ 'X-MCP-Token': 'tk-1234567890' })
  })

  it('stdio 传输不渲染请求头（请求头是 HTTP 的概念）', async () => {
    const wrapper = mountForm({ ...SERVICE, transport: 'stdio', url: null, command: 'python' })
    await flushPromises()

    expect(wrapper.find('[data-test="headers-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="headers-view"]').exists()).toBe(false)
  })
})
