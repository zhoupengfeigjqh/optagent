/**
 * 配置回归：开发期登录链路（2026-11-18 故障）。
 *
 * 故障现象：管理员在管理台重置了密码，聊天前台仍然登录不进去。
 * 根因：`vite.config.ts` 只配了 `'/api' → 3000`（运行侧），于是
 * `POST /api/admin/auth/login` 被送到 `agent-backend`，其全局鉴权钩子在
 * 白名单外一律要求 Cookie ⇒ 未登录的登录请求被直接拒成
 * `401 UNAUTHENTICATED`，与密码对不对毫无关系。
 *
 * 这类 bug 没有可断言的运行期 seam（它只在 dev server 的代理表里），
 * 因此这里直接对配置文本断言两条不可退让的性质：
 * ① `/api/admin` 必须先于 `/api` 声明（Vite 按声明顺序匹配）；
 * ② 该条转发目标必须是管理服务 3001。
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// jsdom 环境下 `import.meta.url` 不是 file: 协议，故按 Vitest 的工作目录（frontend/）定位
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
