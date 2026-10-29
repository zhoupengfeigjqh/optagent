/**
 * 单元测试：工作空间 composable —— **仅覆盖 2026-10-13 的改动点** `uploadExtensionsOf`。
 *
 * 按宪章原则三"随改动触达即补"：本文件只钉住"目录级白名单的查找与回落"，
 * 不为该存量模块的其余函数补测（见 plan.md §4）。
 */
import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceResponse } from '../api/types'
import { createWorkspaceStore } from './useWorkspace'

function makeResponse(): WorkspaceResponse {
  return {
    scenario: '生产计划',
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
            files: [],
            fields: [],
            upload_extensions: ['.csv', '.xlsx', '.txt'],
            predefined: false,
          },
          {
            dir: '数据准备/算法规则',
            label: '算法规则',
            deletable: false,
            files: [],
            fields: [],
            upload_extensions: ['.csv', '.xlsx'],
            predefined: false,
          },
        ],
      },
      {
        name: '共享空间',
        agent_writable: false,
        upload_extensions: ['.csv', '.xlsx', '.txt', '.pdf'],
        dirs: [
          {
            dir: '共享空间',
            label: '共享空间',
            deletable: false,
            files: [],
            fields: [],
            upload_extensions: ['.csv', '.xlsx', '.txt', '.pdf'],
            predefined: false,
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
            files: [],
            fields: [],
            upload_extensions: ['.csv', '.xlsx', '.txt'],
            predefined: false,
          },
        ],
      },
    ],
  }
}

function storeWith(response: WorkspaceResponse | null) {
  const workspace = vi.fn()
  if (response) workspace.mockResolvedValue(response)
  const store = createWorkspaceStore({
    files: { workspace },
    toast: { push: vi.fn() },
  } as never)
  return store
}

async function loadedStore() {
  const store = storeWith(makeResponse())
  await store.load()
  return store
}

describe('useWorkspace.uploadExtensionsOf（2026-10-13：粒度由空间级下放到目录级）', () => {
  it('数据准备：命中**该目录自身**的白名单（同一空间的两个目录可不同）', async () => {
    const store = await loadedStore()
    expect(store.uploadExtensionsOf('数据准备/生产计划')).toEqual(['.csv', '.xlsx', '.txt'])
    expect(store.uploadExtensionsOf('数据准备/算法规则')).toEqual(['.csv', '.xlsx'])
  })

  it('未命中（未知目录）→ 回落空数组，不抛错', async () => {
    const store = await loadedStore()
    expect(store.uploadExtensionsOf('数据准备/不存在的目录')).toEqual([])
  })

  it('加载前（spaces 为空）→ 空数组', () => {
    const store = storeWith(null)
    expect(store.uploadExtensionsOf('数据准备/生产计划')).toEqual([])
  })

  it('共享空间与临时空间：取该目录下发的空间级白名单（与改造前逐字一致）', async () => {
    const store = await loadedStore()
    expect(store.uploadExtensionsOf('共享空间')).toEqual(['.csv', '.xlsx', '.txt', '.pdf'])
    expect(store.uploadExtensionsOf('临时空间')).toEqual(['.csv', '.xlsx', '.txt'])
  })
})

/**
 * 012：`registerFile` —— 上传成功后**就地登记**，让发送前的 `exists` 立刻为真。
 *
 * 为什么需要它：`exists` 只读已加载清单，而上传成功后不会重拉 workspace；
 * 不登记就会出现"刚插入的 `@落盘名` 一发送就被判引用不存在"（FR-004）。
 * 这里**不**发起任何请求（`workspace` 接口只被 `load()` 调用一次）。
 */
describe('useWorkspace.registerFile（012 FR-004）', () => {
  it('登记后 exists 为真、filesOf 含该项（且不重拉全量）', async () => {
    const store = storeWith(makeResponse())
    const load = vi.spyOn(store, 'load')
    await store.load()

    store.registerFile({ dir: '数据准备/生产计划', filename: '报告(1).csv', size: 123 })

    expect(store.exists({ dir: '数据准备/生产计划', filename: '报告(1).csv' })).toBe(true)
    expect(store.filesOf('数据准备/生产计划')).toEqual([
      expect.objectContaining({ filename: '报告(1).csv', size: 123 }),
    ])
    // 就地登记：不为一个文件重拉整棵树（会丢滚动位置、批量时放大成 N 次请求）
    expect(load).toHaveBeenCalledTimes(1) // 仅 setup 时那一次
  })

  it('同 {dir, filename} 重复登记 ⇒ 幂等（不重复插入）', async () => {
    const store = await loadedStore()

    store.registerFile({ dir: '临时空间', filename: 'a.csv', size: 1 })
    store.registerFile({ dir: '临时空间', filename: 'a.csv', size: 1 })

    expect(store.filesOf('临时空间')).toHaveLength(1)
  })

  it('未知目录（清单未加载 / 非本数字人目录）⇒ no-op，不抛错、不制造"存在"假象', async () => {
    const store = storeWith(null)

    expect(() => store.registerFile({ dir: '临时空间', filename: 'a.csv', size: 1 })).not.toThrow()
    expect(store.exists({ dir: '临时空间', filename: 'a.csv' })).toBe(false)
  })
})
