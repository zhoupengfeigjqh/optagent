/**
 * 单测：`canSendContent` —— 能否发送的唯一判据。
 *
 * 守四条口径（2026-11-20 收敛后）：
 * ① 正文非空 → 可发；
 * ② 只选 `/技能名` 不写正文 → **不可发**（此前工具栏按钮可点、点下去只得到报错）；
 * ③ 只有引用 / 附件 → 可发（026：正文由合成话术补齐）；
 * ④ `/技能名` + 正文 → 剥离标记后仍非空 → 可发。
 */
import { describe, expect, it } from 'vitest'

import { canSendContent } from './can-send'

describe('canSendContent —— 能否发送的唯一判据', () => {
  it('① 正文非空 → 可发', () => {
    expect(canSendContent('看看华东区的交付风险', null, 0)).toBe(true)
  })

  it('① 正文只有空白 → 不可发', () => {
    expect(canSendContent('   \n  ', null, 0)).toBe(false)
    expect(canSendContent('', null, 0)).toBe(false)
  })

  it('② 只选 /技能名 不写正文 → 不可发', () => {
    expect(canSendContent('/demo ', 'demo', 0)).toBe(false)
    expect(canSendContent('/demo', 'demo', 0)).toBe(false)
  })

  it('④ /技能名 + 正文 → 剥离标记后非空 → 可发', () => {
    expect(canSendContent('/demo 查一下 S-1024 的账期', 'demo', 0)).toBe(true)
  })

  it('③ 只有引用 / 附件 → 可发', () => {
    expect(canSendContent('', null, 1)).toBe(true)
    expect(canSendContent('   ', null, 2)).toBe(true)
  })

  it('③ 只选技能但有附件 → 可发（正文由合成话术补齐）', () => {
    expect(canSendContent('/demo ', 'demo', 1)).toBe(true)
  })
})
