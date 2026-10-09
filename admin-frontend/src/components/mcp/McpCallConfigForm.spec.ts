/**
 * 组件测试：MCP 调用配置表单（2026-09-27 改版）
 *
 * 守住三件事：
 * 1. **连接地址只有一个**（不再按运行形态分形态声明）；
 * 2. 表单**只服务已登记的服务**（名称只读、恒提供「发起测试」）——新建走弹窗；
 * 3. `FR-044` 的既有语义不变：file_args / HITL / rules_fields / async_tools。
 * （writable / permission_scope 已按 2026-09-15 的产品决定从配置中移除。）
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import McpCallConfigForm from './McpCallConfigForm.vue'
import type { McpServiceConfigInput, McpServiceDetail } from '../../api/types'

const testMcpService = vi.fn()

vi.mock('../../api/mcp', () => ({
  testMcpService: (...a: unknown[]) => testMcpService(...a),
}))

const SERVICE: McpServiceDetail = {
  name: 'ocr',
  transport: 'http',
  description: 'OCR 识别服务',
  url: 'http://192.168.1.2:8000/mcp',
  command: null,
  args: null,
  file_args: { ocr_image: { image: 'url' } },
  tools: [
    // ocr_image 声明了 result_url → 出现在「后台计算（异步工具）」可选项里；
    // parse_excel 未声明 → 该区不展示它（2026-10-03 产品决定：只列支持异步的工具）
    {
      name: 'ocr_image',
      description: '识别图片中的文字',
      parameters: { type: 'object', properties: { result_url: { type: 'string' } } },
    },
    { name: 'parse_excel', description: '解析 Excel 文件', parameters: {} },
  ],
  tools_truncated: false,
  tools_error: null,
  references: [],
  revision: 1,
  allowed_tools: [],
  missing_tools: [],
  headers: {},
}

/* 请求头（访问令牌）的用例见同目录 `McpCallConfigForm.headers.spec.ts`（本文件触 500 行门禁，故分居） */

/** 工具带参数 Schema 的夹具：字段下拉只列 array 入参 */
const SERVICE_WITH_SCHEMA: McpServiceDetail = {
  ...SERVICE,
  tools: [
    {
      name: 'ocr_image',
      description: '识别图片中的文字',
      parameters: {
        type: 'object',
        properties: {
          image: { type: 'string' },
          rules: { type: 'array', items: { type: 'object' } },
        },
      },
    },
    {
      name: 'parse_excel',
      description: '解析 Excel 文件',
      parameters: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'object' } },
          note: { type: 'string' },
        },
      },
    },
  ],
}

/** 规则数组嵌在入参对象内部的服务（真实形态：hd_scheduling_submit 的 input.targetPriorities） */
const SERVICE_WITH_NESTED_SCHEMA: McpServiceDetail = {
  ...SERVICE,
  tools: [
    {
      name: 'hd_scheduling_submit',
      description: '提交单工序排产任务',
      parameters: {
        type: 'object',
        properties: {
          input: {
            type: 'object',
            properties: {
              solvingTime: { type: 'integer' },
              targetPriorities: { type: 'array', items: { type: 'object' } },
            },
          },
        },
        required: ['input'],
      },
    },
  ],
}

function mountForm(service: McpServiceDetail = SERVICE) {
  return mount(McpCallConfigForm, { props: { service } })
}

/** 表单内唯一的动作按钮：「发起测试」（与连接地址同排） */
function testButton(wrapper: ReturnType<typeof mountForm>) {
  return wrapper.findAll('button').find((b) => b.text().includes('发起测试'))
}

function submitted(wrapper: ReturnType<typeof mountForm>, index = 0): McpServiceConfigInput {
  return wrapper.emitted('submit')?.[index]?.[0] as McpServiceConfigInput
}

