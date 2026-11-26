<script lang="ts" setup>
import { computed, onActivated, ref } from 'vue'

import { RightOutlined } from '@ant-design/icons-vue'

defineOptions({
  name: 'ExpandSection',
})

const props = withDefaults(
  defineProps<{
    defaultExpanded?: boolean
    expanded?: boolean
    hideDestory?: boolean
    items?: SectionMenuItem[]
    selectedKey?: string
    title?: string
    withPadding?: boolean
  }>(),
  {
    title: '',
    expanded: undefined,
    defaultExpanded: true,
    items: () => [],
    selectedKey: '',
    hideDestory: true,
    withPadding: true,
  },
)

const emit = defineEmits<{
  'update:expanded': [value: boolean]
  'update:selectedKey': [value: string]
}>()

export interface SectionMenuItem {
  key: string
  label: string
}

const innerExpanded = ref(props.defaultExpanded)

const menuKey = ref(0)
onActivated(() => {
  menuKey.value += 1
})

const isExpanded = computed({
  get: () => props.expanded ?? innerExpanded.value,
  set: (val) => {
    innerExpanded.value = val
    emit('update:expanded', val)
  },
})

const menuItems = computed<SectionMenuItem[]>(() => {
  if (props.items.length > 0) return props.items
  return props.title ? [{ key: '1', label: props.title }] : []
})

const selectedKeys = computed(() => {
  if (props.items.length > 0) return props.selectedKey ? [props.selectedKey] : []
  return ['1']
})

const handleToggle = () => {
  isExpanded.value = !isExpanded.value
}

const handleMenuClick = ({ key, domEvent }: { domEvent: PointerEvent; key: string }) => {
  if (props.items.length > 0) {
    emit('update:selectedKey', key)
  }

  if (props.items.length > 1) {
    domEvent?.stopPropagation()
  }
}
</script>

<template>
  <div class="expand-section bg-white" :class="{ 'px-4': withPadding }">
    <div class="flex items-center border-b border-gray-200 mb-2">
      <span
        class="inline-flex cursor-pointer items-center justify-center px-1 transition-transform duration-200"
        :class="{ 'rotate-90': isExpanded }"
        @click="handleToggle"
      >
        <RightOutlined style="font-size: 12px" />
      </span>
      <a-menu
        v-if="menuItems.length > 1"
        :key="menuKey"
        class="menu-fill-line"
        :selected-keys="selectedKeys"
        mode="horizontal"
        :items="menuItems"
        @click="handleMenuClick"
      />
      <div
        v-else
        style="
          height: 45px;
          padding-left: 5px;
          font-size: 15px;
          font-weight: 600;
          line-height: 45px;
          cursor: pointer;
        "
        @click="handleToggle"
      >
        {{ menuItems[0].label }}
      </div>
      <div class="flex items-center gap-3">
        <slot name="extra-left"></slot>
      </div>
      <div class="ml-auto flex items-center gap-3">
        <slot name="extra"></slot>
      </div>
    </div>
    <template v-if="hideDestory">
      <div v-if="isExpanded" class="expand-section__body">
        <slot></slot>
      </div>
    </template>
    <template v-else>
      <div v-show="isExpanded" class="expand-section__body">
        <slot></slot>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.expand-section {
  :deep(:where(.css-dev-only-do-not-override-14589v).ant-menu-horizontal) {
    border-bottom: 0;
  }
}

.expand-section__body {
  padding-top: 8px;
  padding-bottom: 8px;
}
</style>
