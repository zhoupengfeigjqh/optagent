/**
 * 全局会话上下文（`provide/inject` 的注入键）
 *
 * 设计（`research.md` D4）：
 * - 本模块在工作台视图 `views/WorkbenchView.vue` 调用**一次**，完成全部领域 composable 的装配并 `provide` 到组件树
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
import { createFilesApi, type FilesApi } from '../api/files'
import { createHttpClient } from '../api/http'
import { createModelsApi } from '../api/models'
import { createNextStepsApi } from '../api/next-steps'
import { createProducedApi } from '../api/produced'
import { createThreadsApi } from '../api/threads'
import { createAgentsStore, type AgentsStore } from './useAgents'
import { createChatStreamStore, type ChatStreamStore } from './useChatStream'
import { createFileMentionStore, type FileMentionStore } from './useFileMention'
import { createModelsStore, type ModelsStore } from './useModels'
import { createNextStepsStore, type NextStepsStore } from './useNextSteps'
import { createPreviewStore, type PreviewStore } from './usePreview'
import { createProducedStore, type ProducedStore } from './useProduced'
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
  /** 后台产出（R11）：列表 + 未读数 + 标记已读 + 信号订阅 */
  readonly produced: ProducedStore
  /** 下一步动作提示（007）：轮末拉取窗口（不阻塞、失败静默） */
  readonly nextSteps: NextStepsStore
  readonly toast: ToastStore
  /** 文件原始 API（workspace/uploads/preview 各 store 的数据源；规则选择器等直接用） */
  readonly files: FilesApi
  /** 注入的时钟（供需要本地计时的场景使用） */
  readonly now: () => number
  /**
   * 装配时恢复出的会话 id（002 特性）：URL `?thread=` 优先、本地存储兜底；无则 `null`。
   * `App.vue` 首屏据此自动选中并加载历史（会话已不存在时静默回空态）。
   */
  readonly initialThreadId: string | null
  /** 记住（或清除）当前会话：地址栏 + 本地存储双写，供刷新后恢复 */
  rememberActiveThread(threadId: string | null): void
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

  /**
   * 刷新恢复（002 特性）：装配时就把上次的会话 id 取回来。
   *
   * 只做"读"，写由 `rememberActiveThread` 在会话切换时完成——避免在装配期
   * 建立 watcher（组件外的 watcher 无人回收）。
   */
  const initialThreadId = readRestoredThread(storage)

  /**
   * 当前会话 id：会话、聊天流、搜索共享的单一事实源。
   *
   * MUST NOT 用 `initialThreadId` 预置：本 ref 表达"当前选中"这一**状态**，只由选中动作
   * 驱动；而 `useNextSteps` / `useChatStream` 的 watch 都以"它发生变化"为触发条件，预置
   * 会让初值不产生变化——刷新时 `WorkbenchView.restoreThread` 写回的是同一个 id，下一步
   * 动作卡片因此永不恢复。"要恢复哪个会话"是 `initialThreadId`（值），二者各司其职。
   */
  const activeThreadId = ref<string | null>(null)

  /** 记住当前会话：地址栏 + 本地存储双写（任一步失败都不影响会话本身）。 */
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

  // 下一步动作提示（007 修订 · Tail Protocol）：与 `threads` 共享同一个 `activeThreadId` ——
  // 切会话即清空并一次性恢复最新卡片；流式轮的卡片由 done 事件直推（见 `applyNextActions`）
  const nextSteps = createNextStepsStore({
    nextSteps: createNextStepsApi(client),
    activeThreadId,
  })

  const chat = createChatStreamStore({
    activeThreadId,
    getModel: () => models.current.value,
    getAgentName: () => currentAgentName.value,
    stopRun: (threadId) => threadsApi.stop(threadId).then(() => undefined),
    /**
     * 轮末：刷新会话详情（正文/工具卡片即时可见）与会话列表（新会话进入侧栏、
     * 标题与 updated_at 排序同步到最新）；卡片已随 done 直推，无需轮询。
     */
    onTurnFinished: async () => {
      await threads.refresh()
      await threads.loadList()
    },
    /** done 直推的当轮卡片写入（`useChatStream` 收到 `done.next_actions` 时调用） */
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
      // 009：会话按数字人隔离 ⇒ 切换即进入**新的空对话视图**（不落盘，见 ThreadsStore.startNew）
      threads.startNew()
      // 012：上传记录属于上一个数字人的数据域，切换即清（终态清空，进行中的按 FR-013 保留）
      uploads.clear()
      // 后台产出同样是数字人级的（后端按当前作用域定位产出目录）：先清旧条目/旧未读数，
      // 再按新作用域重拉。铃铛是常驻组件、只在挂载时拉一次，这里不补就一直是上一个数字人的。
      produced.clear()
      await threads.loadList()
      // 文件空间视角＝当前选中数字人（场景随数字人存放）：切换后可见目录清单会变，必须重取
      await workspace.load()
      await produced.refresh()
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
    produced,
    nextSteps,
    toast,
    files: filesApi,
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

/** 当前地址的最小视图（非浏览器环境返回 `null`）。 */
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
