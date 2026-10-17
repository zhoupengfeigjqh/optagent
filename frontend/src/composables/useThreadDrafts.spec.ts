/**
 * 单元测试：按会话分桶的草稿（2026-10-16，拆分产出）。
 *
 * 钉三件事：切换会话"存旧取新"、空串与 `null` 会话**不留桶**（否则首条消息发送后会冒出
 * 幽灵草稿）、桶上限淘汰最久未用的那一个。
 */
import { ref } from 'vue'
import { describe, expect, it } from 'vitest'

import { DRAFT_BUCKETS_LIMIT, useThreadDrafts } from './useThreadDrafts'

describe('useThreadDrafts —— 存旧取新（2026-10-16）', () => {
  it('存进 A 的草稿不会出现在 B，切回 A 仍在', () => {
    const draft = ref('')
    const drafts = useThreadDrafts(draft)

    draft.value = '半句'
    drafts.stash('th_a')
    expect(drafts.take('th_b')).toBe('')
    expect(drafts.take('th_a')).toBe('半句')
  })

  it('空串不留桶：切走再切回是干净的，不出现"上次删空的草稿"', () => {
    const draft = ref('')
    const drafts = useThreadDrafts(draft)

    drafts.stash('th_a')

    expect(drafts.take('th_a')).toBe('')
  })

  it('视图态新对话（null）既不建桶也取不到草稿', () => {
    const draft = ref('写在视图态里的话')
    const drafts = useThreadDrafts(draft)

    drafts.stash(null)

    expect(drafts.take(null)).toBe('')
  })

  it('同一会话反复存：后来的内容覆盖前面的（先删后塞，不产生重复项）', () => {
    const draft = ref('第一版')
    const drafts = useThreadDrafts(draft, 2)

    drafts.stash('th_a')
    draft.value = '第二版'
    drafts.stash('th_a')

    expect(drafts.take('th_a')).toBe('第二版')
  })

  it('超出上限时淘汰最久未用的桶（容量 2：th_a 先被挤掉）', () => {
    const draft = ref('')
    const drafts = useThreadDrafts(draft, 2)

    for (const id of ['th_a', 'th_b', 'th_c']) {
      draft.value = `草稿-${id}`
      drafts.stash(id)
    }

    expect(drafts.take('th_a')).toBe('')
    expect(drafts.take('th_b')).toBe('草稿-th_b')
    expect(drafts.take('th_c')).toBe('草稿-th_c')
  })

  it('默认上限为 50（与滚动位置记忆同口径，防止无界增长）', () => {
    expect(DRAFT_BUCKETS_LIMIT).toBe(50)
  })
})
