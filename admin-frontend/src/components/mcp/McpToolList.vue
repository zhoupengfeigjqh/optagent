<script setup lang="ts">
/**
 * MCP 工具清单（`FR-045`、`FR-063`）：展示该服务**对该数字人可见的**工具，
 * 含每个工具的用途与入参说明，**有界返回**。
 *
 * 两条口径（2026-10-03 起）：
 * - **只显示白名单里的工具**：服务其余工具一律不呈现——管理员看到的即"数字人能看到的"
 *   （白名单为空 = 存量服务不限制，此时即服务全量）；
 * - **白名单失效要标异常**：白名单里、但服务当前清单中已不存在的工具（下架/改名）
 *   用 `missingTools` 呈现并打叹号——**探测失败时不能这么判**（核对不了 ≠ 不存在），
 *   那种情况只由 `errorMessage` 说明"服务不可达"。
 *
 * 清单是**打开详情那一刻**平台对服务的实时探测结果，界面不会自动重取
 * （保存配置也刻意不重探，避免依赖清单的渲染分支抖动）——服务后启动或工具
 * 改版后，由管理员点「重新探测」显式刷新（2026-10-02）。
 *
 * **2026-10-15 起「重新探测」还兼作调整入口**：探测成功后父级会打开工具范围弹窗
 * （`McpToolScopeDialog`），在那里增减可见工具。本组件只管把清单如实画出来 +
 * 把点击抛上去，**不含任何勾选态**（那是弹窗的事，避免两处各持一份范围）。
 */
import { computed } from 'vue'
import type { McpToolInfo } from '../../api/types'

const props = withDefaults(
  defineProps<{
    /** 白名单里的**可见**工具（顺序与白名单一致） */
    tools: McpToolInfo[]
    /** 白名单本身（用于按白名单顺序渲染与计数）；缺省 = 不限制 */
    allowedTools?: string[]
    /** 白名单里当前服务不存在的工具名（探测失败时恒为空） */
    missingTools?: string[]
    truncated: boolean
    /** 工具清单不可得时的可读原因（`FR-009`：不静默省略） */
    errorMessage?: string | null
    /** 重新探测进行中（详情正在重取）：按钮禁用，防重复点击 */
    busy?: boolean
  }>(),
  // 缺省 = 不限制（与后端语义一致）：缺字段时退化为"显示全量"，而不是整块渲染失败
  { allowedTools: () => [], missingTools: () => [], errorMessage: null, busy: false },
)

const emit = defineEmits<{ reprobe: [] }>()

/** 是否有白名单失效项（有则顶部给汇总，逐条另有叹号） */
const hasMissing = computed(() => props.missingTools.length > 0)
/** 探测失败：此时**无法核对**白名单，MUST NOT 把工具判成"不存在" */
const unreachable = computed(() => Boolean(props.errorMessage))
/** 按工具名索引命中的描述（缺失项没有可展示的说明） */
const byName = computed(() => new Map(props.tools.map((tool) => [tool.name, tool])))
/**
 * 渲染基准：**有白名单就按白名单**（含失效项，逐条标异常）；白名单为空（存量服务 =
 * 不限制）则按服务全量——两种情形都必须有内容，MUST NOT 出现空白清单。
 */
const rows = computed<string[]>(() =>
  props.allowedTools.length > 0 ? props.allowedTools : props.tools.map((tool) => tool.name),
)
/**
 * 「可回写结果」标注的悬停说明。
 *
 * 判据与运行环境**同一口径**：工具的 `inputSchema.properties` 里声明了 `resultUrl`，
 * 运行环境就会为它注入签名回写地址（见 `agent-backend/src/infra/mcp/async-result-url.ts`）。
 */
const ASYNC_TOOL_HINT =
  '该工具的入参声明了 resultUrl：调用时运行环境会注入签名回写地址，服务算完可把结果写回文件后台（临时空间/后台产出）'

/** 该工具的入参 schema 是否声明了 `resultUrl`（只认 `properties`，`required` 里出现不算） */
function declaresResultUrl(parameters: unknown): boolean {
  if (typeof parameters !== 'object' || parameters === null) return false
  const properties = (parameters as { properties?: unknown }).properties
  if (typeof properties !== 'object' || properties === null) return false
  return 'resultUrl' in properties
}

/**
 * 可回写结果的工具名（用于标绿 + 紧贴工具名加「（可回写结果）」）。
 *
 * 失效项（`missingTools`）不在 `tools` 里，故天然不会被标绿——工具都不存在了，
 * 谈"能不能回写"没有意义。
 */
const asyncTools = computed(
  () => new Set(props.tools.filter((tool) => declaresResultUrl(tool.parameters)).map((t) => t.name)),
)
</script>

