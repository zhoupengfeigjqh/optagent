<script setup lang="ts">
/**
 * 输入区工具栏（T053）
 *
 * 布局契约定死（FR-008）：**最左**为加号上传入口、**右二**为模型选择、
 * **最右**为思考/快速开关，其后是发送/中断按钮。
 *
 * 组件本身不持有业务状态：所有意图一律上抛，由装配层（`ChatPanel`）落到 composable。
 */
import type { Model } from '../../api/types'
import BaseButton from '../common/BaseButton.vue'
import BaseIcon from '../common/BaseIcon.vue'
import ModelPicker from './ModelPicker.vue'
import ThinkingToggle from './ThinkingToggle.vue'

withDefaults(
  defineProps<{
    /** 是否处于思考模式 */
    thinking?: boolean
    /** 当前模型 */
    model?: string | null
    /** 可选模型列表 */
    models?: Model[]
    /** 是否可发送 */
    canSend?: boolean
    /** 本轮是否进行中 */
    streaming?: boolean
    /** 是否禁用上传入口 */
    uploadDisabled?: boolean
  }>(),
  {
    thinking: false,
    model: null,
    models: () => [],
    canSend: false,
    streaming: false,
    uploadDisabled: false,
  },
)

const emit = defineEmits<{
  'toggle-thinking': []
  'select-model': [model: string]
  send: []
  stop: []
  'toggle-upload': []
}>()

function onSelectModel(model: string): void {
  emit('select-model', model)
}
</script>

<template>
  <div class="composer-toolbar">
    <div class="composer-toolbar__left">
      <BaseButton
        variant="ghost"
        size="sm"
        :disabled="uploadDisabled"
        aria-label="上传文件"
        @click="emit('toggle-upload')"
      >
        <BaseIcon name="plus" :size="16" />
      </BaseButton>
    </div>

    <div class="composer-toolbar__right">
      <ModelPicker :model="model" :models="models" @select="onSelectModel" />
      <ThinkingToggle :thinking="thinking" @toggle="emit('toggle-thinking')" />

      <!-- 发送/中断同位互斥：流式中发送按钮原位变为红色方块（「终止」），避免双按钮并存 -->
      <BaseButton
        v-if="streaming"
        variant="danger"
        size="sm"
        aria-label="中断本轮"
        @click="emit('stop')"
      >
        <BaseIcon name="stop" :size="14" />
      </BaseButton>
      <BaseButton v-else variant="primary" size="sm" :disabled="!canSend" @click="emit('send')">
        发送
      </BaseButton>
    </div>
  </div>
</template>

<style scoped>
.composer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.composer-toolbar__right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
</style>
