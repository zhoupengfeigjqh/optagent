/**
 * 文件空间路由集成测试：场景（scenario.json）随数字人存放
 *
 * 运行方式（本地执行；容器只负责部署，见宪章原则三 / 原则八）：
 *   npm run test:all           # 全部测试
 *   npm run test:integration   # 仅集成测试
 *
 * 覆盖本次变更对**端点行为**的影响（单测只覆盖了 dirs 的纯逻辑，端点层需在此验证）：
 * - 未选中数字人 → `/api/files/*` 返回 409 AGENT_NOT_SELECTED
 * - 目录合法性按「当前选中数字人」的场景清单判定：同一目录在 alpha 下 200、在 beta 下 403
 * - `/api/files/workspace` 返回的场景名与目录清单随当前选中数字人变化
 * - 数字人未配置场景 → 503 SCENARIO_NOT_CONFIGURED，且文案指名该数字人
 *
 * 说明：`tests/` 不在 tsconfig 的 include 内（不参与构建），此处用无扩展名导入，
 * 由 Vitest 解析到 `src/*`。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadConfig } from '../../src/config'
import { buildServer } from '../../src/server'

const root = mkdtempSync(path.join(tmpdir(), 'optagent-files-'))
const userId = 'admin'

/** 数字人 fixture：alpha 可见两个目录，beta 只可见其中一个，gamma 完全没有场景 */
const AGENT_SCENARIOS: Record<string, unknown | null> = {
  alpha: { scenario: '全量', data_prep_dirs: ['生产计划', '产线电价'] },
  beta: { scenario: '精简', data_prep_dirs: ['产线电价'] },
  gamma: null,
}

/** 写入一个可被 loadAgentConfig 接受的数字人目录；scenario 为 null 时不写场景文件 */
function writeAgent(name: string, scenario: unknown | null): void {
  const dir = path.join(root, 'users', userId, 'agents', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'SOUL.md'), `你是 ${name}。\n`, 'utf8')
  writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8')
  writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8')
  if (scenario !== null) {
    writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify(scenario), 'utf8')
  }
}

let app: FastifyInstance

beforeAll(async () => {
  for (const [name, scenario] of Object.entries(AGENT_SCENARIOS)) writeAgent(name, scenario)

  const configPath = path.join(root, 'config.yaml')
  writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8')

  // PUBLIC_BASE_URL 为必填项；OPT_AGENT_ROOT 指向本次临时数据根
  const config = loadConfig({
    env: { PUBLIC_BASE_URL: 'http://backend:3000', OPT_AGENT_ROOT: root },
    configPath,
  })
  app = await buildServer({ config })
})

afterAll(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

/** 选中数字人（端点本身在 agents 路由中被独立覆盖，此处作为前置步骤） */
async function select(name: string): Promise<void> {
  const res = await app.inject({ method: 'POST', url: `/api/agents/${name}/select` })
  expect(res.statusCode).toBe(200)
}

/** 清除选中态，保证用例从"未选中"开始 */
async function deselect(): Promise<void> {
  await app.inject({ method: 'POST', url: '/api/agents/current/exit' })
}

function listUrl(dir: string): string {
  return `/api/files/list?dir=${encodeURIComponent(dir)}`
}

/** 取 workspace 响应中「数据准备」空间下的目录清单 */
function prepDirs(body: unknown): string[] {
  const spaces = (body as { spaces: Array<{ name: string; dirs: Array<{ dir: string }> }> }).spaces
  const prep = spaces.find((space) => space.name === '数据准备')
  return (prep?.dirs ?? []).map((dir) => dir.dir)
}

describe('文件空间视角＝当前选中数字人', () => {
  it('未选中数字人时 workspace → 409 AGENT_NOT_SELECTED', async () => {
    await deselect()

    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: { code: 'AGENT_NOT_SELECTED' } })
  })

  it('未选中数字人时列目录 → 409 AGENT_NOT_SELECTED', async () => {
    await deselect()

    const res = await app.inject({ method: 'GET', url: listUrl('共享空间') })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: { code: 'AGENT_NOT_SELECTED' } })
  })

  it('选中 alpha 后 workspace 返回 alpha 的场景与目录清单', async () => {
    await select('alpha')

    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' })

    expect(res.statusCode).toBe(200)
    expect((res.json() as { scenario: string }).scenario).toBe('全量')
    expect(prepDirs(res.json())).toEqual(['数据准备/生产计划', '数据准备/产线电价'])
  })

  it('切换到 beta 后同一端点返回 beta 的清单（视角随选中变化）', async () => {
    await select('beta')

    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' })

    expect(res.statusCode).toBe(200)
    expect((res.json() as { scenario: string }).scenario).toBe('精简')
    expect(prepDirs(res.json())).toEqual(['数据准备/产线电价'])
  })

  it('同一目录在 alpha 下可列（200），在 beta 下清单外（403）', async () => {
    await select('alpha')
    const allowed = await app.inject({ method: 'GET', url: listUrl('数据准备/生产计划') })
    expect(allowed.statusCode).toBe(200)

    await select('beta')
    const denied = await app.inject({ method: 'GET', url: listUrl('数据准备/生产计划') })
    expect(denied.statusCode).toBe(403)
    expect(denied.json()).toMatchObject({ error: { code: 'UPLOAD_DIR_FORBIDDEN' } })
  })

  it('共享空间不受场景清单限制（beta 下照样可列）', async () => {
    await select('beta')

    const res = await app.inject({ method: 'GET', url: listUrl('共享空间') })

    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json())).toBe(true)
  })

  it('数字人未配置场景 → 503 SCENARIO_NOT_CONFIGURED，且文案指名该数字人', async () => {
    await select('gamma')

    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' })

    expect(res.statusCode).toBe(503)
    const body = res.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe('SCENARIO_NOT_CONFIGURED')
    expect(body.error.message).toContain('gamma')
  })
})
