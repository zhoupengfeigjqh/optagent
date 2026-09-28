/**
 * 组件测试：HITL 弹窗的 `@` 文件引用与结构化文件卡片。
 *
 * 与 `InteractionDialog.spec.ts` 的分工：那个管"表单本体"（schema 驱动、校验、提交、倒计时、
 * 算法规则入口），本文件只覆盖"字符串字段上的 `@` 引用链路"——
 * 面板展开/键盘导航/路径插入/结构化卡片展示与清除，以及无会话上下文时的降级。
 */
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import type { FilesApi } from '../../api/files'
import type { InteractionSnapshot, WorkspaceSpace } from '../../api/types'
import { APP_SESSION_KEY, type AppSession } from '../../composables/useAppSession'
import type { ToastStore } from '../../composables/useToast'
import { createWorkspaceStore } from '../../composables/useWorkspace'
import InteractionDialog from './InteractionDialog.vue'

function makeRequest(overrides: Partial<InteractionSnapshot> = {}): InteractionSnapshot {
  return {
    interaction_id: 'i_abc',
    call_id: 'c1',
    tool_name: 'some__tool',
    title: '确认调用参数：some__tool',
    schema: {
      type: 'object',
      properties: {
        产线: { type: 'string', description: '产线编号' },
        数量: { type: 'integer' },
      },
      required: ['产线'],
    },
    proposed_args: { 产线: 'L01' },
    required: ['产线'],
    timeout_seconds: 300,
    remaining_seconds: 300,
    ...overrides,
  }
}

const WORKSPACE_RESPONSE = {
  scenario: 's1',
  spaces: [
    {
      name: '数据准备',
      agent_writable: false,
      upload_extensions: ['.csv', '.xlsx'],
      dirs: [
        {
          dir: '数据准备/生产计划',
          label: '生产计划',
          deletable: true,
          files: [{ filename: 'plan.csv', size: 2048, updated_at: '2026-09-18 10:00' }],
          fields: [],
        },
      ],
    },
    {
      name: '临时空间',
      agent_writable: true,
      upload_extensions: ['.csv', '.xlsx', '.txt'],
      dirs: [
        {
          dir: '临时空间',
          label: '临时空间',
          deletable: true,
          files: [{ filename: 'note.txt', size: 12, updated_at: '2026-09-18 11:00' }],
          fields: [],
        },
      ],
    },
  ] as WorkspaceSpace[],
}

/** 造一个仅含 workspace 的会话桩（InjectionKey provide）。 */
function makeSession() {
  const files = {
    workspace: vi.fn().mockResolvedValue(WORKSPACE_RESPONSE),
    remove: vi.fn(),
  }
  const workspace = createWorkspaceStore({
    files: files as unknown as FilesApi,
    toast: { push: vi.fn() } as unknown as ToastStore,
  })
  return { session: { workspace } as unknown as AppSession, files }
}

function mountWithSession(request: InteractionSnapshot = makeRequest()) {
  const { session, files } = makeSession()
  const wrapper = mount(InteractionDialog, {
    props: { request },
    global: { provide: { [APP_SESSION_KEY as symbol]: session } },
  })
  return { wrapper, files }
}

function makeFileRequest(proposed: Record<string, unknown> = {}): InteractionSnapshot {
  return makeRequest({
    schema: {
      type: 'object',
      properties: { excelFileUrl: { type: 'string', description: 'Excel 相对路径' } },
      required: ['excelFileUrl'],
    },
    proposed_args: proposed,
    required: ['excelFileUrl'],
  })
}

/** 模拟真实键入：写值 + 光标移到末尾 + 派发 input（v-model 与 @ 检测都触发）。 */
async function typeAt(
  wrapper: ReturnType<typeof mount>,
  selector: string,
  text: string,
): Promise<void> {
  const field = wrapper.find(selector)
  const el = field.element as HTMLInputElement
  el.value = text
  el.setSelectionRange(text.length, text.length)
  await field.trigger('input')
}

