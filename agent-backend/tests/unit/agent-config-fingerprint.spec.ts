/**
 * 单元测试：数字人配置"变化即失效"（T130，`plan.md` R7 / `runtime-api-delta.md` §8.4）
 *
 * 守住三条不变式：
 * ①配置目录被改动后，**下一次取用 MUST 返回新实例**（内容与磁盘一致）；
 * ②配置**未**变化时 MUST 命中同一实例（池化收益不被破坏）；
 * ③`activeThreads > 0` 的实例 MUST NOT 因指纹变化被立即销毁（不中断进行中的轮次）。
 *
 * 说明：本文件放在 `tests/unit/`（任务约定），但它走的是**真实装配**
 * （`buildServer` + `ctx.getOrCreateAgent`），因为要守住的正是"取用时机"这一行为。
 * 测试不触碰 LLM：`AgentInstanceFactory.create()` 不调用 provider，
 * 只有 `run()` 才需要——本用例不发起 run。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadConfig } from '../../src/config'
import type { AppContext } from '../../src/context'
import { computeConfigFingerprint } from '../../src/domain/config-fingerprint'
import type { ChatAgent } from '../../src/infra/agent-factory'
import { buildServer } from '../../src/server'

const root = mkdtempSync(path.join(tmpdir(), 'optagent-fingerprint-'))
const userId = 'admin'
const agentName = 'demo'
const agentDir = path.join(root, 'users', userId, 'agents', agentName)

const KEY = { userId, agentName }

function writeAgent(soul: string): void {
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(path.join(agentDir, 'SOUL.md'), soul, 'utf8')
  writeFileSync(path.join(agentDir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8')
  writeFileSync(path.join(agentDir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8')
  writeFileSync(
    path.join(agentDir, 'scenario.json'),
    JSON.stringify({ scenario: '生产', data_prep_dirs: ['生产计划'] }),
    'utf8',
  )
}

let app: FastifyInstance
let ctx: AppContext

beforeAll(async () => {
  writeAgent('你是 demo。\n')
  const configPath = path.join(root, 'config.yaml')
  writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8')
  const config = loadConfig({
    env: { PUBLIC_BASE_URL: 'http://backend:3000', OPT_AGENT_ROOT: root },
    configPath,
  })
  app = await buildServer({ config })
  ctx = (app as unknown as { ctx: AppContext }).ctx
})

afterAll(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

describe('computeConfigFingerprint', () => {
  it('内容变化（含大小变化）即产生不同指纹', () => {
    const before = computeConfigFingerprint(agentDir)
    writeFileSync(path.join(agentDir, 'SOUL.md'), '你是 demo（第二版）。\n', 'utf8')
    expect(computeConfigFingerprint(agentDir)).not.toBe(before)
    writeFileSync(path.join(agentDir, 'SOUL.md'), '你是 demo。\n', 'utf8')
  })

  it('同样内容重复计算稳定（不随时间抖动）', () => {
    expect(computeConfigFingerprint(agentDir)).toBe(computeConfigFingerprint(agentDir))
  })

  it('目录不存在时仍返回稳定指纹（不抛错）', () => {
    const missing = path.join(root, 'users', 'nobody', 'agents', 'ghost')
    expect(computeConfigFingerprint(missing)).toBe(computeConfigFingerprint(missing))
  })

  it('关键位置被目录占据时按 `not-a-file` 计入指纹（不抛错、也不当成"内容相同"）', () => {
    const odd = path.join(root, 'users', 'odd', 'agents', 'weird')
    mkdirSync(path.join(odd, 'SOUL.md'), { recursive: true })
    mkdirSync(path.join(odd, 'skills'), { recursive: true })

    const fingerprint = computeConfigFingerprint(odd)
    expect(fingerprint).toMatch(/^[0-9a-f]{40}$/)

    // 目录内容变化（新增一个文件）后指纹随之变化
    writeFileSync(path.join(odd, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8')
    expect(computeConfigFingerprint(odd)).not.toBe(fingerprint)
  })

  it('skills 位置被普通文件占据时安全跳过（不抛错）', () => {
    const odd = path.join(root, 'users', 'odd2', 'agents', 'weird2')
    mkdirSync(odd, { recursive: true })
    writeFileSync(path.join(odd, 'skills'), 'not-a-dir', 'utf8')
    expect(() => computeConfigFingerprint(odd)).not.toThrow()
  })
})

describe('不变式 ②：配置未变化 → 命中同一实例', () => {
  it('连续两次取用返回同一个实例对象', async () => {
    const first = (await ctx.getOrCreateAgent(KEY)) as unknown as ChatAgent
    const second = (await ctx.getOrCreateAgent(KEY)) as unknown as ChatAgent
    expect(second).toBe(first)
    expect(second.configFingerprint).toBe(first.configFingerprint)
  })
})

describe('不变式 ①：配置改动 → 下一次取用返回新实例且内容与磁盘一致', () => {
  it('改动 SOUL.md 后取用得到新实例，systemPrompt 与磁盘一致', async () => {
    const before = (await ctx.getOrCreateAgent(KEY)) as unknown as ChatAgent

    writeFileSync(path.join(agentDir, 'SOUL.md'), '你是 demo（部署新版）。\n', 'utf8')

    const after = (await ctx.getOrCreateAgent(KEY)) as unknown as ChatAgent
    expect(after).not.toBe(before)
    expect(after.config.systemPrompt).toContain('部署新版')
    expect(ctx.pool.get(KEY)).toBe(after)
  })

  it('技能目录内容变化同样触发换代（不只看四个配置文件）', async () => {
    const before = (await ctx.getOrCreateAgent(KEY)) as unknown as ChatAgent

    const skillDir = path.join(agentDir, 'skills', 'pdf-parse')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: pdf-parse\ndescription: 解析 PDF\n---\n\n正文\n',
      'utf8',
    )

    const after = (await ctx.getOrCreateAgent(KEY)) as unknown as ChatAgent
    expect(after).not.toBe(before)
    expect(after.config.skills.map((s) => s.name)).toContain('pdf-parse')
  })
})

describe('不变式 ③：activeThreads > 0 的实例不因指纹变化被立即销毁', () => {
  it('有在途轮次时换代：新实例已生效，旧实例未被销毁；轮次结束后被回收', async () => {
    const stale = (await ctx.getOrCreateAgent(KEY)) as unknown as ChatAgent
    // 模拟"该实例上有一个进行中的轮次"
    stale.activeThreads = 1

    let staleDisposed = false
    const originalDispose = stale.dispose.bind(stale)
    stale.dispose = async () => {
      staleDisposed = true
      await originalDispose()
    }

    writeFileSync(path.join(agentDir, 'SOUL.md'), '你是 demo（换代中的新版）。\n', 'utf8')
    const fresh = (await ctx.getOrCreateAgent(KEY)) as unknown as ChatAgent

    // 新对话立即用上新配置
    expect(fresh).not.toBe(stale)
    expect(fresh.config.systemPrompt).toContain('换代中的新版')
    // 进行中的轮次不被打断 → 旧实例未被销毁
    expect(staleDisposed).toBe(false)
    expect(ctx.pool.retiredCount()).toBe(1)

    // 轮次结束后回收
    stale.activeThreads = 0
    expect(ctx.pool.sweepRetired()).toBe(1)
    expect(staleDisposed).toBe(true)
    expect(ctx.pool.retiredCount()).toBe(0)
  })

  it('空闲实例被换代时立即销毁（无需等轮次结束）', async () => {
    const idle = (await ctx.getOrCreateAgent(KEY)) as unknown as ChatAgent
    expect(idle.activeThreads).toBe(0)

    let disposed = false
    const originalDispose = idle.dispose.bind(idle)
    idle.dispose = async () => {
      disposed = true
      await originalDispose()
    }

    writeFileSync(path.join(agentDir, 'SOUL.md'), '你是 demo（空闲换代）。\n', 'utf8')
    await ctx.getOrCreateAgent(KEY)

    expect(disposed).toBe(true)
    expect(ctx.pool.retiredCount()).toBe(0)
  })
})