/**
 * 触发保存。
 *
 * 保存/创建按钮已移到**详情页右上角**（`McpServiceDetail`），故这里直接调表单暴露的
 * `submit()`——与页头按钮、以及表单内回车提交走的是**同一条路径**（含本地校验）。
 */
async function save(wrapper: ReturnType<typeof mountForm>) {
  ;(wrapper.vm as unknown as { submit: () => void }).submit()
  await flushPromises()
}

beforeEach(() => {
  testMcpService.mockReset()
})

describe('McpCallConfigForm —— 编辑态', () => {
  it('按服务回填：名称只读、连接地址单一输入框', async () => {
    const wrapper = mountForm()
    await flushPromises()

    const name = wrapper.find('#mcp-name')
    expect((name.element as HTMLInputElement).value).toBe('ocr')
    expect(name.attributes('readonly')).toBeDefined()

    const url = wrapper.find('#mcp-url')
    expect((url.element as HTMLInputElement).value).toBe('http://192.168.1.2:8000/mcp')
    // 只有一个地址输入框（不再按运行形态分组）
    expect(wrapper.findAll('#mcp-url')).toHaveLength(1)
  })

  it('保存时提交调用配置：单一 url，且不带 name（名称由详情页按路径取）与废弃字段', async () => {
    const wrapper = mountForm()
    await flushPromises()
    await save(wrapper)

    const payload = submitted(wrapper)
    expect(payload.url).toBe('http://192.168.1.2:8000/mcp')
    expect(payload).not.toHaveProperty('endpoints')
    expect(payload).not.toHaveProperty('name')
    expect(payload).not.toHaveProperty('revision')
    expect((payload as Record<string, unknown>).writable).toBeUndefined()
    expect((payload as Record<string, unknown>).permission_scope).toBeUndefined()
  })

  it('http 连接地址为空时报错且不提交', async () => {
    const wrapper = mountForm({ ...SERVICE, url: '' })
    await flushPromises()
    await save(wrapper)

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain('连接地址必填')
  })

  it('file_args 经表格编辑视图提交，存储结构不变', async () => {
    const wrapper = mountForm({
      ...SERVICE,
      file_args: {
        ocr_image: { image: 'url' },
        parse_excel_files: { 'items[].excelFileUrl': 'url:from=items[].realRelativePath' },
      },
    })
    await flushPromises()
    await save(wrapper)

    expect(submitted(wrapper).file_args).toEqual({
      ocr_image: { image: 'url' },
      parse_excel_files: { 'items[].excelFileUrl': 'url:from=items[].realRelativePath' },
    })
  })

  it('stdio 传输时展示启动命令与参数输入，且不展示连接地址', async () => {
    const wrapper = mountForm({ ...SERVICE, transport: 'stdio', url: null, command: 'python', args: ['-u', 'srv.py'] })
    await flushPromises()
    expect(wrapper.find('#mcp-command').exists()).toBe(true)
    expect((wrapper.find('#mcp-args').element as HTMLTextAreaElement).value).toBe('-u\nsrv.py')
    expect(wrapper.find('#mcp-url').exists()).toBe(false)
  })

  it('http 传输时不展示启动命令', async () => {
    const wrapper = mountForm()
    await flushPromises()
    expect(wrapper.find('#mcp-command').exists()).toBe(false)
  })

  it('草稿锚定服务标识：同 name 的 props 刷新 MUST NOT 重置草稿（契约 §0.5 原则 ①）', async () => {
    const wrapper = mountForm()
    await flushPromises()
    await wrapper.find('#mcp-description').setValue('我改的用途')

    // 保存后父级重载详情：换成**同一服务**的新对象（name 未变）
    await wrapper.setProps({ service: { ...SERVICE } })
    await flushPromises()

    expect((wrapper.find('#mcp-description').element as HTMLInputElement).value).toBe('我改的用途')
  })

  it('切换服务（name 变）→ 按新服务回填（原则 ① 的唯一例外）', async () => {
    const wrapper = mountForm()
    await flushPromises()
    await wrapper.find('#mcp-description').setValue('我改的用途')

    await wrapper.setProps({ service: { ...SERVICE, name: 'jev', description: '决策服务' } })
    await flushPromises()

    expect((wrapper.find('#mcp-description').element as HTMLInputElement).value).toBe('决策服务')
  })

  it('忙态只锁按钮：`busy` 时表单控件 MUST NOT 被禁用（契约 §0.5 原则 ③）', async () => {
    const wrapper = mount(McpCallConfigForm, { props: { service: SERVICE, busy: true } })
    await flushPromises()

    expect(wrapper.find('#mcp-description').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('#mcp-transport').attributes('disabled')).toBeUndefined()
    const boxes = wrapper.findAll('.async-tools input[type="checkbox"]')
    expect(boxes.length).toBeGreaterThan(0)
    expect(boxes.every((b) => b.attributes('disabled') === undefined)).toBe(true)
    // 动作按钮则应当被锁住（忙态只锁动作按钮）
    expect(testButton(wrapper)?.attributes('disabled')).toBeDefined()
  })

  it('按钮位置：「发起测试」在「连接配置」框内（测的就是框内的值）；保存/创建/删除不在表单内', async () => {
    const wrapper = mountForm()
    await flushPromises()

    const test = testButton(wrapper)
    expect(test).toBeTruthy()
    expect(test?.classes()).toContain('btn--success')
    // 连接配置框：第一行是「连接地址 + 传输方式」，测试按钮在框内底部
    expect(wrapper.find('.mcp-config-form__conn #mcp-url').exists()).toBe(true)
    expect(wrapper.find('.mcp-config-form__conn #mcp-transport').exists()).toBe(true)
    expect(wrapper.findAll('.mcp-config-form__conn-actions button')).toHaveLength(1)

    expect(
      wrapper.findAll('button').filter((b) => /保存调用配置|创建服务|删除服务/.test(b.text())),
    ).toHaveLength(0)
  })

  it('连接配置同框：连接地址与传输方式同排（第一行），请求头在下一行且可空', async () => {
    const wrapper = mountForm()
    await flushPromises()

    const row = wrapper.find('.mcp-config-form__conn-row')
    expect(row.find('#mcp-url').exists()).toBe(true)
    expect(row.find('#mcp-transport').exists()).toBe(true)
    // 请求头**不在**第一行：它是框内的独立一行（可空）
    expect(row.find('[data-test="headers-input"]').exists()).toBe(false)
    expect(wrapper.find('.mcp-config-form__conn [data-test="headers-input"]').exists()).toBe(true)
  })

  it('服务名只读（名称即工具前缀，创建后不可改）；「发起测试」恒提供', async () => {
    const wrapper = mountForm()
    await flushPromises()

    expect(wrapper.find('#mcp-name').attributes('readonly')).toBeDefined()
    expect((wrapper.find('#mcp-name').element as HTMLInputElement).value).toBe('ocr')
    expect(testButton(wrapper)).toBeTruthy()
  })
})

