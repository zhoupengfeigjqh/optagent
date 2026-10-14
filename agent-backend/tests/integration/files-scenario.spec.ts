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
import * as XLSX from 'xlsx'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadConfig } from '../../src/config'
import { buildServer } from '../../src/server'

const root = mkdtempSync(path.join(tmpdir(), 'optagent-files-'))
const userId = 'admin'

/**
 * 数字人 fixture：alpha 可见两个目录，beta 只可见其中一个，gamma 完全没有场景，
 * delta 的「生产计划」声明了字段约束（上传表权威校验用）。
 */
const AGENT_SCENARIOS: Record<string, unknown | null> = {
  alpha: { scenario: '全量', data_prep_dirs: ['生产计划', '产线电价'] },
  beta: { scenario: '精简', data_prep_dirs: ['产线电价'] },
  gamma: null,
  delta: {
    scenario: '带约束',
    data_prep_dirs: ['生产计划'],
    data_prep_fields: {
      生产计划: [
        { name: '产线编号', type: 'string', required: true },
        { name: '计划量', type: 'integer', required: false },
      ],
    },
  },
  // 2026-10-13：目录级可上传类型——生产计划放宽到 4 项，产线电价收紧到仅 .csv
  epsilon: {
    scenario: '带类型',
    data_prep_dirs: ['生产计划', '产线电价'],
    data_prep_uploads: {
      生产计划: ['.csv', '.xlsx', '.txt', '.json'],
      产线电价: ['.csv'],
    },
  },
  // 2026-10-13：字段约束 + 非表格类型白名单同时存在（验证"仅表格类型触发表结构校验"）
  zeta: {
    scenario: '带约束与类型',
    data_prep_dirs: ['生产计划'],
    data_prep_fields: {
      生产计划: [
        { name: '产线编号', type: 'string', required: true },
        { name: '计划量', type: 'integer', required: false },
      ],
    },
    data_prep_uploads: {
      生产计划: ['.csv', '.xlsx', '.txt', '.pdf', '.json', '.zip'],
    },
  },
  // 2026-10-14：`.xls` 三空间可用——数据准备按目录配置（这里同时声明字段约束，
  // 用来验证"`.xls` 不再跳过表结构校验"）
  eta: {
    scenario: '带约束与 xls',
    data_prep_dirs: ['生产计划'],
    data_prep_fields: {
      生产计划: [
        { name: '产线编号', type: 'string', required: true },
        { name: '计划量', type: 'integer', required: false },
      ],
    },
    data_prep_uploads: {
      生产计划: ['.xls', '.csv'],
    },
  },
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

  it('workspace 的目录项随场景下发字段约束（无约束目录为 []）', async () => {
    await select('delta')

    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' })

    expect(res.statusCode).toBe(200)
    const spaces = (res.json() as {
      spaces: Array<{ name: string; dirs: Array<{ dir: string; fields: unknown }> }>
    }).spaces
    const prep = spaces.find((s) => s.name === '数据准备')!
    expect(prep.dirs[0]!.fields).toEqual([
      { name: '产线编号', type: 'string', required: true },
      { name: '计划量', type: 'integer', required: false },
    ])
    const tmp = spaces.find((s) => s.name === '临时空间')!
    expect(tmp.dirs[0]!.fields).toEqual([])
  })
})