async function clickPickerItem(wrapper: ReturnType<typeof mount>, text: string): Promise<void> {
  const item = wrapper.findAll('.mention-picker__item').find((button) => button.text() === text)
  expect(item, `面板中应存在选项「${text}」`).toBeDefined()
  await item!.trigger('click')
}

describe('InteractionDialog —— @ 文件引用与结构化卡片', () => {
  it('预填路径命中文件空间 → 展示结构化卡片（文件名/目录/大小），× 清除', async () => {
    const { wrapper } = mountWithSession(
      makeFileRequest({ excelFileUrl: '数据准备/生产计划/plan.csv' }),
    )
    await flushPromises()

    const card = wrapper.find('.interaction-dialog__file-card')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('plan.csv')
    expect(card.text()).toContain('数据准备/生产计划')
    expect(card.text()).toContain('2.0 KB')

    await card.find('.interaction-dialog__file-card-clear').trigger('click')

    expect((wrapper.find('input[type=text]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('.interaction-dialog__file-card').exists()).toBe(false)
  })

  it('路径不命中文件空间 → 无卡片，纯文本框（手工输入路径不受干扰）', async () => {
    const { wrapper } = mountWithSession(makeFileRequest({ excelFileUrl: 'tmp/whatever.xlsx' }))
    await flushPromises()

    expect(wrapper.find('.interaction-dialog__file-card').exists()).toBe(false)
    expect((wrapper.find('input[type=text]').element as HTMLInputElement).value).toBe(
      'tmp/whatever.xlsx',
    )
  })

  it('输入 @ 弹面板 → 点击级联选中文件 → 相对路径替换 @ 词插入', async () => {
    const { wrapper } = mountWithSession(makeFileRequest())
    await flushPromises()

    await typeAt(wrapper, 'input[type=text]', '@')
    expect(wrapper.find('.mention-picker').exists()).toBe(true)

    await clickPickerItem(wrapper, '数据准备')
    await clickPickerItem(wrapper, '生产计划')
    await clickPickerItem(wrapper, 'plan.csv')

    expect(wrapper.find('.mention-picker').exists()).toBe(false)
    expect((wrapper.find('input[type=text]').element as HTMLInputElement).value).toBe(
      '数据准备/生产计划/plan.csv',
    )
    // 提交层：字段值即相对路径，无附件/标记语义
    await wrapper.findAll('button').find((b) => b.text() === '确认提交')!.trigger('click')
    expect(wrapper.emitted('submit')).toEqual([[{ excelFileUrl: '数据准备/生产计划/plan.csv' }]])
  })

  it('键盘导航：Enter 依次下钻空间/目录/文件并完成插入', async () => {
    const { wrapper } = mountWithSession(makeFileRequest())
    await flushPromises()

    await typeAt(wrapper, 'input[type=text]', '@')
    const input = wrapper.find('input[type=text]')
    await input.trigger('keydown', { key: 'Enter' }) // 空间列 → 数据准备
    await input.trigger('keydown', { key: 'Enter' }) // 目录列 → 生产计划
    await input.trigger('keydown', { key: 'Enter' }) // 文件列 → 选中 plan.csv

    expect((input.element as HTMLInputElement).value).toBe('数据准备/生产计划/plan.csv')
    expect(wrapper.find('.mention-picker').exists()).toBe(false)
  })

  it('Escape 关闭面板且保留已输文本', async () => {
    const { wrapper } = mountWithSession(makeFileRequest())
    await flushPromises()

    await typeAt(wrapper, 'input[type=text]', '@pl')
    expect(wrapper.find('.mention-picker').exists()).toBe(true)

    await wrapper.find('input[type=text]').trigger('keydown', { key: 'Escape' })

    expect(wrapper.find('.mention-picker').exists()).toBe(false)
    expect((wrapper.find('input[type=text]').element as HTMLInputElement).value).toBe('@pl')
  })

  it('值被改走到不命中 → 卡片自动消失', async () => {
    const { wrapper } = mountWithSession(
      makeFileRequest({ excelFileUrl: '数据准备/生产计划/plan.csv' }),
    )
    await flushPromises()
    expect(wrapper.find('.interaction-dialog__file-card').exists()).toBe(true)

    await typeAt(wrapper, 'input[type=text]', 'user-data/other.xlsx')

    expect(wrapper.find('.interaction-dialog__file-card').exists()).toBe(false)
  })

  it('label 中文短标签：title 为参数名大小写变体时忽略，取 description 首句', async () => {
    const request = makeRequest({
      schema: {
        type: 'object',
        properties: {
          // FastMCP 自动生成的 title（与参数名同义）→ 忽略，应落到 description 首句
          image: {
            type: 'string',
            title: 'Image',
            description: '要识别的图片：填相对路径。图片不超过 2MB',
          },
          // 有意义的 title → 直接用
          line: { type: 'string', title: '产线' },
          // 既无 title 也无 description → 只有参数名
          qty: { type: 'integer' },
        },
        required: [],
      },
      proposed_args: {},
      required: [],
    })
    const wrapper = mountWithSession(request).wrapper

    const labels = wrapper.findAll('.interaction-dialog__label')
    expect(labels[0]!.text()).toContain('image')
    expect(labels[0]!.find('.interaction-dialog__label-hint').text()).toBe('要识别的图片：填相对路径')
    expect(labels[1]!.find('.interaction-dialog__label-hint').text()).toBe('产线')
    expect(labels[2]!.find('.interaction-dialog__label-hint').exists()).toBe(false)
  })

  it('工具级描述收进「?」：默认不展示，点开才看；缺省时不渲染「?」', async () => {
    const withDesc = makeRequest({ tool_description: '识别图片中的文字，返回按行拼接的文本' })
    const wrapper = mountWithSession(withDesc).wrapper

    // 默认不占版面（字段行自己也可能带「?」，故按无障碍名精确定位到工具说明那个）
    expect(wrapper.text()).not.toContain('识别图片中的文字')
    const button = wrapper.find('[aria-label="查看工具说明"]')
    expect(button.exists()).toBe(true)

    await button.trigger('click')
    expect(wrapper.find('.hint-tip__pop').text()).toContain('识别图片中的文字')

    // 老快照无 tool_description → 连「?」都不渲染
    const withoutDesc = mountWithSession(makeRequest()).wrapper
    expect(withoutDesc.find('[aria-label="查看工具说明"]').exists()).toBe(false)
  })

  it('多行 textarea：@ 引用同样可用，且提交携带输入值（绑定回归）', async () => {
    const request = makeRequest({
      schema: {
        type: 'object',
        properties: { 备注: { type: 'string', description: '多行备注' } },
        required: [],
      },
      proposed_args: {},
      required: [],
    })
    const { wrapper } = mountWithSession(request)
    await flushPromises()

    await typeAt(wrapper, 'textarea', '使用文件 ')
    await typeAt(wrapper, 'textarea', '使用文件 @')
    await clickPickerItem(wrapper, '临时空间')
    await clickPickerItem(wrapper, 'note.txt')

    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe(
      '使用文件 临时空间/note.txt',
    )

    await wrapper.findAll('button').find((b) => b.text() === '确认提交')!.trigger('click')
    expect(wrapper.emitted('submit')).toEqual([[{ 备注: '使用文件 临时空间/note.txt' }]])
  })

  it('无会话上下文（未 provide）→ 退化为纯表单：不挂卡片、不展开面板', async () => {
    const wrapper = mount(InteractionDialog, {
      props: { request: makeFileRequest({ excelFileUrl: '数据准备/生产计划/plan.csv' }) },
    })
    await flushPromises()

    expect(wrapper.find('.interaction-dialog__file-card').exists()).toBe(false)
    expect((wrapper.find('input[type=text]').element as HTMLInputElement).value).toBe(
      '数据准备/生产计划/plan.csv',
    )

    await typeAt(wrapper, 'input[type=text]', '@')
    expect(wrapper.find('.mention-picker').exists()).toBe(false)
  })
})
