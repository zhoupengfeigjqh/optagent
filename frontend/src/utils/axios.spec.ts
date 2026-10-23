/**
 * 单元测试：排产数据服务的 axios 实例（2026-10-22，隐患修复的回归钉）。
 *
 * 钉住的是一条**契约**而非实现细节：`/dataApi` 只存在于「同源 + 网关」这条链路上
 * （开发期 vite proxy、生产期 nginx），所以该实例的 `baseURL` MUST 恒为空串，
 * MUST NOT 继承 `VITE_API_BASE_URL`。
 *
 * 修复前的缺陷：该实例读的是 `VITE_API_BASE_PREFIX`——全仓无此定义
 * （`.env.example` / `vite-env.d.ts` / `http.ts` / `useAppSession.ts` 用的都是 `..._URL`），
 * 读不到的键让 `baseURL` 退化成 `undefined`，于是"恰好表现为正确"；
 * 一旦有人照 `.env.example` 的说明把 `VITE_API_BASE_URL` 填成直连地址，
 * 排产请求就会绕过网关打到 agent-backend（跨源 + 404），且只在改环境变量时才暴露。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

// 本测试只关心 `baseURL` 的解析，与被测模块顺带引入的两条无关依赖解耦：
// 首次 `import('ant-design-vue')` 需数秒（全量套件并行时超过 vitest 默认 5s 上限），
// 且把静态资源无关的 UI 库拖进单测没有意义。
vi.mock('ant-design-vue', () => ({ message: { error: vi.fn() } }))
vi.mock('./cookie', () => ({ getToken: () => undefined }))

/** 每次重新求值模块，确保读到当前的环境变量 */
async function loadService() {
  vi.resetModules()
  const module = await import('./axios')
  return module.default
}

describe('utils/axios（/dataApi 专用实例）', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('不继承 VITE_API_BASE_URL：即便配成直连地址，baseURL 仍为空串', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://192.168.1.10:3000')

    const service = await loadService()

    expect(service.defaults.baseURL).toBe('')
  })

  it('未配置环境变量时同样为空串（同源相对路径）', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '')

    const service = await loadService()

    expect(service.defaults.baseURL).toBe('')
  })

  it('拼出的请求地址是相对路径，不带目标主机', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://192.168.1.10:3000')

    const service = await loadService()

    expect(
      service.getUri({ url: '/dataApi/target-priority-config/page', params: { pageNum: 1 } }),
    ).toBe('/dataApi/target-priority-config/page?pageNum=1')
  })
})
