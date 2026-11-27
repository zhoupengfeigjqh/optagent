import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.resolve(process.cwd(), 'vite.config.ts'), 'utf8')

const adminAt = source.indexOf("'/api/admin'")
const apiAt = source.indexOf("'/api':")

describe('Vite dev proxy —— 平台接口必须转给管理服务', () => {
  it('声明了 /api/admin 这条转发', () => {
    expect(adminAt).toBeGreaterThan(-1)
    expect(apiAt).toBeGreaterThan(-1)
  })

  it('/api/admin 排在 /api 之前（否则被更宽的 /api 抢先匹配）', () => {
    expect(adminAt).toBeLessThan(apiAt)
  })

  it('/api/admin 的目标是 3001（管理服务），不是 3000（运行侧）', () => {
    const block = source.slice(adminAt, apiAt)
    expect(block).toContain('3001')
    expect(block).not.toContain('3000')
  })
})
