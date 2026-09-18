/**
 * 单元测试：各资源 API 模块（原则七：契约与前端一一映射）
 *
 * 目标是守住"请求形状"——路径、方法、查询参数、请求体字段名。
 * 后端契约变更时，这些断言会先失败，而不是等到联调才发现。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()

interface Call {
  url: string
  init: RequestInit
}

function calls(): Call[] {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    init: (init ?? {}) as RequestInit,
  }))
}

function lastCall(): Call {
  return calls()[calls().length - 1]!
}

function bodyOf(call: Call): unknown {
  return typeof call.init.body === 'string' ? JSON.parse(call.init.body) : call.init.body
}

beforeAll(() => {
  vi.stubGlobal('fetch', fetchMock)
})

beforeEach(() => {
  fetchMock.mockReset()
  // 每次调用都返回**新的** Response：Response 的 body 只能读一次
  fetchMock.mockImplementation(
    async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  )
})

describe('api/platform', () => {
  it('fetchHealth / fetchSettings / fetchRuntimeForms 走 §1.1~§1.3 路径', async () => {
    const platform = await import('./platform')
    await platform.fetchHealth()
    expect(lastCall().url).toBe('/api/admin/platform/health')

    await platform.fetchSettings()
    expect(lastCall().url).toBe('/api/admin/platform/settings')

    await platform.fetchRuntimeForms()
    expect(lastCall().url).toBe('/api/admin/platform/runtime-forms')
  })

  it('saveSettings 用 PUT 提交 target_runtime_form 与 revision（§1.4）', async () => {
    const platform = await import('./platform')
    await platform.saveSettings('host_local', 7)
    expect(lastCall().init.method).toBe('PUT')
    expect(bodyOf(lastCall())).toEqual({ target_runtime_form: 'host_local', revision: 7 })
  })
})

describe('api/agents', () => {
  it('列表 / 详情 / 新建 / 编辑 / 删除走 §5 路径', async () => {
    const agents = await import('./agents')

    await agents.listAgents(2)
    expect(lastCall().url).toBe('/api/admin/agents?page=2')

    await agents.getAgent('中文名')
    expect(lastCall().url).toBe(`/api/admin/agents/${encodeURIComponent('中文名')}`)

    await agents.createAgent({
      name: 'demo',
      soul: 'x',
      enabled_tools: [],
      mcp_services: [],
      skills: [],
      scenario: { scenario: 's', data_prep_dirs: [], data_prep_fields: {} },
    })
    expect(lastCall().init.method).toBe('POST')

    await agents.updateAgent('demo', {
      name: 'demo',
      soul: 'x',
      enabled_tools: [],
      mcp_services: [],
      skills: [],
      scenario: { scenario: 's', data_prep_dirs: [], data_prep_fields: {} },
      revision: 3,
    })
    expect(lastCall().init.method).toBe('PUT')
    expect((bodyOf(lastCall()) as { revision: number }).revision).toBe(3)

    await agents.deleteAgent('demo')
    expect(lastCall().init.method).toBe('DELETE')
  })
})

describe('api/builtin-tools', () => {
  it('按 §2.1 带 limit 查询（有界返回）', async () => {
    const tools = await import('./builtin-tools')
    await tools.listBuiltinTools(50)
    expect(lastCall().url).toBe('/api/admin/builtin-tools?limit=50')
  })
})

describe('api/mcp', () => {
  it('卡片 / 详情 / 启停 / 测试 / 日志 / 统计走 §3 路径', async () => {
    const mcp = await import('./mcp')

    await mcp.listMcpServices(1)
    expect(lastCall().url).toBe('/api/admin/mcp/services?page=1')

    await mcp.getMcpService('ocr')
    expect(lastCall().url).toBe('/api/admin/mcp/services/ocr')

    await mcp.saveMcpServiceConfig('ocr', {
      description: '',
      transport: 'http',
      endpoints: {},
      file_args: {},
      revision: 1,
    })
    expect(lastCall().init.method).toBe('PUT')

    await mcp.startMcpService('ocr')
    expect(lastCall().url).toBe('/api/admin/mcp/services/ocr/start')

    await mcp.stopMcpService('ocr')
    expect(lastCall().url).toBe('/api/admin/mcp/services/ocr/stop')

    await mcp.testMcpService('ocr')
    expect(lastCall().url).toBe('/api/admin/mcp/services/ocr/test')

    await mcp.fetchMcpLogs('ocr', 50)
    expect(lastCall().url).toBe('/api/admin/mcp/services/ocr/logs?limit=50')

    await mcp.fetchMcpStats()
    expect(lastCall().url).toBe('/api/admin/mcp/stats')
  })
})

describe('api/skills', () => {
  it('列表 / 详情 / 单文件读取 / 单文件保存 / 删除走 §4 路径', async () => {
    const skills = await import('./skills')

    await skills.listSkills(3)
    expect(lastCall().url).toBe('/api/admin/skills?page=3')

    await skills.getSkill('pdf-parse')
    expect(lastCall().url).toBe('/api/admin/skills/pdf-parse')

    await skills.fetchSkillFile('pdf-parse', 'references/手册.md')
    expect(lastCall().url).toBe('/api/admin/skills/pdf-parse/file?path=references%2F%E6%89%8B%E5%86%8C.md')

    // 2026-09-16：全部文件可编辑——保存走 PUT .../file，且**必须**带 base_hash 乐观锁
    await skills.saveSkillFile('pdf-parse', 'references/手册.md', '# 新手册\n', 'abc123')
    expect(lastCall().init.method).toBe('PUT')
    expect(lastCall().url).toBe('/api/admin/skills/pdf-parse/file')
    expect(bodyOf(lastCall())).toEqual({
      path: 'references/手册.md',
      content: '# 新手册\n',
      base_hash: 'abc123',
    })

    await skills.deleteSkill('pdf-parse')
    expect(lastCall().init.method).toBe('DELETE')
  })

  it('安装：multipart 带 file；overwrite=true 才附该字段（FR-040）', async () => {
    const skills = await import('./skills')
    const file = new File(['PK'], 'a.zip', { type: 'application/zip' })

    await skills.installSkill(file, false)
    expect(lastCall().url).toBe('/api/admin/skills/install')
    expect((bodyOf(lastCall()) as FormData).get('overwrite')).toBeNull()

    await skills.installSkill(file, true)
    expect((bodyOf(lastCall()) as FormData).get('overwrite')).toBe('true')
  })
})

describe('api/users 与 api/deploy', () => {
  it('用户：列表默认带 expand=summary（部署前核对总账，FR-023）', async () => {
    const users = await import('./users')

    await users.listUsers(1)
    expect(lastCall().url).toBe('/api/admin/users?page=1&expand=summary')

    await users.listUsers(1, false)
    expect(lastCall().url).toBe('/api/admin/users?page=1')

    await users.createUser('ops', ['demo'])
    expect(bodyOf(lastCall())).toEqual({ user_id: 'ops', agents: ['demo'] })

    await users.updateUser('ops', ['demo'], 5)
    expect(lastCall().init.method).toBe('PUT')

    await users.deleteUser('ops')
    expect(lastCall().init.method).toBe('DELETE')
  })

  it('部署：validate 在无 user_ids 时不发送该字段（缺省＝全部用户）', async () => {
    const deploy = await import('./deploy')

    await deploy.validateDeploy()
    expect(bodyOf(lastCall())).toEqual({})

    await deploy.validateDeploy(['admin'])
    expect(bodyOf(lastCall())).toEqual({ user_ids: ['admin'] })

    await deploy.deploy(undefined, 9)
    expect(bodyOf(lastCall())).toEqual({ revision: 9 })

    await deploy.deploy(['admin'], 9)
    expect(bodyOf(lastCall())).toEqual({ user_ids: ['admin'], revision: 9 })
  })

  it('部署：历史（有界）/ 清单 / 引用关系（§7.1）/ 异常汇总（§7.2）路径正确', async () => {
    const deploy = await import('./deploy')

    await deploy.fetchDeployHistory(20)
    expect(lastCall().url).toBe('/api/admin/deploy/history?limit=20')

    await deploy.fetchManifest()
    expect(lastCall().url).toBe('/api/admin/deploy/manifest')

    await deploy.withdrawDeploy('zpf', 9)
    expect(bodyOf(lastCall())).toEqual({ user_id: 'zpf', revision: 9 })

    await deploy.fetchReferences('skill', 'pdf-parse')
    expect(lastCall().url).toBe('/api/admin/references?target_type=skill&target_name=pdf-parse')

    await deploy.fetchAnomalies(50)
    expect(lastCall().url).toBe('/api/admin/anomalies?limit=50')
  })
})
