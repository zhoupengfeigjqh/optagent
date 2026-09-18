/**
 * 全局会话上下文（`provide/inject` 的注入键）
 *
 * 设计（`research.md` D4）：
 * - 本模块在 `App.vue` 调用**一次**，完成全部领域 composable 的装配并 `provide` 到组件树
 * - 其余 `useXxx()` 组件内访问器一律 `inject` 本上下文，**不各自新建状态**
 * - 测试通过 `createAppSession({ fetchImpl, now, storage })` 注入 `fetch` 桩、假时钟与内存存储
 *
 * 装配顺序即依赖方向（无环）：
 * `client/toast → preview/workspace/models/uploads/mention → threads → chat → agents`
 *
 * ⚠️ 各领域模块会 `import { useSession } from './useAppSession'`，与本模块 `import { createXxxStore }`
 * 形成 ESM 循环引用。该循环是安全的：所有跨模块引用都只出现在**函数体内部**（延迟求值），
 * 模块求值期不会触碰对方的绑定。
 */

import { computed, getCurrentInstance, inject, provide, ref, type InjectionKey } from 'vue'

import { createAgentsApi } from '../api/agents'
import { createFilesApi } from '../api/files'
import { createHttpClient } from '../api/http'
import { createModelsApi } from '../api/models'
import { createThreadsApi } from '../api/threads'
import { createAgentsStore, type AgentsStore } from './useAgents'
import { createChatStreamStore, type ChatStreamStore } from './useChatStream'
import { createFileMentionStore, type FileMentionStore } from './useFileMention'
import { createModelsStore, type ModelsStore } from './useModels'
import { createPreviewStore, type PreviewStore } from './usePreview'
import { createSessionSearchStore, type SessionSearchStore } from './useSessionSearch'
import { createThreadsStore, type ThreadsStore } from './useThreads'
import { createToastStore, type ToastStore } from './useToast'
import { createUploadsStore, type UploadsStore } from './useUploads'
import { createWorkspaceStore, type WorkspaceStore } from './useWorkspace'

/** 构造参数（全部可选，测试可注入桩）。 */
export interface AppSessionOptions {
  /** API 基础地址；默认取 `VITE_API_BASE_URL`，缺省同源相对路径（开发期经 Vite 代理，D3） */
  baseUrl?: string
  /** `fetch` 实现（测试注入） */
  fetchImpl?: typeof fetch
  /** 时钟（测试注入假时钟） */
  now?: () => number
  /** 本地偏好存储；`null` 关闭持久化（测试注入内存实现） */
  storage?: Storage | null
}

/** 装配完成的会话上下文。 */
export interface AppSession {
  readonly agents: AgentsStore
  readonly threads: ThreadsStore
  readonly chat: ChatStreamStore
  readonly models: ModelsStore
  readonly uploads: UploadsStore
  readonly mention: FileMentionStore
  readonly workspace: WorkspaceStore
  readonly search: SessionSearchStore
  readonly preview: PreviewStore
  readonly toast: ToastStore
  /** 注入的时钟（供需要本地计时的场景使用） */
  readonly now: () => number
}

/** 注入键。 */
export const APP_SESSION_KEY: InjectionKey<AppSession> = Symbol('optagent.app-session')

/**
 * 装配并（在组件内）`provide` 会话上下文。
 *
 * 在组件内调用一次即可；在测试中调用（无组件实例）时只装配不 `provide`。
 */
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

/**
 * HMR 保护：本模块是 `provide/inject` 的**唯一来源**，且持有 `APP_SESSION_KEY`。
 *
 * 若热更新替换本模块，`APP_SESSION_KEY` 会变成**新的 Symbol**，而 `provide` 仍注册在旧
 * Symbol 上，子组件的 `useSession()` 注入失败 → 抛错 → **整页白屏（看不到任何内容）**。
 * 因此改本文件时放弃热更新，直接整页刷新以重建模块图。
 */
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

  /** 当前会话 id：会话、聊天流、搜索共享的单一事实源。 */
  const activeThreadId = ref<string | null>(null)

  const preview = createPreviewStore({ files: filesApi })
  // 删除动作需要提示成功/失败原因，故 workspace 依赖 toast
  const workspace = createWorkspaceStore({ files: filesApi, toast })
  const models = createModelsStore({ models: modelsApi, storage })
  const uploads = createUploadsStore({ files: filesApi, toast })
  const mention = createFileMentionStore({ workspace, toast })

  // 惰性 computed：`agents` 在下方才创建，getter 仅在首次访问时求值（打破声明顺序，无环）
  const currentAgentName = computed(() => agents.currentAgent.value?.agent_name ?? null)

  const threads = createThreadsStore({
    threads: threadsApi,
    activeThreadId,
    currentAgentName,
    toast,
  })

  const search = createSessionSearchStore({ messages: () => threads.messages.value })

  const chat = createChatStreamStore({
    activeThreadId,
    getModel: () => models.current.value,
    getAgentName: () => currentAgentName.value,
    stopRun: (threadId) => threadsApi.stop(threadId).then(() => undefined),
    onTurnFinished: () => threads.refresh(),
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
      await threads.loadList()
      // 文件空间视角＝当前选中数字人（场景随数字人存放）：切换后可见目录清单会变，必须重取
      await workspace.load()
    },
  })

  return {
    agents,
    threads,
    chat,
    models,
    uploads,
    mention,
    workspace,
    search,
    preview,
    toast,
    now,
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
