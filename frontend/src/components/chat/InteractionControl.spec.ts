/**
 * 组件测试：入参控件本体（标量控件 / JSON 视图 / 紧凑模式 / `@` 引用面板）。
 *
 * 守住的语义：控件形态由 schema 决定、"字段行"与"表格单元格"共用同一处实现
 * （`compact` 只改排版与可达性，不改取值口径）、JSON 文本非法时不污染模型。
 */
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import type { FilesApi } from '../../api/files'
import type { RuleFileResponse, WorkspaceSpace } from '../../api/types'
import type { ToastStore } from '../../composables/useToast'
import {
  INTERACTION_FORM_KEY,
  createInteractionForm,
  type InteractionFormContext,
} from '../../composables/useInteractionForm'
import { createPathInsertStore } from '../../composables/usePathInsert'
import { createWorkspaceStore } from '../../composables/useWorkspace'
import { asSchema, schemaAtPath } from '../../utils/arg-schema'
import type { NodePath } from '../../utils/json-path'
import InteractionControl from './InteractionControl.vue'

function makeForm(root: Record<string, unknown>, proposed: Record<string, unknown>) {
  return createInteractionForm({
    schema: root,
    proposed,
    loadRules: vi.fn<() => Promise<RuleFileResponse>>(),
  })
}

interface Setup {
  root: Record<string, unknown>
  path: NodePath
  proposed?: Record<string, unknown>
  name?: string
  compact?: boolean
  /** 传 true 时装配真实 `@` 引用状态机（需要 workspace 会话上下文） */
  mention?: boolean
}

function mountControl(setup: Setup) {
  const form = makeForm(setup.root, setup.proposed ?? {})
  const context: InteractionFormContext = {
    form,
    mention: setup.mention ? makeMention().mention : null,
    fileIndex: new Map(),
  }
  const wrapper = mount(InteractionControl, {
    props: {
      schema: schemaAtPath(asSchema(setup.root), setup.path) ?? {},
      path: setup.path,
      name: setup.name ?? String(setup.path[setup.path.length - 1] ?? ''),
      compact: setup.compact ?? false,
    },
    global: { provide: { [INTERACTION_FORM_KEY as symbol]: context } },
  })
  return { wrapper, form }
}

/* ---------- `@` 引用：真实状态机 + workspace 桩 ---------- */

