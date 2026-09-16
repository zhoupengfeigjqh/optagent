/**
 * config 模块单测
 *
 * 运行方式（本地执行；容器只负责部署，见宪章原则三 / 原则八）：
 *   npm run test:all   # 全部测试
 *   npm run test       # 仅本目录单测
 *
 * 覆盖本次变更的核心约束：`PUBLIC_BASE_URL` 必须显式声明（缺失即拒绝启动），
 * 且不再回落到 `http://localhost:PORT` 兜底——容器里该兜底会让 MCP 服务回源打到自己。
 *
 * 说明：`tests/` 不在 tsconfig 的 include 内（不参与构建），此处用无扩展名导入，
 * 由 Vitest 解析到 `src/config.ts`。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { ConfigError, loadConfig } from '../../src/config'

/** 临时 config.yaml：自带字面量 api_key，使测试不依赖任何环境变量 */
const workDir = mkdtempSync(path.join(tmpdir(), 'optagent-config-'))
const configPath = path.join(workDir, 'config.yaml')
writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8')

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

/** 执行 loadConfig 并返回抛出的错误；未抛错时返回 `null` */
function loadError(env: Record<string, string | undefined>): unknown {
  try {
    loadConfig({ env, configPath })
    return null
  } catch (error) {
    return error
  }
}

/** 必填项齐备的最小环境 */
const okEnv = { PUBLIC_BASE_URL: 'http://backend:3000' }

describe('loadConfig - PUBLIC_BASE_URL 必填', () => {
  it('缺失时拒绝启动，且报错文案指名该变量', () => {
    const error = loadError({})

    expect(error).toBeInstanceOf(ConfigError)
    expect((error as Error).message).toContain('PUBLIC_BASE_URL')
  })

  it('不是合法 URL 时拒绝启动', () => {
    expect(loadError({ PUBLIC_BASE_URL: 'not a url' })).toBeInstanceOf(ConfigError)
  })

  it('缺少 http/https 协议头时拒绝启动（url() 会误判 backend:3000 为合法）', () => {
    const error = loadError({ PUBLIC_BASE_URL: 'backend:3000' })

    expect(error).toBeInstanceOf(ConfigError)
    expect((error as Error).message).toContain('http://')
  })

  it('显式声明时原样落到 publicBaseUrl，不做 localhost 兜底', () => {
    const config = loadConfig({ env: okEnv, configPath })

    expect(config.publicBaseUrl).toBe('http://backend:3000')
  })
})

describe('loadConfig - 缺省值', () => {
  it('PORT 缺省 3000，OPT_AGENT_ROOT 解析为绝对路径', () => {
    const config = loadConfig({ env: okEnv, configPath })

    expect(config.port).toBe(3000)
    expect(path.isAbsolute(config.optAgentRoot)).toBe(true)
  })

  it('未配置 FILE_SIGN_SECRET 时随机生成（≥16 字符）', () => {
    const config = loadConfig({ env: okEnv, configPath })

    expect(config.fileSignSecret.length).toBeGreaterThanOrEqual(16)
  })

  it('配置 FILE_SIGN_SECRET 时原样采用（跨重启签名可复现的前提）', () => {
    const secret = 'a'.repeat(32)
    const config = loadConfig({ env: { ...okEnv, FILE_SIGN_SECRET: secret }, configPath })

    expect(config.fileSignSecret).toBe(secret)
  })
})
