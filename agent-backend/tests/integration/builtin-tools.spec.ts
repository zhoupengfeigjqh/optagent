/**
 * 集成测试：内置工具目录端点（T042，`plan.md` R2 / `contracts/runtime-api-delta.md` §2）
 *
 * 覆盖：
 * - 结构合法、`total = 6`、字段齐备（`FR-011`）；含 2026-09-23 新增的 `read_skill`
 * - `description_template` **保持占位符形态**，未被替换为具体用户/会话取值
 *   （`FR-012`、`SC-014`：模板中出现的具体用户目录名或会话标识数量 MUST 为 0）
 * - 只读、无副作用
 *
 * 运行方式（本地执行）：
 *   npm run test:integration
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadConfig } from '../../src/config'
import { buildServer } from '../../src/server'

const root = mkdtempSync(path.join(tmpdir(), 'optagent-builtin-tools-'))

interface ToolItem {
  name: string
  label: string
  description_template: string
  parameters: Record<string, unknown>
  writable: boolean
}

let app: FastifyInstance

beforeAll(async () => {
  mkdirSync(path.join(root, 'users', 'admin'), { recursive: true })
  const configPath = path.join(root, 'config.yaml')
  writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8')
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

describe('GET /api/builtin-tools', () => {
  it('返回可枚举目录：6 项、字段齐备、total 一致', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/builtin-tools' })

    expect(res.statusCode).toBe(200)
    const body = res.json() as { items: ToolItem[]; total: number }
    expect(body.total).toBe(6)
    expect(body.items).toHaveLength(6)
    // 2026-09-23 新增：技能文件读取（此前 SKILL 正文无任何读取通道）
    expect(body.items.map((i) => i.name)).toContain('read_skill')
    for (const item of body.items) {
      expect(typeof item.name).toBe('string')
      expect(typeof item.label).toBe('string')
      expect(typeof item.description_template).toBe('string')
      expect(typeof item.writable).toBe('boolean')
      expect(item.parameters).toHaveProperty('type', 'object')
    }
  })

  it('writable 仅 write_file 为 true', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/builtin-tools' })
    const body = res.json() as { items: ToolItem[] }
    expect(body.items.filter((i) => i.writable).map((i) => i.name)).toEqual(['write_file'])
  })

  it('description_template 保持占位符形态，未被替换为具体取值（FR-012 / SC-014）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/builtin-tools' })
    const body = res.json() as { items: ToolItem[] }
    const byName = new Map(body.items.map((i) => [i.name, i]))

    // 占位符仍在
    expect(byName.get('read_file')?.description_template).toContain('{示例路径}')
    expect(byName.get('list_dir')?.description_template).toContain('{可用目录}')
    expect(byName.get('write_file')?.description_template).toContain('{会话标识}')

    // 未出现任何具体用户目录名或会话标识（本测试未创建任何数字人/会话）
    const all = body.items.map((i) => `${i.description_template}${JSON.stringify(i.parameters)}`).join('\n')
    expect(all).not.toContain('示例.csv"')
    expect(all).not.toContain('admin')
    expect(all).not.toMatch(/\/示例\.csv/)
  })

  it('入参说明中的占位符同样未被替换', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/builtin-tools' })
    const body = res.json() as { items: ToolItem[] }
    const readFile = body.items.find((i) => i.name === 'read_file')!
    expect(JSON.stringify(readFile.parameters)).toContain('{示例路径}')
  })

  it('无副作用：连续两次调用结果一致（只读端点）', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/builtin-tools' })
    const second = await app.inject({ method: 'GET', url: '/api/builtin-tools' })
    expect(second.json()).toEqual(first.json())
  })
})
