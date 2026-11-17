/**
 * 组件测试：输入区（2026-10-18 起「引用即胶囊」）。
 *
 * 守住的语义：
 * 1. **只显示一处**：选中的文件在正文里就是一枚不可编辑的胶囊（`@文件名` + 移除按钮），
 *    输入框上方不再有第二排 chip；
 * 2. **草稿仍是字符串**：胶囊的标记参与序列化，`@` 触发、反向同步、发送载荷的旧口径不变；
 * 3. **`mention` 插槽只出数据与锚点**（面板本体是 `fixed` 浮层，见 MentionPopup）。
 */
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import type { FileReference } from '../../api/types'
import Composer from './Composer.vue'

const REFERENCE: FileReference = { dir: '数据准备/生产计划', filename: '产能.xlsx' }

function mountComposer(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  return mount(Composer, { props: { modelValue: '', ...props }, slots })
}

/** 输入区本体（contenteditable 容器） */
function editorOf(wrapper: ReturnType<typeof mountComposer>) {
  return wrapper.find('.composer__input')
}

describe('Composer —— 内联引用胶囊', () => {
  it('引用的文件在正文里落成「@文件名 + 移除按钮」胶囊，且不再有上方 chip 列表', () => {
    const wrapper = mountComposer({
      modelValue: '看下 @产能.xlsx 的数据',
      references: [REFERENCE],
    })

    const chips = wrapper.findAll('.composer__mention')
    expect(chips).toHaveLength(1)
    expect(chips[0]!.text()).toBe('@产能.xlsx')
    expect(chips[0]!.attributes('contenteditable')).toBe('false')
    expect(chips[0]!.find('.composer__mention-remove').attributes('aria-label')).toBe(
      '移除引用 产能.xlsx',
    )
    // 旧的上方 chip 行已删除：同一次选择只显示一处
    expect(wrapper.find('.composer__refs').exists()).toBe(false)
  })

  it('正文里没有对应引用时 `@xxx` 保持纯文本（手打不会被误认成引用）', () => {
    const wrapper = mountComposer({ modelValue: '看下 @plan.csv 的数据', references: [] })

    expect(wrapper.findAll('.composer__mention')).toHaveLength(0)
    expect(editorOf(wrapper).text()).toBe('看下 @plan.csv 的数据')
  })

  it('点胶囊的移除按钮：上报引用，并把去掉标记后的草稿交回上层', async () => {
    const wrapper = mountComposer({
      modelValue: '看下 @产能.xlsx 的数据',
      references: [REFERENCE],
    })

    await wrapper.find('.composer__mention-remove').trigger('click')

    expect(wrapper.emitted('remove-reference')).toEqual([[REFERENCE]])
    const emitted = wrapper.emitted('update:modelValue') ?? []
    expect(emitted.at(-1)).toEqual(['看下  的数据'])
  })

  it('上层插入标记后（选完文件）正文自动落成胶囊', async () => {
    const wrapper = mountComposer({ modelValue: '看下 @' })

    // 选完文件的写法与真实链路一致：引用先入集合，再由 `insertToken` 改写草稿
    await wrapper.setProps({ modelValue: '看下 @产能.xlsx ', references: [REFERENCE] })
    await nextTick()

    expect(wrapper.findAll('.composer__mention')).toHaveLength(1)
    // 用 textContent：`text()` 会 trim，尾随空格正是插入标记的一部分
    expect((editorOf(wrapper).element as HTMLElement).textContent).toBe('看下 @产能.xlsx ')
  })

  it('胶囊按标记参与序列化：DOM 里的胶囊回传为 `@文件名`', async () => {
    const wrapper = mountComposer({
      modelValue: '看下 @产能.xlsx 的数据',
      references: [REFERENCE],
    })

    await editorOf(wrapper).trigger('input')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['看下 @产能.xlsx 的数据'])
  })
})

describe('Composer —— 文本输入', () => {
  it('用户敲字后把正文文本与光标位置交给上层（`@` 触发检测用）', async () => {
    const wrapper = mountComposer()
    const editor = editorOf(wrapper)
    ;(editor.element as HTMLElement).textContent = '看下 @pl'
    await editor.trigger('input')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['看下 @pl'])
    expect(wrapper.emitted('input-text')?.at(-1)).toEqual([{ value: '看下 @pl', caret: 6 }])
  })

  it('占位文案挂在 contenteditable 上（`data-placeholder`，由 CSS 的 ::before 呈现）', () => {
    const wrapper = mountComposer()

    expect(editorOf(wrapper).attributes('data-placeholder')).toBe(
      '输入消息：打 @ 可引用文件，打 / 可选择技能',
    )
    expect(wrapper.find('.composer__hint').text()).toBe('Enter 发送 · Shift + Enter 换行')
  })

  it('Enter 发送；Shift + Enter 换行（换行以 `\\n` 落进草稿）', async () => {
    const wrapper = mountComposer({ modelValue: '你好' })

    await editorOf(wrapper).trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('send')?.at(-1)).toEqual([
      { content: '你好', attachments: [], skill: null },
    ])

    await editorOf(wrapper).trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['你好\n'])
  })
})

