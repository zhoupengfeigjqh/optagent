<script lang="ts" setup>
import { computed, onActivated, ref } from 'vue';

import { RightOutlined } from '@ant-design/icons-vue';

defineOptions({
  name: 'ExpandSection',
});

const props = withDefaults(
  defineProps<{
    /** 默认是否展开（未受控时使用） */
    defaultExpanded?: boolean;
    /** 是否展开（v-model:expanded），不传时组件内部自行维护展开状态 */
    expanded?: boolean;
    /** 隐藏是否销毁 */
    hideDestory?: boolean;
    /** 菜单项列表（支持多个，横向 a-menu 展示） */
    items?: SectionMenuItem[];
    /** 当前选中菜单项 key */
    selectedKey?: string;
    /** 标题文本（单菜单项模式时使用；多菜单项模式请用 items） */
    title?: string;
    /** 是否间距 */
    withPadding?: boolean;
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
);

const emit = defineEmits<{
  /** 点击标题栏切换展开状态 */
  'update:expanded': [value: boolean];
  /** 切换选中的菜单项 */
  'update:selectedKey': [value: string];
}>();

/** 菜单项：key + 标签文本 */
export interface SectionMenuItem {
  key: string;
  label: string;
}

// 内部受控状态：父级未传 expanded 时生效
const innerExpanded = ref(props.defaultExpanded);

// 横向 a-menu 由内部 vc-overflow 通过 ResizeObserver 测量宽度来决定 item 是否溢出。
// keep-alive 切走时容器宽度变 0，切回后未重新测量，导致 item 被收进隐藏的
// 溢出下拉而不显示。这里在组件重新激活时通过 key 强制重挂载 a-menu，使其重新测量。
const menuKey = ref(0);
onActivated(() => {
  menuKey.value += 1;
});

// 实际展开状态：优先使用父级受控值
const isExpanded = computed({
  get: () => props.expanded ?? innerExpanded.value,
  set: (val) => {
    innerExpanded.value = val;
    emit('update:expanded', val);
  },
});

const menuItems = computed<SectionMenuItem[]>(() => {
  if (props.items.length > 0) return props.items;
  return props.title ? [{ key: '1', label: props.title }] : [];
});

const selectedKeys = computed(() => {
  if (props.items.length > 0)
    return props.selectedKey ? [props.selectedKey] : [];
  return ['1'];
});

const handleToggle = () => {
  isExpanded.value = !isExpanded.value;
};

const handleMenuClick = ({
  key,
  domEvent,
}: {
  domEvent: PointerEvent;
  key: string;
}) => {
  if (props.items.length > 0) {
    emit('update:selectedKey', key);
  }

  if (props.items.length > 1) {
    // 菜单超过一个点击就不折叠
    domEvent?.stopPropagation();
  }
};
</script>

<template>
  <div class="expand-section bg-white" :class="{ 'px-4': withPadding }">
    <div class="flex items-center border-b border-gray-200 mb-2">
      <!-- 折叠/展开箭头 -->
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
        style="
          height: 45px;
          padding-left: 5px;
          font-size: 15px;
          font-weight: 600;
          line-height: 45px;
        "
        v-else
      >
        {{ menuItems[0].label }}
      </div>
      <!-- 左侧附加区 -->
      <div class="flex items-center gap-3">
        <slot name="extra-left"></slot>
      </div>
      <!-- 右侧操作区（全屏、布局切换等） -->
      <div class="ml-auto flex items-center gap-3">
        <slot name="extra"></slot>
      </div>
    </div>
    <!-- 内容区：按展开状态显示/隐藏 -->
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
