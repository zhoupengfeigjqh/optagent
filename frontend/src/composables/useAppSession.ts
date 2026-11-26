
import { computed, getCurrentInstance, inject, provide, ref, type InjectionKey } from 'vue'

import { createAgentsApi } from '../api/agents'
import { createFilesApi, type FilesApi } from '../api/files'
import { createHttpClient } from '../api/http'
import { createModelsApi } from '../api/models'
import { createNextStepsApi } from '../api/next-steps'
import { createProducedApi } from '../api/produced'
import { createScheduledTasksApi } from '../api/scheduled-tasks'
import { createThreadsApi } from '../api/threads'
import { createAgentsStore, type AgentsStore } from './useAgents'
import { useEmptyDataHint, type EmptyDataHint } from './useEmptyDataHint'
import { createChatStreamStore, type ChatStreamStore } from './useChatStream'
import { createFileMentionStore, type FileMentionStore } from './useFileMention'
import { createSkillMentionStore, type SkillMentionStore } from './useSkillMention'
import { createModelsStore, type ModelsStore } from './useModels'
import type { TermNormalizeApi } from '../api/term-normalize'
import { createTermNormalizeApi } from '../api/term-normalize'
import { createNextStepsStore, type NextStepsStore } from './useNextSteps'
import { createPreviewStore, type PreviewStore } from './usePreview'
import { createProducedStore, type ProducedStore } from './useProduced'
import { createScheduledTasksStore, type ScheduledTasksStore } from './useScheduledTasks'
import { createSessionSearchStore, type SessionSearchStore } from './useSessionSearch'
import { createThreadsStore, type ThreadsStore } from './useThreads'
import { createToastStore, type ToastStore } from './useToast'
import { createUploadsStore, type UploadsStore } from './useUploads'
import { createWorkspaceStore, type WorkspaceStore } from './useWorkspace'
import {
  readStoredThread,
  readThreadFromSearch,
  writeStoredThread,
  writeThreadToUrl,
  type UrlLike,
} from '../utils/thread-restore'

export interface AppSessionOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
  now?: () => number
  storage?: Storage | null
}

export interface AppSession {
  readonly agents: AgentsStore
  readonly threads: ThreadsStore
  readonly schedule: ScheduledTasksStore
  readonly chat: ChatStreamStore
  readonly models: ModelsStore
  readonly uploads: UploadsStore
  readonly mention: FileMentionStore
  readonly skillMention: SkillMentionStore
  readonly workspace: WorkspaceStore
  readonly emptyHint: EmptyDataHint
  readonly search: SessionSearchStore
  readonly preview: PreviewStore
  readonly produced: ProducedStore
  readonly nextSteps: NextStepsStore
  readonly toast: ToastStore
  readonly files: FilesApi
  /**
   * 术语替换预检（018）：发送前的一次性调用，由 `useChatPanel` 的确认弹窗消费。
   * 只做传输，不含业务判断（开关/字典/降级全在服务端）。
   */
  readonly termNormalize: TermNormalizeApi
  readonly now: () => number
  /**
   * 装配时恢复出的会话 id（002 特性）：URL `?thread=` 优先、本地存储兜底；无则 `null`。
   * `App.vue` 首屏据此自动选中并加载历史（会话已不存在时静默回空态）。
   */
  readonly initialThreadId: string | null
  rememberActiveThread(threadId: string | null): void
}

export const APP_SESSION_KEY: InjectionKey<AppSession> = Symbol('optagent.app-session')

export function useAppSession(options: AppSessionOptions = {}): AppSession {
  const session = createAppSession(options)
  if (getCurrentInstance() !== null) {
    provide(APP_SESSION_KEY, session)
  }
  return session
}

/** 取用注入的会话上下文；未注入时抛出明确错误，避免静默空状态。 */
export function useSession(): AppSession {
  // 注意：`inject()` 在 setup() 之外**只告警并返回 `undefined`**（不会回落到默认值），
  // 故这里必须同时兜住 `null` 与 `undefined`。
  const session = inject(APP_SESSION_KEY, null)
  if (!session) {
    throw new Error('未找到会话上下文：请确认祖先组件已调用 useAppSession()')
  }
  return session
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    location.reload()
  })
}