const WORKSPACE_RESPONSE = {
  scenario: 's1',
  spaces: [
    {
      name: '临时空间',
      agent_writable: true,
      upload_extensions: ['.txt'],
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

function makeMention() {
  const files = { workspace: vi.fn().mockResolvedValue(WORKSPACE_RESPONSE), remove: vi.fn() }
  const workspace = createWorkspaceStore({
    files: files as unknown as FilesApi,
    toast: { push: vi.fn() } as unknown as ToastStore,
  })
  return { mention: createPathInsertStore({ workspace }) }
}

/** 模拟真实键入：写值 + 光标移到末尾 + 派发 input。 */
async function typeAt(wrapper: ReturnType<typeof mount>, text: string): Promise<void> {
  const field = wrapper.find('input[type=text]')
  const el = field.element as HTMLInputElement
  el.value = text
  el.setSelectionRange(text.length, text.length)
  await field.trigger('input')
}

describe('InteractionControl —— 标量控件', () => {
  it('文本：预填值、绑定 DOM id、输入回写模型', async () => {
    const { wrapper, form } = mountControl({
      root: { properties: { 产线: { type: 'string' } } },
      path: ['产线'],
      proposed: { 产线: 'L01' },
    })

    const input = wrapper.find('input[type=text]')
    expect((input.element as HTMLInputElement).value).toBe('L01')
    // 字段行的 <label for> 需要控件带 id（无障碍关联）
    expect(input.attributes('id')).toBeTruthy()

    await input.setValue('L09')

    expect(form.valueOf(['产线'])).toBe('L09')
  })

  it('数字控件回写文本中间态，开关回写布尔，下拉回写枚举值', async () => {
    const root = {
      properties: { 数量: { type: 'integer' }, 开关: { type: 'boolean' }, 类型: { type: 'string', enum: ['峰', '谷'] } },
    }
    const proposed = { 数量: 3, 开关: true, 类型: '峰' }

    const number = mountControl({ root, path: ['数量'], proposed })
    await number.wrapper.find('input[type=number]').setValue('5')
    expect(number.form.valueOf(['数量'])).toBe('5')

    const toggle = mountControl({ root, path: ['开关'], proposed })
    await toggle.wrapper.find('input[type=checkbox]').setValue(false)
    expect(toggle.form.valueOf(['开关'])).toBe(false)

    const select = mountControl({ root, path: ['类型'], proposed })
    await select.wrapper.find('select').setValue('谷')
    expect(select.form.valueOf(['类型'])).toBe('谷')
  })

  it('多行文本按 description 判定（含「多行」→ textarea）', () => {
    const { wrapper } = mountControl({
      root: { properties: { 备注: { type: 'string', description: '多行备注' } } },
      path: ['备注'],
      proposed: { 备注: '第一行' },
    })

    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('第一行')
  })
})

describe('InteractionControl —— JSON 视图', () => {
  it('schema 表达不了的形状（自由对象）直接以 JSON 文本呈现，文本非法时不污染模型', async () => {
    const { wrapper, form } = mountControl({
      root: { properties: { 参数: { type: 'object' } } },
      path: ['参数'],
      proposed: { 参数: { a: 1 } },
    })

    const area = wrapper.find('textarea.interaction-dialog__input--json')
    expect(JSON.parse((area.element as HTMLTextAreaElement).value)).toEqual({ a: 1 })

    await area.setValue('{ 坏掉的')

    expect(form.valueOf(['参数'])).toEqual({ a: 1 })
  })

  it('结构化节点被切到 JSON 视图时，控件本体就是那个 JSON 文本框', async () => {
    const root = { properties: { input: { type: 'object', properties: { a: { type: 'string' } } } } }
    const { wrapper, form } = mountControl({ root, path: ['input'], proposed: { input: { a: 'v' } } })

    form.toggleJsonView(['input'])
    await flushPromises() // 直接调状态方法后要等一次渲染

    expect(wrapper.find('textarea.interaction-dialog__input--json').exists()).toBe(true)
  })
})

describe('InteractionControl —— 紧凑模式（表格单元格 / 列表项）', () => {
  it('以列名作 aria-label、不挂 DOM id、多行文本退化为单行', () => {
    const { wrapper } = mountControl({
      root: { properties: { 备注: { type: 'string', description: '多行备注' } } },
      path: ['备注'],
      proposed: { 备注: '值' },
      name: '备注',
      compact: true,
    })

    expect(wrapper.find('textarea').exists()).toBe(false)
    const input = wrapper.find('input[type=text]')
    expect(input.attributes('aria-label')).toBe('备注')
    expect(input.attributes('id')).toBeUndefined()
  })

  it('单元格里的非标量形状退化为 JSON 文本框（而不是渲染成 [object Object]）', () => {
    const { wrapper } = mountControl({
      root: { properties: { 明细: { type: 'object', properties: { a: { type: 'string' } } } } },
      path: ['明细'],
      proposed: { 明细: { a: 1 } },
      name: '明细',
      compact: true,
    })

    const area = wrapper.find('textarea.interaction-dialog__input--json')
    expect(area.exists()).toBe(true)
    expect(JSON.parse((area.element as HTMLTextAreaElement).value)).toEqual({ a: 1 })
  })
})

describe('InteractionControl —— @ 文件引用面板', () => {
  it('输入 @ 展开面板，级联选中后把相对路径插入当前值', async () => {
    const { wrapper, form } = mountControl({
      root: { properties: { 路径: { type: 'string' } } },
      path: ['路径'],
      proposed: { 路径: '' },
      mention: true,
    })
    await flushPromises()

    await typeAt(wrapper, '@')
    expect(wrapper.find('.mention-picker').exists()).toBe(true)

    const space = wrapper.findAll('.mention-picker__item').find((item) => item.text() === '临时空间')!
    await space.trigger('click')
    const file = wrapper.findAll('.mention-picker__item').find((item) => item.text() === 'note.txt')!
    await file.trigger('click')

    expect(form.valueOf(['路径'])).toBe('临时空间/note.txt')
    expect(wrapper.find('.mention-picker').exists()).toBe(false)
  })

  it('Escape 关闭面板且保留已输文本', async () => {
    const { wrapper } = mountControl({
      root: { properties: { 路径: { type: 'string' } } },
      path: ['路径'],
      mention: true,
    })
    await flushPromises()

    await typeAt(wrapper, '@no')
    expect(wrapper.find('.mention-picker').exists()).toBe(true)

    await wrapper.find('input[type=text]').trigger('keydown', { key: 'Escape' })

    expect(wrapper.find('.mention-picker').exists()).toBe(false)
    expect((wrapper.find('input[type=text]').element as HTMLInputElement).value).toBe('@no')
  })

  it('紧凑模式不装配面板（单元格里不塞面板）', async () => {
    const { wrapper } = mountControl({
      root: { properties: { 路径: { type: 'string' } } },
      path: ['路径'],
      mention: true,
      compact: true,
    })
    await flushPromises()

    await typeAt(wrapper, '@')

    expect(wrapper.find('.mention-picker').exists()).toBe(false)
  })
})
