/**
 * US3 输入区工具选项 + US4 `@` 引用空间文件 —— **真实后端**（仅最后一轮引用发送会调 LLM）。
 *
 * 重点验证"只能靠真实后端才能确认"的事实：
 * - 上传接口一次只接受一个文件 → 多选必须逐文件各发一次请求，且**两个文件都真的落盘**（§7 差异 5）
 * - 落盘名以响应中的 `filename` 为准（前端不自行拼接）
 * - 预校验不合规时**不发任何请求**（FR-010）
 * - `@` 引用以结构化 `attachments` 提交，正文不含 `@文件名`（FR-016）
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mentionToken, stripMentionTokens } from '../../src/composables/useFileMention'
import { makeFile } from '../helpers'
import {
  cleanupTrackedThreads,
  createLiveSession,
  ensureThread,
  makeLiveFile,
  selectAgent,
  until,
  type LiveSession,
} from './harness'

/** 把 `unknown` 请求体安全地当记录读（断言用）。 */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

const AGENT = 'demo2'
const DIR = '生产计划'
/** 与后端 `dirs.ts` 的落盘名规则对齐：`{原文件名}_{YYYYMMDD_HHMMSS}{.ext}` */
const SAVED_NAME = /^itest-live-1_\d{8}_\d{6}\.csv$/

let live: LiveSession

describe('US3 输入区工具选项（真实后端）', () => {
  beforeAll(async () => {
    live = createLiveSession()
    await selectAgent(live, AGENT)
    await ensureThread(live, AGENT)
    await live.session.workspace.load()
  })

  it('上传：单文件成功，落盘名以响应为准，且出现在目录清单', async () => {
    const { uploads, workspace } = live.session
    live.resetCalls()

    await uploads.upload(DIR, [makeLiveFile('itest-live-1.csv', 'a,b\n1,2\n')])

    expect(live.countOf('POST', '/files/upload')).toBe(1)
    const item = uploads.items.value.find((entry) => entry.name === 'itest-live-1.csv')
    expect(item?.status).toBe('success')
    expect(item?.serverFilename ?? '').toMatch(SAVED_NAME)

    await workspace.load()
    const names = workspace.filesOf(DIR).map((file) => file.filename)
    expect(names).toContain(item?.serverFilename)
  })

  it('多选：逐文件各发一次请求，且两个文件都真的落盘（差异 5）', async () => {
    const { uploads, workspace } = live.session
    live.resetCalls()

    await uploads.upload(DIR, [
      makeLiveFile('itest-live-2a.csv', 'x\n1\n'),
      makeLiveFile('itest-live-2b.csv', 'y\n2\n'),
    ])

    expect(live.countOf('POST', '/files/upload')).toBe(2)
    const uploaded = uploads.items.value.filter((item) => item.name.startsWith('itest-live-2'))
    expect(uploaded).toHaveLength(2)
    expect(uploaded.every((item) => item.status === 'success')).toBe(true)
    const saved = uploaded.map((item) => item.serverFilename)

    await workspace.load()
    const names = workspace.filesOf(DIR).map((file) => file.filename)
    for (const name of saved) expect(names).toContain(name)
  })

  it('预校验：扩展名不合规 / 超过 50MB → 不发请求且给出原因（FR-010）', async () => {
    const { uploads } = live.session
    live.resetCalls()

    await uploads.upload(DIR, [
      makeFile('itest-live-bad.exe', 1024, 'application/octet-stream'),
      makeFile('itest-live-toobig.txt', 51 * 1024 * 1024, 'text/plain'),
    ])

    expect(live.countOf('POST', '/files/upload')).toBe(0)
    const precheckNames = ['itest-live-bad.exe', 'itest-live-toobig.txt']
    const failed = uploads.items.value.filter((item) => precheckNames.includes(item.name))
    expect(failed).toHaveLength(2)
    expect(failed.every((item) => item.status === 'failed')).toBe(true)
    for (const item of failed) expect(item.error?.code).toBeTruthy()
  })

  it('上传失败：非白名单目录 → 403 原因 + 重试仍失败（FR-011）', async () => {
    const { uploads } = live.session
    live.resetCalls()

    await uploads.upload('不存在的目录', [makeLiveFile('itest-live-3.csv', 'z\n3\n')])

    const findItem = () => uploads.items.value.find((entry) => entry.name === 'itest-live-3.csv')
    expect(live.countOf('POST', '/files/upload')).toBe(1)
    expect(findItem()?.status).toBe('failed')
    expect(findItem()?.error?.code).toBe('UPLOAD_DIR_FORBIDDEN')

    live.resetCalls()
    await uploads.retry(findItem()?.localId ?? '')
    expect(live.countOf('POST', '/files/upload')).toBe(1)
    expect(findItem()?.status).toBe('failed')
  })

  it('模型：默认项唯一、缓存值失效回退默认、select 生效（FR-013）', async () => {
    const { models } = live.session

    await models.load()
    expect(models.models.value.length).toBeGreaterThan(0)
    expect(models.models.value.filter((item) => item.is_default)).toHaveLength(1)
    expect(models.isDefaultSelected.value).toBe(true)

    models.select('itest-live-not-a-model')
    expect(models.current.value).toBe('itest-live-not-a-model')

    // 再次拉取：缓存值不在列表中 → 回退默认项
    await models.load()
    const fallback = models.models.value.find((item) => item.is_default)?.model ?? null
    expect(models.current.value).toBe(fallback)
    expect(models.isDefaultSelected.value).toBe(true)
  })

  it('思考开关：切换状态可读（透传请求体已在 US1 覆盖）', () => {
    const { chat } = live.session
    chat.setThinking(true)
    expect(chat.thinkingEnabled.value).toBe(true)
    chat.setThinking(false)
    expect(chat.thinkingEnabled.value).toBe(false)
  })
})

