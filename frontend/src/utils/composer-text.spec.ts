import { describe, expect, it } from 'vitest'

import {
  MENTION_FILENAME_ATTR,
  caretTextOffset,
  serializeComposerText,
  splitComposerSegments,
} from './composer-text'

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

  it('技能胶囊还原为 `/技能名` 标记（2026-11-07）', () => {
    const html =
      '<span contenteditable="false" data-skill-name="supplier-query">/supplier-query' +
      '<button aria-label="移除技能 supplier-query"></button></span> 查一下'
    expect(serializeComposerText(editor(html))).toBe('/supplier-query 查一下')
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

  it('技能标记落成 skill 段，与 mention 段各自独立（2026-11-07）', () => {
    expect(
      splitComposerSegments('/supplier-query 查一下 @plan.csv 的账期', ['@plan.csv'], ['/supplier-query']),
    ).toEqual([
      { kind: 'skill', token: '/supplier-query' },
      { kind: 'text', text: ' 查一下 ' },
      { kind: 'mention', token: '@plan.csv' },
      { kind: 'text', text: ' 的账期' },
    ])
  })

  it('技能标记缺省时行为与只有 `@` 时逐字一致（存量调用点不受影响）', () => {
    expect(splitComposerSegments('看下 @plan.csv', ['@plan.csv'])).toEqual(
      splitComposerSegments('看下 @plan.csv', ['@plan.csv'], []),
    )
  })
})

describe('caretTextOffset —— 光标下标与序列化同一把尺子', () => {
  it('无选区时回退为文末', () => {
    const root = editor('看下 产能')

    expect(caretTextOffset(root, null)).toBe(5)
  })

  it('光标落在胶囊之后时，胶囊按 `@文件名` 计入长度', () => {
    const root = editor(`看下 ${chip('plan.csv')} 的数据`)
    document.body.appendChild(root)
    const chipNode = root.querySelector('span')!
    const range = document.createRange()
    range.setStartAfter(chipNode)
    range.collapse(true)

    expect(caretTextOffset(root, selectionWith(range))).toBe('看下 @plan.csv'.length)
    root.remove()
  })
})

function selectionWith(range: Range): Selection {
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}