/** 纯装配（无副作用，便于测试直接构造）。 */
export function createAppSession(options: AppSessionOptions = {}): AppSession {
  const client = createHttpClient({ baseUrl: options.baseUrl, fetchImpl: options.fetchImpl })
  const now = options.now ?? ((): number => Date.now())
  const storage = options.storage === undefined ? defaultStorage() : options.storage

  const filesApi = createFilesApi(client)
  const threadsApi = createThreadsApi(client)
  const agentsApi = createAgentsApi(client)
  const modelsApi = createModelsApi(client)

  const toast = createToastStore()

  /**
   * 刷新恢复（002 特性）：装配时就把上次的会话 id 取回来。
   *
   * 只做"读"，写由 `rememberActiveThread` 在会话切换时完成——避免在装配期
   * 建立 watcher（组件外的 watcher 无人回收）。
   */
  const initialThreadId = readRestoredThread(storage)

  const activeThreadId = ref<string | null>(null)

  function rememberActiveThread(threadId: string | null): void {
    writeStoredThread(storage, threadId)
    const url = currentUrl()
    if (!url) return
    try {
      writeThreadToUrl(threadId, url, (next) => globalThis.history.replaceState(null, '', next))
    } catch {
      /* 沙箱 iframe / 隐私模式：地址栏同步失败不影响会话状态 */
    }
  }

  const produced = createProducedStore({ produced: createProducedApi(client) })
  const preview = createPreviewStore({ files: filesApi })
  const workspace = createWorkspaceStore({ files: filesApi, toast })

  /**
   * 空数据引导（014）：依赖 workspace 的清单与错误。
   *
   * 只在切换数字人成功后判定（`onSwitched` 内），因此首次加载 / 刷新恢复不会误弹（FR-005）；
   * 判定时机在新清单加载完成之后，避免用上一个数字人的数据误判（FR-006）。
   */
  const emptyHint = useEmptyDataHint({ spaces: workspace.spaces, error: workspace.error })
  const models = createModelsStore({ models: modelsApi, storage })
  const uploads = createUploadsStore({ files: filesApi, toast })
  // 引用按会话分桶（023 v1.4）：与草稿同一套"切走存、切回取"，否则旧会话的不可见引用
  const mention = createFileMentionStore({ workspace, toast, thread: () => activeThreadId.value })
  const skillMention = createSkillMentionStore({ agents: agentsApi })

  const currentAgentName = computed(() => agents.currentAgent.value?.agent_name ?? null)

  const threads = createThreadsStore({
    threads: threadsApi,
    activeThreadId,
    currentAgentName,
    toast,
  })

  /**
   * 定时任务（015）：任务属于数字人数据域，故装配在 `threads` 之后（要它刷新左栏）、
   * `agents` 之前（切人要清空重拉）。**不在这里 `start()`**：SSE 连接只由真正展示
   * 任务的视图（工作台）建立/断开，避免数据页、甘特图页白开一条长连接。
   */
  const schedule = createScheduledTasksStore({
    scheduled: createScheduledTasksApi(client),
    reloadThreads: () => threads.loadList(),
    toast,
  })

  const search = createSessionSearchStore({ messages: () => threads.messages.value })

  const nextSteps = createNextStepsStore({
    nextSteps: createNextStepsApi(client),
    activeThreadId,
  })

  const chat = createChatStreamStore({
    activeThreadId,
    getModel: () => models.current.value,
    getAgentName: () => currentAgentName.value,
    stopRun: (threadId) => threadsApi.stop(threadId).then(() => undefined),
    onTurnFinished: async () => {
      await threads.refresh()
      await threads.loadList()
    },
    applyNextActions: (steps) => nextSteps.apply(steps),
    feedbackOf: (messageId) =>
      threads.messages.value.find((message) => message.id === messageId)?.feedback ?? null,
    applyFeedback: (messageId, value) => threads.patchFeedback(messageId, value),
    sendFeedback: (threadId, messageId, value) =>
      threadsApi.feedback(threadId, messageId, value).then(() => undefined),
    submitInteraction: (threadId, body) => threadsApi.submitInteraction(threadId, body),
    toast,
    storage,
    now,
    baseUrl: client.baseUrl,
    fetchImpl: client.fetchImpl,
  })

  const agents = createAgentsStore({
    agents: agentsApi,
    getPhase: () => chat.phase.value,
    toast,
    onSwitched: async () => {
      threads.startNew()
      uploads.clear()
      skillMention.reset()
      produced.clear()
      schedule.onAgentSwitched()
      await threads.loadList()
      // 文件空间视角＝当前选中数字人（场景随数字人存放）：切换后可见目录清单会变，必须重取
      await workspace.load()
      emptyHint.onAgentSwitched()
      await produced.refresh()
    },
  })

  return {
    agents,
    threads,
    schedule,
    chat,
    models,
    uploads,
    mention,
    skillMention,
    workspace,
    emptyHint,
    search,
    preview,
    produced,
    nextSteps,
    toast,
    files: filesApi,
    termNormalize: createTermNormalizeApi(client),
    now,
    initialThreadId,
    rememberActiveThread,
  }
}

/** 取浏览器 `sessionStorage`（不可用时返回 `null`，静默降级）。 */
function defaultStorage(): Storage | null {
  try {
    return typeof globalThis.sessionStorage === 'undefined' ? null : globalThis.sessionStorage
  } catch {
    return null
  }
}

function currentUrl(): UrlLike | null {
  try {
    const location = globalThis.location
    if (!location) return null
    return { pathname: location.pathname, search: location.search, hash: location.hash }
  } catch {
    return null
  }
}

/** 恢复来源：URL `?thread=` 优先（可分享），本地存储兜底（URL 被清掉时仍能恢复）。 */
function readRestoredThread(storage: Storage | null): string | null {
  const url = currentUrl()
  const fromUrl = url ? readThreadFromSearch(url.search) : null
  return fromUrl ?? readStoredThread(storage)
}