describe('US4 `@` 引用空间文件（真实后端）', () => {
  it('@ 触发 → 选目录 → 选文件 → 正文与引用同步', async () => {
    const { mention, workspace } = live.session
    await workspace.load()

    mention.handleInput('请参考 @', '请参考 @'.length)
    expect(mention.open.value).toBe(true)
    expect(mention.stage.value).toBe('dir')
    expect(mention.optionCount.value).toBe(9)

    mention.pickDir(DIR)
    expect(mention.stage.value).toBe('file')
    await until(() => mention.files.value.length > 0, '目录文件清单加载')

    const real = { dir: DIR, filename: `${DIR}-target.txt` }
    expect(mention.pickFile(real)).toBe(true)
    expect(mention.references.value).toHaveLength(1)
    expect(mention.buildAttachments()).toEqual([real])

    // 正文中的标记被删除 → 引用同步移除
    mention.handleInput('无关文本', 4)
    expect(mention.references.value).toHaveLength(0)
  })

  it('上限 10 个：第 11 个被拒绝并提示（FR-017 / V-02）', () => {
    const { mention, toast } = live.session
    toast.clear()
    mention.reset()

    for (let index = 0; index < 9; index += 1) {
      expect(mention.pickFile({ dir: DIR, filename: `itest-live-a${index}.csv` })).toBe(true)
    }
    // 第 10 个：并入一个真实存在但不同的引用
    expect(mention.pickFile({ dir: DIR, filename: 'itest-live-a9.csv' })).toBe(true)
    expect(mention.references.value).toHaveLength(10)
    expect(mention.maxReached.value).toBe(true)

    expect(mention.pickFile({ dir: DIR, filename: 'itest-live-a10.csv' })).toBe(false)
    expect(mention.references.value).toHaveLength(10)
    expect(toast.items.value.length).toBeGreaterThan(0)
  })

  it('存在性校验：失效引用可被识别（FR-018 / V-15）', () => {
    const { mention, workspace } = live.session
    mention.reset()
    mention.pickFile({ dir: DIR, filename: 'itest-live-not-exist.csv' })

    const missing = mention.missingReferences()
    expect(missing).toHaveLength(1)
    expect(workspace.exists({ dir: DIR, filename: 'itest-live-not-exist.csv' })).toBe(false)
  })

  it('发送：正文去引用 + attachments 结构化，历史可还原（FR-016，真实 LLM）', async () => {
    const { mention, chat, threads, workspace } = live.session
    await workspace.load()

    const file = workspace.filesOf(DIR).find((item) => item.filename.startsWith('itest-live-1_'))
    if (!file) throw new Error('需要先上传 itest-live-1 样本')
    const reference = { dir: DIR, filename: file.filename }
    expect(workspace.exists(reference)).toBe(true)

    mention.reset()
    mention.pickFile(reference)
    const draft = `请说明这个文件的第一行是什么 ${mentionToken(reference)}`
    const content = stripMentionTokens(draft, mention.buildAttachments())
    expect(content).not.toContain('@')

    live.resetCalls()
    chat.setThinking(false)
    await chat.send({ content, attachments: mention.buildAttachments() })

    const sent = live.calls.find((call) => call.method === 'POST' && call.path.endsWith('/messages'))
    expect(asRecord(sent?.body)).toMatchObject({ content, attachments: [reference] })

    await threads.refresh()
    const withRefs = [...threads.messages.value]
      .reverse()
      .find((m) => m.role === 'user' && (m.attachments?.length ?? 0) > 0)
    expect(withRefs?.attachments?.[0]).toEqual(reference)
  })
})

/**
 * 回收必须放在**最外层**：若挂在 US3 的 describe 内，vitest 会在 US3 跑完立刻执行，
 * 从而删掉会话并清空 `activeId`，导致 US4 的发送链路静默失效。
 */
afterAll(async () => {
  await cleanupTrackedThreads(live.session)
})
