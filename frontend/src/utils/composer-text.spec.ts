/**
 * 单元测试：输入区 DOM ↔ 文本的唯一换算（2026-10-18）。
 *
 * 这一层被三处依赖——草稿同步、`@` 触发检测、`caretRectOf` 的定位口径——
 * 所以哪怕只有一处的换行/胶囊规则不一致，都会表现为"看到的和发出去的不一样"。
 */
import { describe, expect, it } from 'vitest'

import {
  MENTION_FILENAME_ATTR,
  caretTextOffset,
  serializeComposerText,
  splitComposerSegments,
} from './composer-text'

/** 造一个输入区容器（与 Composer 的 `.composer__input` 同构的最小 DOM）。 */
function editor(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  return root
}

function chip(filename: string): string {
  return `<span contenteditable="false" ${MENTION_FILENAME_ATTR}="${filename}">@${filename}<button aria-label="移除引用 ${filename}"></button></span>`
}

describe('serializeComposerText —— DOM 转草稿文本', () => {
  it('文本节点原样拼接', () => {
    expect(serializeComposerText(editor('看下 产能'))).toBe('看下 产能')
  })

  it('`<br>` 还原为换行', () => {
    expect(serializeComposerText(editor('第一行<br>第二行'))).toBe('第一行\n第二行')
  })

  it('胶囊还原为 `@文件名` 标记，按钮不参与（不能把 aria-label 带进去）', () => {
    expect(serializeComposerText(editor(`看下 ${chip('plan.csv')} 的数据`))).toBe(
      '看下 @plan.csv 的数据',
    )
  })

  it('块级包裹（浏览器兜底路径）按行补换行', () => {
    expect(serializeComposerText(editor('<div>甲</div><div>乙</div>'))).toBe('甲\n乙\n')
  })
})

describe('splitComposerSegments —— 按标记切段', () => {
  it('标记落成 mention 段，其余为文本段', () => {
    expect(splitComposerSegments('看下 @plan.csv 的数据', ['@plan.csv'])).toEqual([
      { kind: 'text', text: '看下 ' },
      { kind: 'mention', token: '@plan.csv' },
      { kind: 'text', text: ' 的数据' },
    ])
  })

  it('长标记优先：`@a.csv.bak` 不会被 `@a.csv` 吃掉一半', () => {
    expect(splitComposerSegments('@a.csv.bak', ['@a.csv', '@a.csv.bak'])).toEqual([
      { kind: 'mention', token: '@a.csv.bak' },
    ])
  })

  it('没有标记时整段返回；空文本返回空段列表', () => {
    expect(splitComposerSegments('纯文本', [])).toEqual([{ kind: 'text', text: '纯文本' }])
    expect(splitComposerSegments('', ['@plan.csv'])).toEqual([])
  })
})

describe('caretTextOffset —— 光标下标与序列化同一把尺子', () => {
  it('无选区时回退为文末', () => {
    const root = editor('看下 产能')

    expect(caretTextOffset(root, null)).toBe(5)
  })

  it('光标落在胶囊之后时，胶囊按 `@文件名` 计入长度', () => {
    const root = editor(`看下 ${chip('plan.csv')} 的数据`)
    // 选区只认文档内的节点：游离节点上的 addRange 会被忽略
    document.body.appendChild(root)
    const chipNode = root.querySelector('span')!
    const range = document.createRange()
    range.setStartAfter(chipNode)
    range.collapse(true)

    expect(caretTextOffset(root, selectionWith(range))).toBe('看下 @plan.csv'.length)
    root.remove()
  })
})

/** 构造只含一个选区的 Selection（jsdom 的 `document.getSelection()` 也能用，但显式给更稳）。 */
function selectionWith(range: Range): Selection {
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}
