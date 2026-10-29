/**
 * 单测：空数据引导状态机（014）。
 *
 * 钉住规格里最容易回归的几条：只在"切换成功"触发、关闭后不重现、切换重置、
 * 上传后自动消失、删空文件不自动重现、加载失败不弹。
 */
import { nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'

import type { WorkspaceDir, WorkspaceSpace } from '../api/types'
import { useEmptyDataHint } from './useEmptyDataHint'

function dir(name: string, files: string[] = [], predefined = false): WorkspaceDir {
  return {
    dir: `数据准备/${name}`,
    label: name,
    deletable: true,
    files: files.map((filename) => ({ filename, size: 1, updated_at: '2026-10-29T00:00:00.000Z' })),
    fields: [],
    upload_extensions: ['.csv'],
    predefined,
  }
}

function prepSpace(...dirs: WorkspaceDir[]): WorkspaceSpace {
  return { name: '数据准备', agent_writable: false, upload_extensions: ['.csv'], dirs }
}

function setup(initial: WorkspaceSpace[] = [prepSpace(dir('算法规则', [], true), dir('生产计划'))]) {
  const spaces = ref<WorkspaceSpace[]>(initial)
  const error = ref<{ code: string; message: string } | null>(null)
  const hint = useEmptyDataHint({ spaces, error })
  return { spaces, error, hint }
}

describe('useEmptyDataHint', () => {
  it('初始不展示（首次加载 / 刷新不判定）', () => {
    const { hint } = setup()

    expect(hint.visible.value).toBe(false)
  })

  it('切换数字人且非预定义目录全空 → 展示', () => {
    const { hint } = setup()

    hint.onAgentSwitched()

    expect(hint.visible.value).toBe(true)
  })

  it('清单加载失败 → 不展示（不掩盖既有错误）', () => {
    const { hint, error } = setup()
    error.value = { code: 'SCENARIO_NOT_CONFIGURED', message: '场景未配置' }

    hint.onAgentSwitched()

    expect(hint.visible.value).toBe(false)
  })

  it('关闭后展示标记生效：清单再变化也不重现', async () => {
    const { hint, spaces } = setup()
    hint.onAgentSwitched()
    hint.dismiss()

    expect(hint.visible.value).toBe(false)

    spaces.value = [prepSpace(dir('算法规则', [], true), dir('生产计划', ['计划.csv']))]
    await nextTick()
    spaces.value = [prepSpace(dir('算法规则', [], true), dir('生产计划'))]
    await nextTick()

    expect(hint.visible.value).toBe(false)
  })

  it('再次切换数字人 → 重置关闭状态并重新判定', () => {
    const { hint } = setup()
    hint.onAgentSwitched()
    hint.dismiss()

    hint.onAgentSwitched()

    expect(hint.visible.value).toBe(true)
  })

  it('上传成功后条件失效 → 自动隐藏', async () => {
    const { hint, spaces } = setup()
    hint.onAgentSwitched()
    expect(hint.visible.value).toBe(true)

    spaces.value = [prepSpace(dir('算法规则', [], true), dir('生产计划', ['计划.csv']))]
    await nextTick()

    expect(hint.visible.value).toBe(false)
  })

  it('切换到不满足条件的数字人 → 不展示', () => {
    const { hint, spaces } = setup()
    spaces.value = [prepSpace(dir('算法规则', [], true))]

    hint.onAgentSwitched()

    expect(hint.visible.value).toBe(false)
  })
})
