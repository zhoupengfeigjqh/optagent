/**
 * 消息区的滚动跟随、会话位置记忆与读屏播报（2026-10-16，自 `components/chat/MessageList.vue` 抽出）
 *
 * 抽出来的理由（宪章原则二：单文件 ≤500 行）：`MessageList.vue` 里这一块自成一体——
 * 它只依赖"列表元素 + 消息序列 + 流式指纹 + 乐观气泡 + 会话 id"五个入参，
 * 与模板的其余部分（渲染与事件透传）没有任何耦合。抽出后**行为零变化**：
 * 每个函数与每一处 watch 都是原样搬运，只有 `props.x` 换成了入参。
 *
 * 三条不动摇的口径（搬过来时逐条保留）：
 * - **`atBottom` 是唯一真源**：它同时表达"是否跟随最新"与"回到底部按钮是否出现"。
 *   拆成两个标志位必然出现失同步窗口（按钮隐着、其实已经不在底部）。
 * - **上翻即暂停、回到近底部即恢复**：用户正在读旧内容时，流式增量不许把视口拽走。
 * - **本端发送强制置底**（`pendingUser` 由空变非空）：不看 80px 阈值——用户上翻到很久以前
 *   再发消息时，自己的消息必须立刻可见，否则会以为没发出去。
 *
 * 读屏播报只播**结论**：逐 token 播报会让 live 区每帧变一次、播报被反复打断，
 * 最后什么也听不清（无障碍改造里最常见的自伤）。"正在生成"由 `TypingIndicator` 负责。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

import type { Message } from '../api/types'
import { MESSAGE_ROLE, MESSAGE_STATUS } from '../constants/events'

/** 距底部这么多像素以内即视为"跟随最新" */
const STICK_THRESHOLD_PX = 80

/** 存档上限：与草稿分桶同口径，逛过很多会话也不无限增长 */
const SCROLL_MEMORY_LIMIT = 50

/** 创建参数：全部来自列表组件的 props（本模块自身不持有任何业务数据）。 */
export interface MessageScrollOptions {
  /** 滚动容器（`.message-list`） */
  listRef: Ref<HTMLElement | null>
  /** 历史消息（按时间正序） */
  messages: Ref<Message[]>
  /** 流式指纹：阶段 / 思考长度 / 正文长度 / 工具数量任一变化都需跟随 */
  streamKey: Ref<string>
  /** 本轮乐观用户消息；由空变非空 = 用户刚做了主动动作 → 强制置底 */
  pendingUser: Ref<unknown | null>
  /** 当前会话 id：位置记忆的存档键（`null` = 视图态新对话，不存档） */
  threadId: Ref<string | null>
}

/** 消息区滚动状态。 */
export interface MessageScroll {
  /** 是否停在底部（跟随最新）——同时是「回到底部」按钮显隐的唯一真源 */
  atBottom: Ref<boolean>
  /** 读屏播报文本（只写结论，视觉隐藏） */
  announcement: Ref<string>
  /** 滚动事件处理器（贴底判定） */
  onScroll(): void
  /** 滚到最新并收敛状态 */
  scrollToLatest(): void
}

