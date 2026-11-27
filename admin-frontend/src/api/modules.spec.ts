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
  fetchMock.mockImplementation(
    async () =>
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  )
})

describe('api/platform', () => {
  it('fetchHealth 走 §1.1 路径（§1.2~§1.4 运行形态端点已下架）', async () => {
    const platform = await import('./platform')
    await platform.fetchHealth()
    expect(lastCall().url).toBe('/api/admin/platform/health')
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
      soul: {
        intro: '简介',
        welcome: '欢迎',
        starters: [],
        mission: 'x',
        capability_tags: [],
        forbidden: [],
        prompt_extra: '',
        next_action_hints: false,
        next_action_hints_count: 3,
        intent_focus: false,
        intent_focus_depth: 0,
        input_rewrite: false,
        term_normalize: false,
        task_planning: false,
      },
      enabled_tools: [],
      mcp_services: [],
      skills: [],
      ontologies: [],
      scenario: { scenario: 's', data_prep_dirs: [], data_prep_fields: {} },
    })
    expect(lastCall().init.method).toBe('POST')

    await agents.updateAgent('demo', {
      name: 'demo',
      soul: {
        intro: '简介',
        welcome: '欢迎',
        starters: [],
        mission: 'x',
        capability_tags: [],
        forbidden: [],
        prompt_extra: '',
        next_action_hints: false,
        next_action_hints_count: 3,
        intent_focus: false,
        intent_focus_depth: 0,
        input_rewrite: false,
        term_normalize: false,
        task_planning: false,
      },
      enabled_tools: [],
      mcp_services: [],
      skills: [],
      ontologies: [],
      scenario: { scenario: 's', data_prep_dirs: [], data_prep_fields: {} },
      revision: 3,
    })
    expect(lastCall().init.method).toBe('PUT')
    expect((bodyOf(lastCall()) as { revision: number }).revision).toBe(3)

    await agents.deleteAgent('demo')
    expect(lastCall().init.method).toBe('DELETE')

    await agents.getAgentDeletionImpact('中文名')
    expect(lastCall().url).toBe(
      `/api/admin/agents/${encodeURIComponent('中文名')}/deletion-impact`,
    )
  })

  it('listAllAgents：按 total_pages 逐页取全量并合并（列表端点固定每页 8 条）', async () => {
    const agents = await import('./agents')

    fetchMock.mockImplementation(async (url: string) => {
      const page = new URL(String(url), 'http://localhost').searchParams.get('page')
      const items = page === '2' ? [{ name: 'b' }] : [{ name: 'a' }]
      return new Response(JSON.stringify({ items, total: 2, page: Number(page), page_size: 8, total_pages: 2 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    await expect(agents.listAllAgents()).resolves.toEqual([{ name: 'a' }, { name: 'b' }])
    expect(calls().map((call) => call.url)).toEqual([
      '/api/admin/agents?page=1',
      '/api/admin/agents?page=2',
    ])
  })

  it('listAllAgents：只有一页时只发一次请求', async () => {
    const agents = await import('./agents')

    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ items: [{ name: 'only' }], total: 1, page: 1, page_size: 8, total_pages: 1 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )

    await expect(agents.listAllAgents()).resolves.toEqual([{ name: 'only' }])
    expect(calls()).toHaveLength(1)
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
  it('卡片 / 详情 / 新建 / 保存 / 删除 / 测试 / 统计走 §3 路径', async () => {
    const mcp = await import('./mcp')

    await mcp.listMcpServices(1)
    expect(lastCall().url).toBe('/api/admin/mcp/services?page=1')

    await mcp.getMcpService('ocr')
    expect(lastCall().url).toBe('/api/admin/mcp/services/ocr')

    await mcp.createMcpService({
      name: 'ocr',
      description: '',
      transport: 'http',
      url: 'http://host:8000/mcp',
      allowed_tools: ['ocr_detect'],
    })
    expect(lastCall().init.method).toBe('POST')
    expect(lastCall().url).toBe('/api/admin/mcp/services')
    expect(bodyOf(lastCall())).toMatchObject({ name: 'ocr', url: 'http://host:8000/mcp' })

    await mcp.saveMcpServiceConfig('ocr', {
      description: '',
      transport: 'http',
      url: 'http://host:8000/mcp',
      file_args: {},
      revision: 1,
    })
    expect(lastCall().init.method).toBe('PUT')

    await mcp.testMcpService('ocr')
    expect(lastCall().url).toBe('/api/admin/mcp/services/ocr/test')

    await mcp.deleteMcpService('ocr')
    expect(lastCall().init.method).toBe('DELETE')
    expect(lastCall().url).toBe('/api/admin/mcp/services/ocr')

    await mcp.fetchMcpStats()
    expect(lastCall().url).toBe('/api/admin/mcp/stats')
  })

  it('新建前探测：POST /api/admin/mcp/probe，payload 原样透传（§3.9，2026-10-03）', async () => {
    const mcp = await import('./mcp')

    await mcp.probeMcpTarget({ transport: 'http', url: 'http://host:8000/mcp', name: 'ocr' })

    expect(lastCall().init.method).toBe('POST')
    expect(lastCall().url).toBe('/api/admin/mcp/probe')
    expect(bodyOf(lastCall())).toEqual({
      transport: 'http',
      url: 'http://host:8000/mcp',
      name: 'ocr',
    })
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
    expect(lastCall().url).toBe(
      '/api/admin/skills/pdf-parse/file?path=references%2F%E6%89%8B%E5%86%8C.md',
    )

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

  it('本体市场：列表 / 导入 / 更新走 §4.6~§4.8 路径', async () => {
    const skills = await import('./skills')

    await skills.fetchOntoMarket()
    expect(lastCall().url).toBe('/api/admin/skills/onto-market')

    await skills.installOntoMarketSkill('生产调度', '原材料采购和库存', 'bom-check')
    expect(lastCall().init.method).toBe('POST')
    expect(lastCall().url).toBe('/api/admin/skills/onto-market/install')
    expect(bodyOf(lastCall())).toEqual({
      scenario: '生产调度',
      ontology: '原材料采购和库存',
      skill: 'bom-check',
    })

    await skills.updateOntoMarketSkill('生产调度', '原材料采购和库存', 'bom-check')
    expect(lastCall().init.method).toBe('POST')
    expect(lastCall().url).toBe('/api/admin/skills/onto-market/update')
    expect(bodyOf(lastCall())).toEqual({
      scenario: '生产调度',
      ontology: '原材料采购和库存',
      skill: 'bom-check',
      confirm: false,
    })

    await skills.updateOntoMarketSkill('生产调度', '原材料采购和库存', 'bom-check', true)
    expect(bodyOf(lastCall())).toMatchObject({ confirm: true })
  })
})

describe('api/ontologies（§10，2026-10-03）', () => {
  it('列表 / 详情 / 删除走 §10.1~§10.3（身份 = 场景名 + 本体名，两段都在路径上）', async () => {
    const ontologies = await import('./ontologies')

    await ontologies.listOntologies(2)
    expect(lastCall().url).toBe('/api/admin/ontologies?page=2')

    const dir = encodeURIComponent('原材料采购和库存')
    const scenario = encodeURIComponent('生产调度')

    await ontologies.fetchOntology('生产调度', '原材料采购和库存')
    expect(lastCall().url).toBe(`/api/admin/ontologies/${scenario}/${dir}`)

    await ontologies.deleteOntology('生产调度', '原材料采购和库存')
    expect(lastCall().init.method).toBe('DELETE')
    expect(lastCall().url).toBe(`/api/admin/ontologies/${scenario}/${dir}`)
  })

  it('本体市场：列表 / 导入 / 更新走 §10.4~§10.6', async () => {
    const ontologies = await import('./ontologies')

    await ontologies.fetchOntoMarketOntologies()
    expect(lastCall().url).toBe('/api/admin/ontologies/onto-market')

    await ontologies.importOntoMarketOntology('生产调度', '原材料采购和库存')
    expect(lastCall().init.method).toBe('POST')
    expect(lastCall().url).toBe('/api/admin/ontologies/onto-market/import')
    expect(bodyOf(lastCall())).toEqual({
      scenario: '生产调度',
      ontology_dir: '原材料采购和库存',
    })

    await ontologies.updateOntoMarketOntology('生产调度', '原材料采购和库存')
    expect(lastCall().url).toBe('/api/admin/ontologies/onto-market/update')
    expect(bodyOf(lastCall())).toEqual({
      scenario: '生产调度',
      ontology_dir: '原材料采购和库存',
    })
  })
})

describe('api/auth（024 §2 + 028 §13 扩展）', () => {
  it('登录支持 user_id / phone 二选一；探针 / 登出 / my-agents 路径正确', async () => {
    const auth = await import('./auth')

    await auth.login({ user_id: 'admin', password: '123456' })
    expect(lastCall().url).toBe('/api/admin/auth/login')
    expect(bodyOf(lastCall())).toEqual({ user_id: 'admin', password: '123456' })

    await auth.login({ phone: '13800000001', password: '123456' })
    expect(bodyOf(lastCall())).toEqual({ phone: '13800000001', password: '123456' })

    await auth.fetchMe()
    expect(lastCall().url).toBe('/api/admin/auth/me')

    await auth.fetchMyAgents()
    expect(lastCall().url).toBe('/api/admin/auth/my-agents')

    await auth.logout()
    expect(lastCall().init.method).toBe('POST')
    expect(lastCall().url).toBe('/api/admin/auth/logout')
  })

  it('注册与链接校验走 028 §4.1 路径', async () => {
    const auth = await import('./auth')

    await auth.register({
      link_token: 'tok',
      phone: '13800000001',
      display_name: '张三',
      password: '123456',
    })
    expect(lastCall().url).toBe('/api/admin/auth/register')
    expect(bodyOf(lastCall())).toEqual({
      link_token: 'tok',
      phone: '13800000001',
      display_name: '张三',
      password: '123456',
    })

    await auth.lookupRegisterLink('tok/en')
    expect(lastCall().url).toBe(`/api/admin/auth/register-links/${encodeURIComponent('tok/en')}`)
  })
})

describe('api/account（028 §13）', () => {
  it('数字人服务：列表 / 新建 / 更新 / 删除路径与载荷', async () => {
    const account = await import('./account')

    await account.listAgentServices()
    expect(lastCall().url).toBe('/api/admin/agent-services')

    await account.createAgentService({ code: 'DH-NEW01', name: '新', platform_agent_name: 'demo' })
    expect(lastCall().init.method).toBe('POST')
    expect(bodyOf(lastCall())).toEqual({ code: 'DH-NEW01', name: '新', platform_agent_name: 'demo' })

    await account.updateAgentService('DH-NEW01', { status: 'disabled' })
    expect(lastCall().init.method).toBe('PUT')
    expect(lastCall().url).toBe('/api/admin/agent-services/DH-NEW01')

    await account.deleteAgentService('DH-NEW01')
    expect(lastCall().init.method).toBe('DELETE')
    expect(lastCall().url).toBe('/api/admin/agent-services/DH-NEW01')
  })

  it('注册链接：列表过滤 / 生成（三种有效期）/ 撤销', async () => {
    const account = await import('./account')

    await account.listRegisterLinks('DH-BOM001')
    expect(lastCall().url).toBe('/api/admin/register-links?agent_code=DH-BOM001')

    await account.createRegisterLink('DH-BOM001')
    expect(bodyOf(lastCall())).toEqual({ agent_code: 'DH-BOM001' })

    await account.createRegisterLink('DH-BOM001', 30 * 86_400)
    expect(bodyOf(lastCall())).toEqual({ agent_code: 'DH-BOM001', expires_in_seconds: 2592000 })

    await account.createRegisterLink('DH-BOM001', null)
    expect(bodyOf(lastCall())).toEqual({ agent_code: 'DH-BOM001', expires_in_seconds: null })

    await account.revokeRegisterLink('tok')
    expect(lastCall().init.method).toBe('DELETE')
    expect(lastCall().url).toBe('/api/admin/register-links/tok')
  })

})

describe('api/users（028 §13 扩展）', () => {
  it('createUser 可携带账号扩展字段（phone/display_name/role）', async () => {
    const users = await import('./users')
    await users.createUser('ops', [], '123456', { phone: '13600000002', display_name: '运维', role: 'user' })
    expect(bodyOf(lastCall())).toEqual({
      user_id: 'ops',
      agents: [],
      password: '123456',
      phone: '13600000002',
      display_name: '运维',
      role: 'user',
    })
  })
})

describe('api/users 与 api/manifest / api/references', () => {
  it('用户：列表不再带 expand=summary（摘要随对账页下架移除，2026-11-27）', async () => {
    const users = await import('./users')

    await users.listUsers(1)
    expect(lastCall().url).toBe('/api/admin/users?page=1')

    await users.createUser('ops', ['demo'])
    expect(bodyOf(lastCall())).toEqual({ user_id: 'ops', agents: ['demo'] })

    await users.updateUser('ops', ['demo'], 5)
    expect(lastCall().init.method).toBe('PUT')

    await users.deleteUser('ops')
    expect(lastCall().init.method).toBe('DELETE')
  })

  it('部署：按账户下发（§6.5，行内部署是唯一入口）', async () => {
    const deploy = await import('./deploy')

    await deploy.deployUsers(['u_1'], 9)
    expect(lastCall().url).toBe('/api/admin/deploy')
    expect(lastCall().init.method).toBe('POST')
    expect(bodyOf(lastCall())).toEqual({ user_ids: ['u_1'], revision: 9 })
  })

  it('停止：撤回某账户的全部运行副本（§6.9）', async () => {
    const deploy = await import('./deploy')

    await deploy.withdrawUser('u_1', 9)
    expect(lastCall().url).toBe('/api/admin/deploy/withdraw')
    expect(lastCall().init.method).toBe('POST')
    expect(bodyOf(lastCall())).toEqual({ user_id: 'u_1', revision: 9 })
  })

  it('清单：取版本号与账本（§6.8，部署区下架后仍供用户管理做乐观锁）', async () => {
    const manifest = await import('./manifest')

    await manifest.fetchManifest()
    expect(lastCall().url).toBe('/api/admin/deploy/manifest')
  })

  it('引用关系：路径与查询参数正确（§7.1）', async () => {
    const references = await import('./references')

    await references.fetchReferences('skill', 'pdf-parse')
    expect(lastCall().url).toBe('/api/admin/references?target_type=skill&target_name=pdf-parse')
  })
})