describe('McpCallConfigForm —— 发起测试（FR-047）', () => {
  it('以表单当前值（未保存也生效）探测，且无需先保存', async () => {
    testMcpService.mockReset().mockResolvedValue({
      ok: false,
      connectivity: { ok: false, duration_ms: 0, error_code: 'MCP_CONNECTION_REFUSED', message: 'x' },
      capability: { ok: false, method: 'ping', duration_ms: 0, error_code: 'MCP_NOT_ATTEMPTED', message: 'y' },
      target: { transport: 'http', url: 'http://192.168.1.9:9999/mcp', command: null },
      checked_at: '2026-09-15T00:00:00.000Z',
    })
    const wrapper = mountForm({ ...SERVICE, url: 'http://192.168.1.9:9999/mcp' })
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text().includes('发起测试'))?.trigger('click')
    await flushPromises()

    // 探测目标 = 表单当前值，而非已保存的旧地址
    expect(testMcpService).toHaveBeenCalledWith('ocr', {
      transport: 'http',
      url: 'http://192.168.1.9:9999/mcp',
    })
    // 测试与保存相互独立：未点保存也能测
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.find('dialog').attributes('open')).toBeDefined()
    expect(wrapper.text()).toContain('实际测试：streamable-http → http://192.168.1.9:9999/mcp')
    expect(wrapper.text()).toContain('测试未通过')
  })
})