describe('Composer —— mention 插槽', () => {
  it('向外提供输入区锚点（面板据此紧贴光标定位）', async () => {
    const wrapper = mountComposer(
      {},
      { mention: '<div class="probe">{{ anchor ? anchor.tagName : "none" }}</div>' },
    )
    await nextTick() // 模板 ref 在挂载后才落到插槽

    expect(wrapper.find('.probe').text()).toBe('DIV')
    expect(editorOf(wrapper).attributes('contenteditable')).toBe('true')
  })

  it('面板展开时方向键被拦截并上抛（面板本体不在输入框内）', async () => {
    const wrapper = mountComposer({ mentionOpen: true })

    await editorOf(wrapper).trigger('keydown', { key: 'ArrowDown' })

    expect(wrapper.emitted('mention-key')).toEqual([['ArrowDown']])
  })

  it('面板未展开时不上抛按键（输入框照常移动光标）', async () => {
    const wrapper = mountComposer()

    await editorOf(wrapper).trigger('keydown', { key: 'ArrowDown' })

    expect(wrapper.emitted('mention-key')).toBeUndefined()
  })
})

describe('Composer —— `/技能名` 胶囊（2026-11-07）', () => {
  const SKILL = 'supplier-query'

  it('选中的技能落成与引用同款的胶囊，文本是 `/技能名`', () => {
    const wrapper = mountComposer({
      modelValue: `/${SKILL} 查一下 S-1024 的账期`,
      skill: SKILL,
    })

    const chip = wrapper.find(`[data-skill-name="${SKILL}"]`)
    expect(chip.exists()).toBe(true)
    expect(chip.text()).toBe(`/${SKILL}`)
    expect(chip.attributes('contenteditable')).toBe('false')
    expect(chip.find('.composer__mention-remove').attributes('aria-label')).toBe(
      `移除技能 ${SKILL}`,
    )
  })

  it('点 x：上报 remove-skill，并把去掉标记后的草稿交回上层', async () => {
    const wrapper = mountComposer({
      modelValue: `/${SKILL} 查一下 S-1024 的账期`,
      skill: SKILL,
    })

    await wrapper.find(`[data-skill-name="${SKILL}"] .composer__mention-remove`).trigger('click')

    expect(wrapper.emitted('remove-skill')).toEqual([[]])
    const text = (wrapper.emitted('update:modelValue')?.at(-1)?.[0] ?? '') as string
    expect(text).not.toContain(`/${SKILL}`)
    expect(text).toContain('查一下 S-1024 的账期')
  })

  it('发送载荷携带 skill（正文仍含标记，由上层剥离）', async () => {
    const wrapper = mountComposer({
      modelValue: `/${SKILL} 查一下`,
      skill: SKILL,
    })

    await editorOf(wrapper).trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('send')?.at(-1)).toEqual([
      { content: `/${SKILL} 查一下`, attachments: [], skill: SKILL },
    ])
  })

  it('只选技能不写正文：发送按钮置灰（与服务端 content 非空同口径）', () => {
    const wrapper = mountComposer({ modelValue: `/${SKILL} `, skill: SKILL })
    const buttons = wrapper.findAll('button')
    const send = buttons.find((button) => button.text() === '发送')

    expect(send?.attributes('disabled')).toBeDefined()
  })
})

/**
 * 2026-11-17：粘贴上传的**输入侧**出口。
 *
 * 输入区只负责"把剪贴板里的文件捞出来交给上层"，校验与上传都在 `useUploadPanel`——
 * 因此这里只钉两件事：①有文件时不把内容当文本塞进正文、并阻止默认粘贴；
 * ②纯文字粘贴的既有行为一字不变。
 */
describe('Composer —— 粘贴文件（2026-11-17）', () => {
  /** jsdom 没有真实剪贴板：手工造一个带 `items` 的粘贴事件 */
  function pasteEvent(files: File[], text = ''): Event {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: files.map((file) => ({ kind: 'file', getAsFile: () => file })),
        files,
        getData: (type: string) => (type === 'text/plain' ? text : ''),
      },
    })
    return event
  }

  function png(name: string): File {
    return new File([new Uint8Array(4)], name, { type: 'image/png' })
  }

  it('粘贴图片：上报文件、阻止默认粘贴、正文不插入任何文本', async () => {
    const wrapper = mountComposer()
    const editor = wrapper.find('.composer__input')

    const event = pasteEvent([png('screenshot.png')])
    editor.element.dispatchEvent(event)
    await nextTick()

    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.emitted('paste-files')).toHaveLength(1)
    expect((wrapper.emitted('paste-files')![0]![0] as File[])[0]!.name).toBe('screenshot.png')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('没有扩展名的截图：发出前补好名字（否则会被"格式不支持"拒掉）', async () => {
    const wrapper = mountComposer()

    wrapper.find('.composer__input').element.dispatchEvent(pasteEvent([png('blob')]))
    await nextTick()

    const files = wrapper.emitted('paste-files')![0]![0] as File[]
    expect(files[0]!.name).toMatch(/^粘贴-\d+-1\.png$/)
  })

  it('图文混贴：只处理文件，不把文字也插进正文', async () => {
    const wrapper = mountComposer()

    wrapper.find('.composer__input').element.dispatchEvent(
      pasteEvent([png('a.png')], '一段被复制的文字'),
    )
    await nextTick()

    expect(wrapper.emitted('paste-files')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('纯文本粘贴：行为不变（仍按纯文本插入，不上报文件）', async () => {
    const wrapper = mountComposer()

    wrapper.find('.composer__input').element.dispatchEvent(pasteEvent([], '纯文字'))
    await nextTick()

    expect(wrapper.emitted('paste-files')).toBeUndefined()
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual(['纯文字'])
  })

  it('发送中（disabled）：不处理粘贴文件', async () => {
    const wrapper = mountComposer({ disabled: true })

    wrapper.find('.composer__input').element.dispatchEvent(pasteEvent([png('a.png')]))
    await nextTick()

    expect(wrapper.emitted('paste-files')).toBeUndefined()
  })
})
