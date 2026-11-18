<script setup lang="ts">
/**
 * 账号菜单（聊天页左上角，2026-11-18）
 *
 * 取代原「切换」按钮：触发器显示当前登录账号（`user_id`），点开后提供
 * 「切换数字人」与「退出登录」两个动作，退出前二次确认。
 *
 * 内聚边界（不复制别人的职责）：
 * - 数字人切换仍归 `AgentPanel` + `useChatHeaderActions`：本组件只发出 `open-agent` 意图，
 *   不拉候选、不落库、不持数字人状态；
 * - 退出登录仍归 `useAuth().logout()`（清会话 + 清 Cookie + 回登录页）：本组件只补二次确认；
 * - 账号来源是登录态唯一来源 `auth.currentUser`（守卫探针已置态），本组件不另做探针。
 *
 * 无障碍：复用 `BaseDropdown`（方向键 / Home / End / Esc / 点击外部关闭 / 焦点归还）；
 * 触发器带屏幕阅读器可读的「账号菜单」前缀；确认框复用 `ConfirmDialog`
 * （原生 dialog 的焦点陷阱 + Esc，`busy` 期间两键禁用防重复提交）。
 */
import { computed, ref } from 'vue'

import { getAuthStore } from '../../composables/useAuth'
import BaseDropdown from '../common/BaseDropdown.vue'
import ConfirmDialog from '../common/ConfirmDialog.vue'

const emit = defineEmits<{
  /** 用户选择「切换数字人」：由上层打开数字人面板（本组件不碰业务状态） */
  'open-agent': []
}>()

const auth = getAuthStore()

/** 菜单开合（`BaseDropdown` 为受控组件） */
const open = ref(false)
/** 退出确认框开合 */
const confirmOpen = ref(false)
/** 登出请求进行中：确认框两键禁用，防重复提交 */
const loggingOut = ref(false)

/**
 * 当前登录账号。正常路径下路由守卫已探针完成（`ensureAuthenticated`），此处必有值；
 * 缺省兜底为「未登录」，避免渲染出空白触发器或抛错。
 */
const userName = computed(() => auth.currentUser.value?.user_id ?? '未登录')

const items = [
  { key: 'switch-agent', label: '切换数字人' },
  { key: 'logout', label: '退出登录' },
]

function onToggle(): void {
  open.value = !open.value
}

function onSelect(key: string): void {
  open.value = false
  if (key === 'switch-agent') {
    emit('open-agent')
    return
  }
  confirmOpen.value = true
}

/** 取消/关闭确认框；登出进行中不接受关闭（避免请求在途时界面错位） */
function onCancelLogout(): void {
  if (loggingOut.value) return
  confirmOpen.value = false
}

/**
 * 确认退出：只调用既有登出编排。
 *
 * `useAuth.logout()` 失败时其 `finally` 已清本地登录态并跳登录页（登出是本地收口，
 * 后端不可达不应把人留在已登出的界面），故这里静默收尾，不重复提示、不复制跳转逻辑。
 */
async function onConfirmLogout(): Promise<void> {
  if (loggingOut.value) return
  loggingOut.value = true
  try {
    await auth.logout()
  } catch {
    /* 已在 useAuth 的 finally 中清态并跳转，这里不再重复处理 */
  } finally {
    loggingOut.value = false
    confirmOpen.value = false
  }
}
</script>

<template>
  <div class="user-menu">
    <BaseDropdown
      :open="open"
      :items="items"
      @toggle="onToggle"
      @select="onSelect"
      @close="open = false"
    >
      <template #trigger>
        <span class="user-menu__sr">账号菜单：</span>
        <span class="user-menu__name" :title="userName">{{ userName }}</span>
      </template>
    </BaseDropdown>

    <ConfirmDialog
      :open="confirmOpen"
      title="退出登录"
      message="退出后需要重新输入账号密码才能进入聊天，确认退出？"
      confirm-label="退出登录"
      :busy="loggingOut"
      @confirm="onConfirmLogout"
      @cancel="onCancelLogout"
    />
  </div>
</template>

<style scoped>
.user-menu {
  display: inline-flex;
  min-width: 0;
}

/*
 * 账号菜单是头部左侧的**常驻入口**，尺度要跟右侧动作位、数字人名称同一行高。
 * `BaseDropdown` 的默认内边距（8px）会把这一行撑到约 40px，比改造前的头部高出一截；
 * 这里只收内边距，字号保持继承（14px = 数字人名称同一字号），不重写组件默认值。
 */
.user-menu :deep(.base-dropdown__trigger) {
  padding: var(--space-1) var(--space-3);
}

/* 触发器内的账号：长标识截断，完整值放 `title`，不挤占右侧数字人名称 */
.user-menu__name {
  display: inline-block;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

/* 视觉隐藏但保留给读屏（不依赖 Tailwind 工具类的可用性） */
.user-menu__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