describe('McpCallConfigForm —— 调用人工确认（HITL）', () => {
  it('默认 never 直跑，提交载荷带 confirmation=never', async () => {
    const wrapper = mountForm()
    await flushPromises()
    await save(wrapper)
    expect(submitted(wrapper).confirmation).toBe('never')
  })

  it('选「全部工具」提交 always', async () => {
    const wrapper = mountForm()
    await flushPromises()
    await wrapper.find('#mcp-confirmation-mode').setValue('always')
    await save(wrapper)
    expect(submitted(wrapper).confirmation).toBe('always')
  })

  it('按工具模式从清单勾选 → { tools }；一个都没勾不提交', async () => {
    const wrapper = mountForm()
    await flushPromises()
    await wrapper.find('#mcp-confirmation-mode').setValue('custom')

    await save(wrapper)
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain('至少勾选一个工具')

    const boxes = wrapper.findAll('.mcp-config-form__tools input[type="checkbox"]')
    await boxes[0]?.setValue(true)
    await boxes[1]?.setValue(true)
    await save(wrapper)

    expect(submitted(wrapper).confirmation).toEqual({ tools: ['ocr_image', 'parse_excel'] })
  })

  it('服务工具清单不可得时回退手填文本', async () => {
    const wrapper = mountForm({ ...SERVICE, tools: [], tools_error: 'probe failed' })
    await flushPromises()
    await wrapper.find('#mcp-confirmation-mode').setValue('custom')

    await wrapper.find('#mcp-confirmation-tools').setValue('query_price\n\ncreate_order  ')
    await save(wrapper)

    expect(submitted(wrapper).confirmation).toEqual({ tools: ['query_price', 'create_order'] })
  })

  it('编辑已配置 { tools } 的服务时预填勾选状态', async () => {
    const wrapper = mountForm({ ...SERVICE, confirmation: { tools: ['parse_excel'] } })
    await flushPromises()

    const mode = wrapper.find('#mcp-confirmation-mode')
    expect((mode.element as HTMLSelectElement).value).toBe('custom')
    const boxes = wrapper.findAll('.mcp-config-form__tools input[type="checkbox"]')
    expect((boxes[0]?.element as HTMLInputElement).checked).toBe(false)
    expect((boxes[1]?.element as HTMLInputElement).checked).toBe(true)
  })

  it('已保存但清单未包含的工具保留展示，可取消勾选', async () => {
    const wrapper = mountForm({ ...SERVICE, confirmation: { tools: ['legacy_tool'] } })
    await flushPromises()
    await wrapper.find('#mcp-confirmation-mode').setValue('custom')

    const orphan = wrapper.find('.mcp-config-form__tool--orphan')
    expect(orphan.exists()).toBe(true)
    expect(orphan.text()).toContain('legacy_tool')

    await save(wrapper)
    expect(submitted(wrapper).confirmation).toEqual({ tools: ['legacy_tool'] })

    // 取消勾选（并勾一个清单内工具，避免空清单校验拦截）→ 提交不再带
    await wrapper.find('.mcp-config-form__tool--orphan input[type="checkbox"]').setValue(false)
    await wrapper.findAll('.mcp-config-form__tools input[type="checkbox"]')[0]?.setValue(true)
    await save(wrapper)
    // 第二次提交（索引 1）
    expect(submitted(wrapper, 1).confirmation).toEqual({ tools: ['ocr_image'] })
  })
})

