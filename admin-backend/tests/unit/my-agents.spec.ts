/**
 * 单元测试：工作台切换列表的判据（授权 ∩ 已部署）。
 *
 * 2026-11-27 模型收敛后，`my-agents` 不再读 grants：
 * 未部署的数字人即使已授权也不下发；未登记服务的数字人 code 为空。
 */
import { describe, expect, it } from 'vitest'

import { buildMyAgents, type MyAgentsSource } from '../../src/domain/account/my-agents.js'

const SERVICES = [
  { code: 'DH-A', name: '服务甲', platform_agent_name: '甲' },
  { code: 'DH-B', name: '服务乙', platform_agent_name: '乙' },
]

function source(patch: Partial<MyAgentsSource> = {}): MyAgentsSource {
  return {
    readAgents: () => [],
    deployedAgents: () => [],
    listServices: async () => SERVICES,
    ...patch,
  }
}

describe('buildMyAgents', () => {
  it('已授权但未部署 → 不下发（部署是唯一生效闸门）', async () => {
    const view = await buildMyAgents(
      source({ readAgents: () => ['甲'], deployedAgents: () => [] }),
      'u_1',
    )
    expect(view.items).toEqual([])
  })

  it('已授权且已部署 → 带上服务编码与名称', async () => {
    const view = await buildMyAgents(
      source({ readAgents: () => ['甲'], deployedAgents: () => ['甲'] }),
      'u_1',
    )
    expect(view.items).toEqual([
      { code: 'DH-A', name: '服务甲', platform_agent_name: '甲', status: 'approved' },
    ])
  })

  it('已部署但不在授权清单（取消关联后残留目录）→ 不下发', async () => {
    const view = await buildMyAgents(
      source({ readAgents: () => [], deployedAgents: () => ['甲', '乙'] }),
      'u_1',
    )
    expect(view.items).toEqual([])
  })

  it('未登记服务的数字人：code 为空，仍可下发（能部署但无注册链接）', async () => {
    const view = await buildMyAgents(
      source({ readAgents: () => ['丙'], deployedAgents: () => ['丙'] }),
      'u_1',
    )
    expect(view.items).toEqual([
      { code: '', name: '丙', platform_agent_name: '丙', status: 'approved' },
    ])
  })

  it('用户不存在（readAgents 返回 null）→ 空清单', async () => {
    const view = await buildMyAgents(source({ readAgents: () => null }), 'ghost')
    expect(view).toEqual({ items: [], pending: [] })
  })

  it('保持授权清单顺序，且 pending 恒为空', async () => {
    const view = await buildMyAgents(
      source({ readAgents: () => ['乙', '甲'], deployedAgents: () => ['甲', '乙'] }),
      'u_1',
    )
    expect(view.items.map((item) => item.platform_agent_name)).toEqual(['乙', '甲'])
    expect(view.pending).toEqual([])
  })
})
