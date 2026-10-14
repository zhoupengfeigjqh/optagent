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
          },
          {
            dir: '数据准备/算法规则',
            label: '算法规则',
            deletable: false,
            files: [],
            fields: [],
            upload_extensions: ['.csv', '.xlsx'],
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
