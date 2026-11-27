<script setup lang="ts">
import { computed, ref } from 'vue'

import { getAuthStore } from '../../composables/useAuth'
import BaseDropdown from '../common/BaseDropdown.vue'
import ConfirmDialog from '../common/ConfirmDialog.vue'

const emit = defineEmits<{
  'open-agent': []
}>()

const auth = getAuthStore()

const open = ref(false)
const confirmOpen = ref(false)
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

.user-menu :deep(.base-dropdown__trigger) {
  padding: var(--space-1) var(--space-3);
}

.user-menu__name {
  display: inline-block;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

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
