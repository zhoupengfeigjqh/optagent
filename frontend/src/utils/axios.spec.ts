import { afterEach, describe, expect, it, vi } from 'vitest'

// 首次 `import('ant-design-vue')` 需数秒（全量套件并行时超过 vitest 默认 5s 上限），
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