export function useMessageScroll(options: MessageScrollOptions): MessageScroll {
  const { listRef, messages, streamKey, pendingUser, threadId } = options

  const atBottom = ref(true)
  const announcement = ref('')

  const firstId = computed(() => messages.value[0]?.id ?? '')
  const lastId = computed(() => messages.value[messages.value.length - 1]?.id ?? '')

  function isNearBottom(): boolean {
    const element = listRef.value
    if (!element) return true
    return element.scrollHeight - element.scrollTop - element.clientHeight <= STICK_THRESHOLD_PX
  }

  function scrollToLatest(): void {
    const element = listRef.value
    if (!element) return
    element.scrollTop = element.scrollHeight
    // 程序化滚动不一定派发 scroll 事件（jsdom 更不会），状态就地收敛
    atBottom.value = true
  }

  function onScroll(): void {
    atBottom.value = isNearBottom()
  }

  /**
   * 会话切换时的滚动位置记忆。
   *
   * 只记**上翻过**的会话：贴底的会话本来就会重新置底，"记住底部"没有意义。
   * 键取会话 id 而非消息 id：分页窗口会因"加载更早消息"而变，会话身份才是稳定锚。
   */
  const scrollMemory = new Map<string, number>()
  /** 列表里此刻显示的会话（切换时用来给"上一个"存档） */
  let currentThreadId: string | null = threadId.value

  /** 给离开的会话存档；贴底离开则清掉旧档（避免"贴底走、上翻回"的错觉） */
  function rememberScroll(id: string | null): void {
    if (id === null) return
    const element = listRef.value
    if (atBottom.value || !element) {
      scrollMemory.delete(id)
      return
    }
    // 先删后塞：Map 按插入序淘汰，最近用过的排最后
    scrollMemory.delete(id)
    scrollMemory.set(id, element.scrollTop)
    while (scrollMemory.size > SCROLL_MEMORY_LIMIT) {
      const oldest = scrollMemory.keys().next().value
      if (oldest === undefined) break
      scrollMemory.delete(oldest)
    }
  }

  /** 恢复存档位置；恢复后**重新判定**一次是否贴底（正文高度可能与离开时略有出入） */
  function restoreScroll(scrollTop: number): void {
    atBottom.value = false
    void nextTick(() => {
      const element = listRef.value
      if (!element) return
      element.scrollTop = scrollTop
      atBottom.value = isNearBottom()
    })
  }

  /**
   * 本轮回答落盘时的读屏播报。
   *
   * 正文区不自动播报（列表容器 `role="log"` 上显式 `aria-live="off"`，流式气泡也是）；
   * 收尾只播**一句结论**：新的 assistant 消息追加进列表的那一刻。
   * 失败/中断轮不播报：失败轮由 `ErrorNotice`（`role="alert"`）负责，中断轮根本没落盘。
   */
  function announceCompleted(latest: Message): void {
    if (latest.role !== MESSAGE_ROLE.ASSISTANT) return
    if (latest.status === MESSAGE_STATUS.FAILED) return
    announcement.value = `回答已完成，共 ${latest.content.length} 字`
  }

  // 基线取自首帧，否则首次变化会被误判为"首条也变了"（会话切换）
  let previousFirst = firstId.value
  let previousLast = lastId.value
  let previousCount = messages.value.length

  watch(
    () => [firstId.value, lastId.value, messages.value.length] as const,
    ([first, last, count]) => {
      const firstChanged = first !== previousFirst
      const lastChanged = last !== previousLast
      const grew = count > previousCount
      previousFirst = first
      previousLast = last
      previousCount = count

      // 加载更早消息（前插）：补偿新增高度，让视口停在原内容上，不跳到底部
      if (firstChanged && !lastChanged && grew) {
        const before = listRef.value?.scrollHeight ?? 0
        void nextTick(() => {
          const element = listRef.value
          if (element) element.scrollTop += element.scrollHeight - before
        })
        return
      }

      // 会话切换：先给旧会话存档，再决定新会话落在哪。
      // watcher 跑在 DOM 更新**之前**，此刻 `listRef.scrollTop` 读到的仍是旧会话的位置。
      if (firstChanged) {
        rememberScroll(currentThreadId)
        currentThreadId = threadId.value
        const saved = threadId.value === null ? undefined : scrollMemory.get(threadId.value)
        if (saved === undefined) {
          atBottom.value = true
          void nextTick(scrollToLatest)
        } else {
          restoreScroll(saved)
        }
        return
      }

      // 追加新消息（首条未变、末条变化）：原本贴底则继续跟随，并向读屏播报本轮结论
      if (lastChanged) {
        if (atBottom.value) void nextTick(scrollToLatest)
        const latest = messages.value[messages.value.length - 1]
        if (latest) announceCompleted(latest)
      }
    },
  )

  // 流式增量：贴底时跟随；用户向上翻阅时不打扰
  watch(streamKey, () => {
    if (atBottom.value) void nextTick(scrollToLatest)
  })

  // 本端发起一轮（乐观气泡出现）→ 强制置底，不看阈值（口径见文件头）
  watch(pendingUser, (next) => {
    if (!next) return
    atBottom.value = true
    void nextTick(scrollToLatest)
  })

  /**
   * 容器尺寸变化（右侧工作区面板开合、窗口缩放）会让正文重排，`scrollHeight` 随之改变，
   * 却**不会**派发 scroll 事件——缺这一手，按钮会一直停在旧状态上。
   *
   * jsdom 无 `ResizeObserver`，故做存在性守卫（与 Composer 里"scrollHeight 恒为 0
   * 就不写高度"同理：测试环境不参与布局，状态由显式触发驱动）。
   */
  let resizeObserver: ResizeObserver | null = null

  onMounted(() => {
    void nextTick(scrollToLatest)
    if (typeof ResizeObserver === 'undefined' || !listRef.value) return
    resizeObserver = new ResizeObserver(() => {
      atBottom.value = isNearBottom()
    })
    resizeObserver.observe(listRef.value)
  })

  onBeforeUnmount(() => {
    resizeObserver?.disconnect()
    resizeObserver = null
  })

  return { atBottom, announcement, onScroll, scrollToLatest }
}
