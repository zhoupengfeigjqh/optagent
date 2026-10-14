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
          upload_extensions: ['.txt'],
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
    // DOM 的 value 是选项**下标**（原值由下标承载）：下标 1 即「谷」
    await select.wrapper.find('select').setValue('1')
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

  it('有 enum 的单元格同样是下拉（compact 只改排版，不改控件形态与取值口径）', async () => {
    // 合成字段名：真实契约里并没有"数字枚举"的字段（`businessType` 是 `{"type":"integer"}`，
    // 1~5 只写在 description 里），故不借用真实字段名，免得"数字枚举"被误挂到它身上
    const { wrapper, form } = mountControl({
      root: { properties: { 数字枚举: { type: 'integer', enum: [1, 2, 3, 4, 5] } } },
      path: ['数字枚举'],
      proposed: { 数字枚举: 1 },
      name: '数字枚举',
      compact: true,
    })

    const select = wrapper.find('select')
    expect(select.exists()).toBe(true)
    expect(wrapper.find('input[type=text]').exists()).toBe(false)

    // 与字段行同源：写回的仍是选项原值（number），不是字符串
    await select.setValue('3')
    expect(form.valueOf(['数字枚举'])).toBe(4)
  })

  it('单元格里的文本类控件同样带「可打 @ 选择文件」占位提示（与字段行同源）', () => {
    const { wrapper } = mountControl({
      root: { properties: { realRelativePath: { type: 'string' } } },
      path: ['realRelativePath'],
      name: 'realRelativePath',
      compact: true,
    })

    expect(wrapper.find('input[type=text]').attributes('placeholder')).toBe('可打 @ 选择文件')
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

  it('紧凑模式（表格单元格）同样装配面板：格子里也能 @ 选文件', async () => {
    const { wrapper, form } = mountControl({
      root: { properties: { 路径: { type: 'string' } } },
      path: ['路径'],
      proposed: { 路径: '' },
      mention: true,
      compact: true,
    })
    await flushPromises()

    await typeAt(wrapper, '@')
    expect(wrapper.find('.mention-picker').exists()).toBe(true)

    const space = wrapper.findAll('.mention-picker__item').find((item) => item.text() === '临时空间')!
    await space.trigger('click')
    const file = wrapper.findAll('.mention-picker__item').find((item) => item.text() === 'note.txt')!
    await file.trigger('click')

    expect(form.valueOf(['路径'])).toBe('临时空间/note.txt')
  })

  it('浮层留在原 DOM 子树内（不 Teleport），随字段卸载而消失', async () => {
    const { wrapper } = mountControl({
      root: { properties: { 路径: { type: 'string' } } },
      path: ['路径'],
      mention: true,
    })
    await flushPromises()

    await typeAt(wrapper, '@')

    // Teleport 的内容不会出现在 wrapper.html() 里，因此这条断言即"没有搬动 DOM"
    expect(wrapper.html()).toContain('mention-popup')
    expect(wrapper.find('.mention-popup').exists()).toBe(true)
  })
})

describe('InteractionControl —— 占位提示', () => {
  it('文本类控件提示「可打 @ 选择文件」；数字控件仍是「数字」；开关不提示', () => {
    const text = mountControl({ root: { properties: { 路径: { type: 'string' } } }, path: ['路径'] })
    expect(text.wrapper.find('input[type=text]').attributes('placeholder')).toBe('可打 @ 选择文件')

    const number = mountControl({
      root: { properties: { 数量: { type: 'integer' } } },
      path: ['数量'],
    })
    expect(number.wrapper.find('input[type=number]').attributes('placeholder')).toBe('数字')

    const toggle = mountControl({ root: { properties: { 开关: { type: 'boolean' } } }, path: ['开关'] })
    expect(toggle.wrapper.find('input[type=checkbox]').attributes('placeholder')).toBeUndefined()
  })
})

describe('InteractionControl —— 下拉取值类型', () => {
  it('数字枚举写回保留 number（schema 声明 integer 时不得变成字符串）', async () => {
    // 合成字段名，理由同上条
    const { wrapper, form } = mountControl({
      root: { properties: { 数字枚举: { type: 'integer', enum: [1, 2, 3, 4, 5] } } },
      path: ['数字枚举'],
      proposed: { 数字枚举: 1 },
    })

    const select = wrapper.find('select')
    expect(select.exists()).toBe(true)

    // DOM 里 `option.value` 是**下标**（原值由下标承载），下标 3 即原值 4
    await select.setValue('3')

    expect(form.valueOf(['数字枚举'])).toBe(4)
    expect(typeof form.valueOf(['数字枚举'])).toBe('number')
  })

  it('字符串枚举仍写回字符串', async () => {
    const { wrapper, form } = mountControl({
      root: { properties: { 类型: { type: 'string', enum: ['峰', '谷'] } } },
      path: ['类型'],
      proposed: { 类型: '峰' },
    })

    // 下标 1 即「谷」
    await wrapper.find('select').setValue('1')

    expect(form.valueOf(['类型'])).toBe('谷')
  })

  it('字符串化后彼此相同的退化枚举靠**下标**分辨（按字符串反查会静默写错）', async () => {
    const { wrapper, form } = mountControl({
      root: { properties: { code: { enum: [1, '1'] } } },
      path: ['code'],
      proposed: { code: 1 },
    })

    // 两个选项的**原值**不同（数字 1 / 字符串 '1'），但字符串化后完全一样
    expect(wrapper.findAll('option').map((option) => option.text())).toEqual(['请选择', '1', '1'])

    await wrapper.find('select').setValue('1')

    expect(form.valueOf(['code'])).toBe('1')
    expect(typeof form.valueOf(['code'])).toBe('string')
  })
})
