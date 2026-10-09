<script setup lang="ts">
/**
 * 请求头填写行（2026-10-08；同日两次改版：并入「连接配置」框第二行 → 加**即时校验**与**掩码标绿**）。
 *
 * 交互按"填表"组织（用户视角，一行一件事）：
 * - **留空 = 不修改**：沿用服务端存量，界面回显的掩码不会被当值提交（保存 MUST NOT 顺手清空令牌）；
 * - **填写 = 整体替换**（真实值，仅 `http` 有意义）；
 * - 已配置时给「清空全部请求头」入口（显式点、可撤销）——绝无"看不见就把令牌冲掉"的路径。
 *
 * 两类**就地反馈**（都在这一行内，不必等保存/测试才知道）：
 * - **掩码标绿**：`✓ 当前（掩码）X-MCP-Token: 6UuE…3F` 用成功色——"凭据已配好"一眼可辨；
 * - **格式错误标红**：输入非空且不合规时，标签后就地出现红色「格式错误！」，下方给出可读原因、
 *   输入框描边转红。判据与提交期**同一实现**（`parseHeaders`），避免"这里看着没问题、保存却报错"。
 *
 * 回显只有**掩码**（真值不出现在任何响应里），因此输入框**不预填**：要改就得整段重填。
 */
import { computed } from 'vue'
import { MCP_HEADERS_HINT, MCP_HEADERS_PLACEHOLDER } from '../../constants/mcp'
import { parseHeaders } from '../../utils/mcp-config'

const props = withDefaults(
  defineProps<{
    /** 展示用的掩码请求头（来自详情，或最近一次保存响应）；空对象 = 未配置 */
    headers: Record<string, string>
    /** 输入框内容（留空 = 不修改） */
    text: string
    /** 清空意图：勾选后提交 `{}`（显式清空全部） */
    clearing: boolean
    /** 输入框 id——同一页面可能同时存在新建弹窗与详情表单，id 必须唯一 */
    inputId?: string
    /** 覆盖默认说明（新建态用"留空 = 不带请求头"的口径） */
    hintText?: string
  }>(),
  { inputId: 'mcp-headers', hintText: '' },
)

const emit = defineEmits<{
  (e: 'update:text', value: string): void
  (e: 'update:clearing', value: boolean): void
}>()

const hasHeaders = computed(() => Object.keys(props.headers).length > 0)

/** 现有请求头的掩码一览（`X-MCP-Token: 6UuE…3F`） */
const currentText = computed(() =>
  Object.entries(props.headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join('、'),
)

/**
 * 输入的**即时校验**：留空不算错（= 不修改）；非空则以 `parseHeaders` 为准。
 *
 * 与提交期同一实现：两边判据若各写一套，必然漂移成"这里绿的、保存却报错"。
 */
const inputError = computed<string | null>(() => {
  if (props.clearing) return null
  if (props.text.trim() === '') return null
  return parseHeaders(props.text).error ?? null
})

/** 编辑占位示例：带上已有的头名，省得管理员去别处抄（值仍须自己填） */
const placeholder = computed(() => {
  const names = Object.keys(props.headers)
  return names.length > 0 ? `{"${names[0]}":"你的真实令牌"}` : MCP_HEADERS_PLACEHOLDER
})
</script>

<template>
  <div class="mcp-headers">
    <label class="field" :for="inputId">
      <span class="field__label">
        请求头（可空）
        <!-- 就地标红：格式不合规时，不必等"保存/发起测试"才发现 -->
        <span v-if="inputError" class="mcp-headers__invalid" data-test="headers-invalid">
          格式错误！
        </span>
      </span>
      <textarea
        :id="inputId"
        :value="text"
        rows="2"
        data-test="headers-input"
        :class="{ invalid: inputError !== null }"
        :placeholder="placeholder"
        :disabled="clearing"
        :aria-invalid="inputError !== null"
        :aria-describedby="inputError ? `${inputId}-error` : undefined"
        @input="emit('update:text', ($event.target as HTMLTextAreaElement).value)"
      />
    </label>

    <p
      v-if="inputError"
      :id="`${inputId}-error`"
      class="mcp-headers__error"
      role="alert"
      data-test="headers-error"
    >
      {{ inputError }}
    </p>

    <!-- 已配置 → 掩码一览**标绿**：能看出"配了哪些头"，但看不到真值 -->
    <p v-if="hasHeaders" class="field__hint" data-test="headers-view">
      <span class="mcp-headers__ok"><span aria-hidden="true">✓</span> 当前（掩码）</span>：
      <span class="mono mcp-headers__current">{{ currentText }}</span>
    </p>
    <p v-if="clearing" class="mcp-headers__warning" role="alert" data-test="headers-clear-warning">
      保存后该服务的<strong>全部请求头将被清除</strong>；需要令牌的服务会开始返回 401。
    </p>

    <span v-if="hintText" class="field__hint">{{ hintText }}</span>
    <span v-else class="field__hint">
      {{ MCP_HEADERS_HINT }}。<strong>留空 = 不修改</strong>（已配置的令牌不会因保存被清掉）。
      需要访问令牌的服务（如本体侧「自建发布」的
      <span class="mono">X-MCP-Token</span>）填在此处，否则连接与创建都会 401。
    </span>

    <div v-if="hasHeaders" class="mcp-headers__actions">
      <button
        v-if="!clearing"
        type="button"
        class="btn"
        data-test="clear-headers"
        @click="emit('update:clearing', true)"
      >
        清空全部请求头
      </button>
      <button
        v-else
        type="button"
        class="btn"
        data-test="undo-clear-headers"
        @click="emit('update:clearing', false)"
      >
        撤销清空
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 掩码（已配置凭据）：用成功色——"这个服务配好了"一眼可辨 */
.mcp-headers__ok {
  color: var(--color-status-success);
  font-weight: 600;
}

.mcp-headers__current {
  color: var(--color-status-success);
  overflow-wrap: anywhere;
}

/* 格式不合规：标签后的红色标记 + 可读原因 + 输入框描红（与全站 invalid 惯例一致） */
.mcp-headers__invalid {
  margin-left: var(--space-2);
  color: var(--color-status-error);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

.mcp-headers__error {
  margin: var(--space-1) 0 0;
  color: var(--color-status-error);
  font-size: var(--font-size-xs);
  overflow-wrap: anywhere;
}

textarea.invalid {
  border-color: var(--color-status-error);
}

.mcp-headers__warning {
  margin: var(--space-2) 0 0;
  color: var(--color-status-error);
  font-size: var(--font-size-sm);
}

.mcp-headers__actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
</style>