<template>
  <section class="mcp-tool-list" aria-label="MCP 工具清单">
    <div class="mcp-tool-list__toolbar">
      <p class="mcp-tool-list__caption">
        本清单为该服务<strong>对数字人可见的工具</strong>；这是打开本详情时的实时探测结果，
        服务后启动或工具改版后不会自动更新。<strong>点「重新探测」</strong>会重取清单并弹出
        工具范围窗，在那里增减可见工具。工具名<strong>标绿并带「（可回写结果）」</strong>表示
        其入参声明了 <code>resultUrl</code>：结果可回写到文件后台。
      </p>
      <button
        type="button"
        class="btn"
        data-test="reprobe"
        :disabled="props.busy === true"
        @click="emit('reprobe')"
      >
        {{ props.busy ? '探测中…' : '重新探测' }}
      </button>
    </div>

    <p v-if="props.errorMessage" class="mcp-tool-list__error" role="alert">
      工具清单不可得：{{ props.errorMessage }}——<strong>当前无法核对工具是否仍存在</strong>，
      请先确认服务可达后重新探测。
    </p>

    <p
      v-else-if="hasMissing"
      class="mcp-tool-list__missing"
      role="alert"
      data-test="missing-summary"
    >
      ⚠ 工具范围中有 {{ props.missingTools.length }} 个工具在当前服务清单里已不存在（下架或改名），
      它们对数字人不可用：<span class="mono">{{ props.missingTools.join('、') }}</span>
    </p>

    <p v-if="!unreachable && props.allowedTools.length === 0" class="muted">
      该服务未限定工具范围（存量配置）：下列为服务的全部工具。
    </p>

    <p v-if="!unreachable && rows.length === 0" class="muted">该服务未声明任何工具。</p>

    <!-- 按白名单顺序渲染：命中项显示说明与入参，缺失项显示异常 -->
    <ul v-if="!unreachable && rows.length > 0" class="mcp-tool-list__items" data-test="tools">
      <li
        v-for="toolName in rows"
        :key="toolName"
        class="mcp-tool-list__item"
        :class="{ 'mcp-tool-list__item--missing': props.missingTools.includes(toolName) }"
      >
        <p
          class="mcp-tool-list__name mono"
          :class="{ 'mcp-tool-list__name--async': asyncTools.has(toolName) }"
        >
          <span
            v-if="props.missingTools.includes(toolName)"
            class="mcp-tool-list__warn"
            aria-hidden="true"
          >⚠</span>{{ toolName }}<span
            v-if="asyncTools.has(toolName)"
            class="mcp-tool-list__flag"
            :title="ASYNC_TOOL_HINT"
          >（可回写结果）</span>
          <span v-if="props.missingTools.includes(toolName)" class="mcp-tool-list__badge">
            已不存在
          </span>
        </p>
        <template v-if="byName.get(toolName)">
          <p class="mcp-tool-list__desc">
            {{ byName.get(toolName)?.description || '（无说明）' }}
          </p>
          <details class="mcp-tool-list__params">
            <summary>入参说明</summary>
            <pre class="mono">{{ JSON.stringify(byName.get(toolName)?.parameters, null, 2) }}</pre>
          </details>
        </template>
        <p v-else class="mcp-tool-list__desc">
          该工具在当前服务清单中不存在（已下架或改名）——数字人无法调用它。
          如需移除它，点「重新探测」后在工具范围窗里取消勾选即可。
        </p>
      </li>
    </ul>

    <p v-if="props.truncated" class="field__hint">工具数量超过上限，仅显示前若干项。</p>
  </section>
</template>

<style scoped>
.mcp-tool-list__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.mcp-tool-list__caption {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.mcp-tool-list__error {
  margin: 0;
  color: var(--color-status-error);
  font-size: var(--font-size-sm);
}

/* 白名单失效汇总：警告色（不是错误——服务本身没问题，是范围漂移了） */
.mcp-tool-list__missing {
  margin: 0 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-status-warning);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
}

.mcp-tool-list__items {
  margin: 0;
  padding: 0;
  list-style: none;
}

.mcp-tool-list__item + .mcp-tool-list__item {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.mcp-tool-list__item--missing .mcp-tool-list__name {
  color: var(--color-status-warning);
}

.mcp-tool-list__badge {
  margin-left: var(--space-2);
  padding: 0 var(--space-1);
  border: 1px solid var(--color-status-warning);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
}

.mcp-tool-list__name {
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: 600;
  /* 标注必须**紧贴**工具名：用 flex 排布，元素间不产生模板空白（零 gap） */
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
}

/* 声明了 resultUrl 的工具：工具名整体标绿（颜色 + 文字标注双通道，原则四） */
.mcp-tool-list__name--async {
  color: var(--color-status-success);
}

/* flex 下不再有模板空白，失效标记与工具名之间的间距显式给出 */
.mcp-tool-list__warn {
  margin-right: var(--space-1);
}

.mcp-tool-list__flag {
  font-weight: 500;
}

.mcp-tool-list__desc {
  margin: var(--space-1) 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.mcp-tool-list__params summary {
  cursor: pointer;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.mcp-tool-list__params pre {
  margin: var(--space-1) 0 0;
  padding: var(--space-2);
  background: var(--color-bg-muted);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  overflow-x: auto;
}
</style>