describe('McpCallConfigForm —— 算法规则参数设置（rules_fields）', () => {
  it('HITL 无需确认时禁用且清空，提交 {}', async () => {
    const wrapper = mountForm({ ...SERVICE, rules_fields: { ocr_image: 'rules' } })
    await flushPromises()

    expect(wrapper.find('[data-test="add-rule"]').attributes('disabled')).toBeDefined()
    await save(wrapper)
    expect(submitted(wrapper).rules_fields).toEqual({})
  })

  it('全部工具需确认时所有工具可选，按 工具-字段 提交', async () => {
    const wrapper = mountForm(SERVICE_WITH_SCHEMA)
    await flushPromises()
    await wrapper.find('#mcp-confirmation-mode').setValue('always')

    await wrapper.find('[data-test="add-rule"]').trigger('click')
    await wrapper.find('[data-test="rule-tool-0"]').setValue('ocr_image')
    const fieldOptions = wrapper
      .find('[data-test="rule-field-0"]')
      .findAll('option')
      .map((o) => (o.element as HTMLOptionElement).value)
    // 只列 array 入参：rules / items，不列 string 型的 image / note
    expect(fieldOptions).toContain('rules')
    expect(fieldOptions).not.toContain('image')
    await wrapper.find('[data-test="rule-field-0"]').setValue('rules')

    await save(wrapper)
    expect(submitted(wrapper).rules_fields).toEqual({ ocr_image: 'rules' })

    // 编辑已配置的服务时预填（行回填 + 字段下拉选中；开 HITL 声明才会保留）
    const wrapper2 = mountForm({
      ...SERVICE_WITH_SCHEMA,
      confirmation: 'always',
      rules_fields: { parse_excel: 'items' },
    })
    await flushPromises()
    expect((wrapper2.find('[data-test="rule-tool-0"]').element as HTMLSelectElement).value).toBe(
      'parse_excel',
    )
    expect((wrapper2.find('[data-test="rule-field-0"]').element as HTMLSelectElement).value).toBe(
      'items',
    )
  })

  it('嵌套 array 字段按对象路径列出并保存', async () => {
    const wrapper = mountForm(SERVICE_WITH_NESTED_SCHEMA)
    await flushPromises()
    await wrapper.find('#mcp-confirmation-mode').setValue('always')

    await wrapper.find('[data-test="add-rule"]').trigger('click')
    await wrapper.find('[data-test="rule-tool-0"]').setValue('hd_scheduling_submit')

    const fieldOptions = wrapper
      .find('[data-test="rule-field-0"]')
      .findAll('option')
      .map((o) => (o.element as HTMLOptionElement).value)
    // 规则数组嵌在 input 里：必须按对象路径列出，否则这类目标永远选不出来（声明静默失效）
    expect(fieldOptions).toContain('input.targetPriorities')
    expect(fieldOptions).not.toContain('input')
    expect(fieldOptions).not.toContain('input.solvingTime')

    await wrapper.find('[data-test="rule-field-0"]').setValue('input.targetPriorities')
    await save(wrapper)

    expect(submitted(wrapper).rules_fields).toEqual({
      hd_scheduling_submit: 'input.targetPriorities',
    })
  })
})

describe('McpCallConfigForm —— 异步工具（R11）', () => {
  it('缺省为 []；清单不可得时手填后原样进入提交载荷', async () => {
    const plain = mountForm()
    await flushPromises()
    await save(plain)
    expect(submitted(plain).async_tools).toEqual([])

    const wrapper = mountForm({ ...SERVICE, tools: [] })
    await flushPromises()
    await wrapper.find('.async-tools textarea').setValue('submit_job\nget_status')
    await save(wrapper)
    expect(submitted(wrapper).async_tools).toEqual(['submit_job', 'get_status'])
  })
})