describe('上传表字段约束（data_prep_fields 权威校验，契约 §3.1）', () => {
  const PREP_DIR = '数据准备/生产计划'

  /** 手工拼 multipart（无额外依赖）：dir 字段 + 单文件 */
  function multipart(
    dir: string,
    filename: string,
    content: string | Buffer,
    contentType: string,
  ) {
    const boundary = '----vitest-boundary'
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="dir"\r\n\r\n${dir}\r\n`),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
      ),
      Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
  }

  function toXlsxBuf(matrix: unknown[][]): Buffer {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrix), 'Sheet1')
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  }

  it('缺少必填表头 → 400 FILE_SCHEMA_INVALID + details，且不落盘', async () => {
    await select('delta')
    const { body, headers } = multipart(PREP_DIR, 't.csv', '日期,计划量\n2026-01-01,100\n', 'text/csv')

    const res = await app.inject({ method: 'POST', url: '/api/files/upload', payload: body, headers })

    expect(res.statusCode).toBe(400)
    const err = (res.json() as { error: { code: string; details: string[] } }).error
    expect(err.code).toBe('FILE_SCHEMA_INVALID')
    expect(err.details[0]).toContain('缺少必填表头')
    expect(err.details[0]).toContain('产线编号')

    // 校验失败的文件 MUST NOT 落盘
    const list = await app.inject({ method: 'GET', url: listUrl(PREP_DIR) })
    expect(list.json()).toEqual([])
  })

  it('取值类型不符 → 400，行号按「表头为第 1 行」计', async () => {
    await select('delta')
    const { body, headers } = multipart(
      PREP_DIR,
      't.csv',
      '产线编号,计划量\nA1,abc\n',
      'text/csv',
    )

    const res = await app.inject({ method: 'POST', url: '/api/files/upload', payload: body, headers })

    expect(res.statusCode).toBe(400)
    const err = (res.json() as { error: { code: string; details: string[] } }).error
    expect(err.code).toBe('FILE_SCHEMA_INVALID')
    expect(err.details[0]).toContain('第 2 行')
    expect(err.details[0]).toContain('计划量')
  })

  it('xlsx 同样校验（第一个 sheet，数值单元格按显示文本判定）', async () => {
    await select('delta')
    const buf = toXlsxBuf([
      ['产线编号', '计划量'],
      ['A1', 'abc'],
    ])
    const { body, headers } = multipart(
      PREP_DIR,
      't.xlsx',
      buf,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )

    const res = await app.inject({ method: 'POST', url: '/api/files/upload', payload: body, headers })

    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: { code: string } }).error.code).toBe('FILE_SCHEMA_INVALID')
  })

  it('合规文件 → 201 落盘（可选字段缺席、空单元格均合法）', async () => {
    await select('delta')
    const { body, headers } = multipart(PREP_DIR, 'ok.csv', '产线编号\nA1\nA2\n', 'text/csv')

    const res = await app.inject({ method: 'POST', url: '/api/files/upload', payload: body, headers })

    expect(res.statusCode).toBe(201)
    const list = await app.inject({ method: 'GET', url: listUrl(PREP_DIR) })
    expect((list.json() as Array<{ filename: string }>)).toHaveLength(1)
  })

  it('无约束目录（alpha 的生产计划）与临时空间不触发校验', async () => {
    await select('alpha')
    const { body: b1, headers: h1 } = multipart(
      PREP_DIR,
      'free.csv',
      '任意,内容\n1,2\n',
      'text/csv',
    )
    const r1 = await app.inject({ method: 'POST', url: '/api/files/upload', payload: b1, headers: h1 })
    expect(r1.statusCode).toBe(201)

    await select('delta')
    const { body: b2, headers: h2 } = multipart('临时空间', 'tmp.csv', '任意,内容\n1,2\n', 'text/csv')
    const r2 = await app.inject({ method: 'POST', url: '/api/files/upload', payload: b2, headers: h2 })
    expect(r2.statusCode).toBe(201)
  })
})

describe('上传早验（dir 先到时目录校验前置，拒绝省带宽）', () => {
  /** 手工 multipart，part 顺序可定制（早验/旧顺序两条路径都要覆盖） */
  function multipartOrdered(
    entries: Array<{ name: string; filename?: string; content: string; contentType?: string }>,
  ) {
    const boundary = '----vitest-early-check'
    const bufs: Buffer[] = []
    for (const e of entries) {
      const disposition = e.filename
        ? `Content-Disposition: form-data; name="${e.name}"; filename="${e.filename}"\r\nContent-Type: ${e.contentType ?? 'application/octet-stream'}`
        : `Content-Disposition: form-data; name="${e.name}"`
      bufs.push(Buffer.from(`--${boundary}\r\n${disposition}\r\n\r\n${e.content}\r\n`))
    }
    bufs.push(Buffer.from(`--${boundary}--\r\n`))
    return {
      body: Buffer.concat(bufs),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    }
  }

  const DIR_OUT_OF_LIST = { name: 'dir', content: '数据准备/清单外目录' }
  const FILE_CSV = {
    name: 'file',
    filename: 'a.csv',
    content: '任意\n1\n',
    contentType: 'text/csv',
  }

  /** 临时空间里的上传暂存残留（`.upload-` 前缀） */
  async function stagedResidue(): Promise<string[]> {
    const res = await app.inject({ method: 'GET', url: listUrl('临时空间') })
    return (res.json() as Array<{ filename: string }>)
      .map((f) => f.filename)
      .filter((n) => n.startsWith('.upload-'))
  }

  it('dir 先到 + 清单外目录 → 文件上传前即拒绝（403），且不留暂存', async () => {
    await select('alpha')
    const { body, headers } = multipartOrdered([DIR_OUT_OF_LIST, FILE_CSV])

    const res = await app.inject({ method: 'POST', url: '/api/files/upload', payload: body, headers })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ error: { code: 'UPLOAD_DIR_FORBIDDEN' } })
    expect(await stagedResidue()).toEqual([])
  })

  it('file 先到的旧顺序行为一致（先收后验：同 403，暂存已清）', async () => {
    await select('alpha')
    const { body, headers } = multipartOrdered([FILE_CSV, DIR_OUT_OF_LIST])

    const res = await app.inject({ method: 'POST', url: '/api/files/upload', payload: body, headers })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ error: { code: 'UPLOAD_DIR_FORBIDDEN' } })
    expect(await stagedResidue()).toEqual([])
  })

  it('dir 先到 + 未选中数字人 → 409 在文件上传前返回，不留暂存', async () => {
    await deselect()
    const { body, headers } = multipartOrdered([{ name: 'dir', content: '共享空间' }, FILE_CSV])

    const res = await app.inject({ method: 'POST', url: '/api/files/upload', payload: body, headers })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: { code: 'AGENT_NOT_SELECTED' } })

    await select('alpha') // list 需要选中态；恢复后再查残留
    expect(await stagedResidue()).toEqual([])
  })
})

/**
 * 目录级可上传类型（`scenario.data_prep_uploads`，2026-10-13）：
 * 端点层验证"界面允许的与放行的永远同源"——**放宽点**与**收紧点**各一例，外加下发性断言（FR-011/012/042）。
 */
describe('目录级可上传类型（data_prep_uploads 权威判定）', () => {
  function multipart(dir: string, filename: string, content: string, contentType: string) {
    const boundary = '----vitest-upload-types'
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="dir"\r\n\r\n${dir}\r\n`),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
      ),
      Buffer.from(content, 'utf8'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
  }

  it('放宽点：改造前被拒的 .txt / .json 在已配置目录上放行（201）', async () => {
    await select('epsilon')

    const txt = multipart('数据准备/生产计划', 'notes.txt', '随便写点什么', 'text/plain')
    expect((await app.inject({ method: 'POST', url: '/api/files/upload', payload: txt.body, headers: txt.headers })).statusCode).toBe(201)

    const json = multipart('数据准备/生产计划', 'meta.json', '{"a":1}', 'application/json')
    expect((await app.inject({ method: 'POST', url: '/api/files/upload', payload: json.body, headers: json.headers })).statusCode).toBe(201)
  })

  it('收紧点：目录只允许 .csv 时上传 .xlsx → 400 VALIDATION_FAILED，文案含允许清单且不落盘', async () => {
    await select('epsilon')
    const before = (await app.inject({ method: 'GET', url: listUrl('数据准备/产线电价') })).json()

    const { body, headers } = multipart(
      '数据准备/产线电价',
      'price.xlsx',
      'binary-ish',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    const res = await app.inject({ method: 'POST', url: '/api/files/upload', payload: body, headers })

    expect(res.statusCode).toBe(400)
    const err = (res.json() as { error: { code: string; message: string } }).error
    expect(err.code).toBe('VALIDATION_FAILED')
    expect(err.message).toContain('.xlsx')
    expect(err.message).toContain('.csv')
    // 未落盘
    const after = (await app.inject({ method: 'GET', url: listUrl('数据准备/产线电价') })).json()
    expect(after).toEqual(before)
  })

  it('收紧点：未配置的目录仍按平台默认（.txt 被拒、.csv 放行）', async () => {
    await select('alpha') // alpha 的生产计划未配置 uploads

    const txt = multipart('数据准备/生产计划', 'note.txt', 'x', 'text/plain')
    const denied = await app.inject({ method: 'POST', url: '/api/files/upload', payload: txt.body, headers: txt.headers })
    expect(denied.statusCode).toBe(400)
    expect((denied.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED')

    const csv = multipart('数据准备/生产计划', 'ok.csv', '任意\n1\n', 'text/csv')
    expect((await app.inject({ method: 'POST', url: '/api/files/upload', payload: csv.body, headers: csv.headers })).statusCode).toBe(201)
  })

  it('下发：workspace 的目录项带目录级 upload_extensions（未配置目录 = 平台默认）', async () => {
    await select('epsilon')
    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' })
    expect(res.statusCode).toBe(200)

    const spaces = (res.json() as {
      spaces: Array<{ name: string; upload_extensions: string[]; dirs: Array<{ dir: string; upload_extensions: string[] }> }>
    }).spaces

    const prep = spaces.find((s) => s.name === '数据准备')!
    const plan = prep.dirs.find((d) => d.dir === '数据准备/生产计划')!
    const price = prep.dirs.find((d) => d.dir === '数据准备/产线电价')!
    expect(plan.upload_extensions).toEqual(['.csv', '.xlsx', '.txt', '.json'])
    expect(price.upload_extensions).toEqual(['.csv'])

    // 共享空间 / 临时空间：目录级恒等于空间级（与改造前一致）
    for (const space of spaces.filter((s) => s.name !== '数据准备')) {
      for (const dir of space.dirs) {
        expect(dir.upload_extensions).toEqual(space.upload_extensions)
      }
    }
  })

  it('下发：未配置 uploads 的数字人（alpha）目录项为平台默认 .csv/.xlsx', async () => {
    await select('alpha')
    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' })
    const prep = (res.json() as {
      spaces: Array<{ name: string; dirs: Array<{ dir: string; upload_extensions: string[] }> }>
    }).spaces.find((s) => s.name === '数据准备')!
    for (const dir of prep.dirs) {
      expect(dir.upload_extensions).toEqual(['.csv', '.xlsx'])
    }
  })
})

/** 手工 multipart（dir 字段在前，命中早验路径）；供 US3/US4/US5 三个故事块共用 */
function upload(dir: string, filename: string, content: string | Buffer, contentType: string) {
  const boundary = '----vitest-story-boundary'
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="dir"\r\n\r\n${dir}\r\n`),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    // 二进制内容（如真实 `.xls`）直接给 Buffer，文本给字符串
    Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}

async function postUpload(
  dir: string,
  filename: string,
  content: string | Buffer,
  contentType: string,
): Promise<ReturnType<typeof app.inject>> {
  const { body, headers } = upload(dir, filename, content, contentType)
  return app.inject({ method: 'POST', url: '/api/files/upload', payload: body, headers })
}

/** 共享空间 / 临时空间的空间级白名单（2026-10-14 起在既有口径上新增 `.xls`） */
const SPACE_LEVEL_EXTS = [
  '.csv',
  '.xlsx',
  '.xls',
  '.txt',
  '.json',
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.bmp',
  '.webp',
  '.gif',
  '.tif',
  '.tiff',
]

/* ---------- US3：共享空间与临时空间行为不变（P1） ---------- */

describe('US3 共享空间与临时空间的判定逐项不变（FR-013）', () => {
  it('即便配了 data_prep_uploads：共享空间仍接受全部文档与图片类型，且拒绝未知类型', async () => {
    await select('epsilon')

    expect((await postUpload('共享空间', 'a.json', '{"a":1}', 'application/json')).statusCode).toBe(201)
    expect((await postUpload('共享空间', 'b.pdf', '%PDF-1.4', 'application/pdf')).statusCode).toBe(201)
    expect((await postUpload('共享空间', 'c.jpg', 'jpeg-ish', 'image/jpeg')).statusCode).toBe(201)

    const denied = await postUpload('共享空间', 'd.exe', 'MZ', 'application/octet-stream')
    expect(denied.statusCode).toBe(400)
    expect((denied.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED')
  })

  it('临时空间同样不受数据准备白名单影响', async () => {
    await select('epsilon')

    expect((await postUpload('临时空间', 'a.json', '{"a":1}', 'application/json')).statusCode).toBe(201)
    expect((await postUpload('临时空间', 'b.tif', 'tiff-ish', 'image/tiff')).statusCode).toBe(201)
  })

  it('下发口径：共享/临时空间的目录项恒等于所属空间的白名单（逐项比对）', async () => {
    await select('epsilon')
    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' })
    const spaces = (res.json() as {
      spaces: Array<{
        name: string
        upload_extensions: string[]
        dirs: Array<{ dir: string; upload_extensions: string[] }>
      }>
    }).spaces

    for (const name of ['共享空间', '临时空间']) {
      const space = spaces.find((s) => s.name === name)!
      expect(space.upload_extensions).toEqual(SPACE_LEVEL_EXTS)
      for (const dir of space.dirs) {
        expect(dir.upload_extensions).toEqual(SPACE_LEVEL_EXTS)
      }
    }
    // 数据准备空间本身的「空间级」值也未受影响
    expect(spaces.find((s) => s.name === '数据准备')!.upload_extensions).toEqual(['.csv', '.xlsx'])
  })
})

/* ---------- 2026-10-14：`.xls`（旧版 Excel）三个空间都可用 ---------- */

describe('`.xls` 三空间可用（2026-10-14 新增类型）', () => {
  /** 真实 `.xls`（OLE2/BIFF8）：SheetJS 写入，避免手搓二进制 fixture */
  function xlsBuffer(rows: unknown[][]): Buffer {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
    return XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer
  }

  const XLS_TYPE = 'application/vnd.ms-excel'

  it('共享空间 / 临时空间：空间级白名单含 .xls ⇒ 上传成功（201）', async () => {
    await select('epsilon')
    const xls = xlsBuffer([['产线编号'], ['A1']])

    expect((await postUpload('共享空间', '总BOM.xls', xls, XLS_TYPE)).statusCode).toBe(201)
    expect((await postUpload('临时空间', '总BOM.xls', xls, XLS_TYPE)).statusCode).toBe(201)
  })

  it('数据准备：目录白名单含 .xls ⇒ 上传成功（不再被"仅 csv/xlsx"挡住）', async () => {
    await select('eta')
    const res = await postUpload(
      '数据准备/生产计划',
      'a.xls',
      xlsBuffer([['产线编号'], ['A1']]),
      XLS_TYPE,
    )

    expect(res.statusCode).toBe(201)
  })

  it('数据准备：声明了字段约束的目录对 .xls 同样做表结构校验（不因容器格式不同而跳过）', async () => {
    await select('eta')
    const res = await postUpload(
      '数据准备/生产计划',
      'bad.xls',
      xlsBuffer([['计划量'], ['1']]),
      XLS_TYPE,
    )

    expect(res.statusCode).toBe(400)
    const err = (res.json() as { error: { code: string; details: string[] } }).error
    expect(err.code).toBe('FILE_SCHEMA_INVALID')
    expect(err.details[0]).toContain('缺少必填表头')
    expect(err.details[0]).toContain('产线编号')
  })

  it('未配置白名单的目录仍只接受 .csv / .xlsx（存量行为不变，FR-005）', async () => {
    await select('delta') // delta 的生产计划声明了字段约束，但未配置 uploads
    const res = await postUpload(
      '数据准备/生产计划',
      'a.xls',
      xlsBuffer([['产线编号'], ['A1']]),
      XLS_TYPE,
    )

    expect(res.statusCode).toBe(400)
    const err = (res.json() as { error: { code: string; message: string } }).error
    expect(err.code).toBe('VALIDATION_FAILED')
    expect(err.message).toContain('.xls')
  })

  it('下发：目录配置里的 .xls 原样回传给前台（界面 accept 据此生成）', async () => {
    await select('eta')
    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' })
    const dir = (res.json() as {
      spaces: Array<{ name: string; dirs: Array<{ dir: string; upload_extensions: string[] }> }>
    })
      .spaces.find((s) => s.name === '数据准备')!
      .dirs.find((d) => d.dir === '数据准备/生产计划')!

    expect(dir.upload_extensions).toEqual(['.xls', '.csv'])
  })
})

/* ---------- US4：字段约束只对表格类型生效（P2） ---------- */

describe('US4 声明了字段约束的目录上传非表格类型 → 跳过表结构校验（FR-020）', () => {
  it.each([
    ['notes.txt', '随便写点什么', 'text/plain'],
    ['doc.pdf', '%PDF-1.4', 'application/pdf'],
    ['meta.json', '{"a":1}', 'application/json'],
    ['pack.zip', 'PK\u0003\u0004 zip-ish', 'application/zip'],
  ])('%s 上传成功（201），不因"缺少必填表头"被拒', async (filename, content, contentType) => {
    await select('zeta')
    const res = await postUpload('数据准备/生产计划', filename, content, contentType)
    expect(res.statusCode).toBe(201)
  })

  it('表格类型仍逐条校验：缺必填表头 / 类型不符 / 损坏文件都被拒且理由可读', async () => {
    await select('zeta')

    const missing = await postUpload('数据准备/生产计划', 't.csv', '日期,计划量\n2026-01-01,100\n', 'text/csv')
    expect(missing.statusCode).toBe(400)
    const missingErr = (missing.json() as { error: { code: string; details: string[] } }).error
    expect(missingErr.code).toBe('FILE_SCHEMA_INVALID')
    expect(missingErr.details[0]).toContain('缺少必填表头')
    expect(missingErr.details[0]).toContain('产线编号')

    const wrongType = await postUpload('数据准备/生产计划', 't2.csv', '产线编号,计划量\nA1,abc\n', 'text/csv')
    expect(wrongType.statusCode).toBe(400)
    const wrongErr = (wrongType.json() as { error: { code: string; details: string[] } }).error
    expect(wrongErr.code).toBe('FILE_SCHEMA_INVALID')
    expect(wrongErr.details[0]).toContain('第 2 行')

    // 损坏的 xlsx：非 zip 魔数，确定性拦截（与"不符合约束"同码同出口）
    const broken = await postUpload(
      '数据准备/生产计划',
      'broken.xlsx',
      'this is not a zip payload',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(broken.statusCode).toBe(400)
    const brokenErr = (broken.json() as { error: { code: string; details: string[] } }).error
    expect(brokenErr.code).toBe('FILE_SCHEMA_INVALID')
    expect(brokenErr.details[0]).toContain('无法解析')
  })

  it('.txt 即使目录声明了约束也不落表结构校验：合规 csv 与任意 txt 均 201，缺表头 csv 仍 400', async () => {
    await select('zeta')
    expect((await postUpload('数据准备/生产计划', 'ok.csv', '产线编号\nA1\n', 'text/csv')).statusCode).toBe(201)
    expect((await postUpload('数据准备/生产计划', 'free.txt', '任意内容', 'text/plain')).statusCode).toBe(201)
    expect((await postUpload('数据准备/生产计划', 'bad.csv', '日期\n2026-01-01\n', 'text/csv')).statusCode).toBe(400)
  })
})

/* ---------- US5：未配置的存量数字人行为不变（P2） ---------- */

describe('US5 未配置 data_prep_uploads 的存量数字人（FR-014）', () => {
  it('数据准备目录只接受 .csv / .xlsx（零迁移：scenario.json 不含该键）', async () => {
    await select('alpha') // alpha 的 scenario.json 无 data_prep_uploads

    expect((await postUpload('数据准备/生产计划', 'a.csv', '任意\n1\n', 'text/csv')).statusCode).toBe(201)
    expect((await postUpload('数据准备/生产计划', 'b.xlsx', 'not-zip', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).statusCode).toBe(201)

    for (const [filename, contentType] of [
      ['c.txt', 'text/plain'],
      ['d.json', 'application/json'],
      ['e.pdf', 'application/pdf'],
      ['f.zip', 'application/zip'],
    ] as const) {
      const res = await postUpload('数据准备/生产计划', filename, 'x', contentType)
      expect(res.statusCode).toBe(400)
      expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED')
    }
  })

  it('数据准备**空间根**上传仍被拒：MUST 指定二级目录（FR-015 修订口径）', async () => {
    await select('alpha')

    const res = await postUpload('数据准备', 'root.csv', '任意\n1\n', 'text/csv')

    expect(res.statusCode).toBe(400)
    const err = (res.json() as { error: { code: string; message: string } }).error
    // 内部异常为 DirValidationError（code = 'DIR_VALIDATION'）；HTTP 层按既有映射落 VALIDATION_FAILED
    expect(err.code).toBe('VALIDATION_FAILED')
    expect(err.message).toContain('二级目录')
  })
})
