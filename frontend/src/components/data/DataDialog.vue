<template>
  <a-modal v-model:open="visibleModel" width="1160px" style="top: 7vh">
    <template #title>
      <div class="flex items-center gap-2.5">
        <iconify-icon class="text-[#1d6b54]" icon="solar:database-linear" width="20"></iconify-icon>
        <span class="text-[17px] font-semibold text-[#14241c]">输入数据</span>
      </div>
    </template>

    <a-tabs v-model:activeKey="tabModel">
      <a-tab-pane v-for="name in TABLE_NAMES" :key="name" :tab="name">
        <!-- 仅渲染当前激活标签页的内容，避免隐藏面板重复渲染表格 -->
        <template v-if="name === tabModel">
          <!-- 表格面板 -->
          <template v-if="name !== '使用规则'">
            <div class="mb-3 flex items-center justify-between gap-3">
              <div class="flex items-center gap-2 text-[13px] text-[#5d6a62]">
                <iconify-icon class="text-[#1d6b54]" icon="solar:table-linear" width="17"></iconify-icon>
                <span>共 <b>{{ currentTableRows.length }}</b> 条数据，可增删改</span>
              </div>
              <a-button type="primary" @click="addRow">
                <iconify-icon icon="solar:add-circle-linear" width="15"></iconify-icon>
                <span class="ml-1">新增一行</span>
              </a-button>
            </div>
            <!-- 行数据为数组：dataIndex 用列下标取值 -->
            <a-table :columns="dialogColumns" :data-source="currentPageRows" :pagination="false" :scroll="{ y: '52vh' }"
              size="middle" :locale="{ emptyText: '暂无数据，点击右上角「新增一行」添加' }">
              <template #bodyCell="{ column, record, index }">
                <template v-if="column.key === '__action'">
                  <a-button type="link" danger size="small" title="删除该行" @click="deleteRow(currentPageStart + index)">
                    <iconify-icon icon="solar:trash-bin-trash-linear" width="15"></iconify-icon>
                  </a-button>
                </template>
                <!-- 原生 input：500 个 a-input 实例会导致弹框打开时长时间阻塞渲染 -->
                <input v-else class="cell-input" :value="record[column.dataIndex]"
                  @change="e => editCell(currentPageStart + index, column.dataIndex, e.target.value)" />
              </template>
            </a-table>
            <div class="mt-3 flex items-center justify-between">
              <div class="text-xs text-[#7c8981]">第 {{ currentPage + 1 }} / {{ currentTotalPages }} 页，共 {{
                currentTableRows.length }} 条</div>
              <a-pagination v-model:current="pageModel" :page-size="PAGE_SIZE" :total="currentTableRows.length" />
            </div>
          </template>
          <!-- 使用规则面板 -->
          <template v-else>
            <div class="mb-3 flex items-center justify-between gap-3">
              <div class="flex items-center gap-2 text-[13px] text-[#5d6a62]">
                <iconify-icon class="text-[#1d6b54]" icon="solar:tuning-2-linear" width="17"></iconify-icon>
                <span>已选用 <b>{{ selectedModel.length }}</b> 条规则</span>
              </div>
              <div class="flex items-center gap-2">
                <a-button @click="selectAllRules">全选</a-button>
                <a-button @click="clearRules">清空</a-button>
              </div>
            </div>
            <div class="mb-4 flex flex-wrap gap-2 rounded-xl border border-[#e5eae4] bg-[#fafbf9] p-3">
              <template v-if="selectedModel.length">
                <a-tag v-for="r in selectedRules" :key="r.id" color="success" class="rounded-full">
                  <iconify-icon icon="solar:check-circle-bold" width="13"></iconify-icon>{{ r.name }}
                </a-tag>
              </template>
              <span v-else class="text-xs text-[#9aa39c]">尚未选用任何规则</span>
            </div>
            <a-checkbox-group v-model:value="selectedModel" class="flex flex-col gap-2.5">
              <a-checkbox v-for="r in RULE_ITEMS" :key="r.id" :value="r.id"
                class="!m-0 w-full rounded-xl border border-[#e5eae4] px-4 py-2.5">
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-medium text-[#2a352e]">{{ r.name }}</div>
                  <div class="mt-0.5 text-xs text-[#7c8981]">{{ r.desc }}</div>
                </div>
              </a-checkbox>
            </a-checkbox-group>
          </template>
        </template>
      </a-tab-pane>
    </a-tabs>
  </a-modal>
</template>

<script setup>
import { reactive, computed, onMounted } from 'vue'
import { Modal } from 'ant-design-vue'
import { TABLE_DATA, TABLE_NAMES, RULE_ITEMS } from '@/views/tableData'

const props = defineProps({
  //是否显示
  modelValue: { type: Boolean, default: false },
  //当前数据标签
  tab: { type: String, default: TABLE_NAMES[0] },
  //选中的规则ID集合（由父组件持有，供标签高亮同步）
  selectedRuleIds: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:modelValue', 'update:tab', 'update:selectedRuleIds'])

/****************** v-model 代理 ******************/
//是否显示
const visibleModel = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})
//当前数据标签（a-tabs 的 activeKey 直接使用标签名）
const tabModel = computed({
  get: () => props.tab,
  set: (value) => emit('update:tab', value)
})
//选中的规则ID集合
const selectedModel = computed({
  get: () => props.selectedRuleIds,
  set: (value) => emit('update:selectedRuleIds', value)
})

/****************** 分页状态 ******************/
//分页状态：{表名: {page}}，page 为 0 基下标
const pageState = reactive({})
//每页条数
const PAGE_SIZE = 50
//初始化各表分页状态
onMounted(() => {
  TABLE_NAMES.filter(n => n !== '使用规则').forEach(n => {
    if (!pageState[n]) pageState[n] = { page: 0 }
  })
})

//当前表数据
const currentTableData = computed(() => TABLE_DATA[props.tab] || { headers: [], rows: [] })
//当前表头
const currentTableHeaders = computed(() => currentTableData.value.headers)
//当前表所有行
const currentTableRows = computed(() => currentTableData.value.rows)
//a-table 列配置：行数据为数组，dataIndex 用列下标取值；固定列宽避免 scroll.x 测量所有单元格（强制回流）；末尾追加固定右侧的操作列
const dialogColumns = computed(() => [
  ...currentTableHeaders.value.map((h, cIdx) => ({ title: h, dataIndex: cIdx, key: 'col-' + cIdx, width: 150 })),
  { title: '操作', key: '__action', fixed: 'right', width: 72, align: 'center' }
])
//当前页（0基）
const currentPage = computed(() => pageState[props.tab]?.page || 0)
//总页数
const currentTotalPages = computed(() => Math.max(1, Math.ceil(currentTableRows.value.length / PAGE_SIZE)))
//当前页起始下标
const currentPageStart = computed(() => currentPage.value * PAGE_SIZE)
//当前页行数据
const currentPageRows = computed(() => currentTableRows.value.slice(currentPageStart.value, currentPageStart.value + PAGE_SIZE))
//a-pagination 页码（1基）与内部 0 基分页互转
const pageModel = computed({
  get: () => currentPage.value + 1,
  set: (value) => {
    const st = pageState[props.tab]
    if (st) st.page = value - 1
  }
})

/****************** 表格操作 ******************/
//编辑单元格（与原实现一致：@change 时写入数据源）
const editCell = (rowIdx, colIdx, value) => {
  TABLE_DATA[props.tab].rows[rowIdx][colIdx] = value
}
//新增一行
const addRow = () => {
  const ds = TABLE_DATA[props.tab]
  ds.rows.push(ds.headers.map(() => ''))
  pageState[props.tab].page = Math.floor(ds.rows.length / PAGE_SIZE)
}
//删除一行（确认弹窗使用 ant-design-vue 的 Modal.confirm）
const deleteRow = (idx) => {
  Modal.confirm({
    title: '删除数据',
    content: '确认删除第 ' + (idx + 1) + ' 行数据？',
    okText: '删除',
    cancelText: '取消',
    okType: 'danger',
    onOk: () => {
      const ds = TABLE_DATA[props.tab]
      ds.rows.splice(idx, 1)
      const st = pageState[props.tab]
      if (st.page > 0 && st.page * PAGE_SIZE >= ds.rows.length) st.page--
    }
  })
}

/****************** 规则 ******************/
//已选中的规则列表
const selectedRules = computed(() => RULE_ITEMS.filter(r => props.selectedRuleIds.includes(r.id)))
//全选规则
const selectAllRules = () => {
  selectedModel.value = RULE_ITEMS.map(r => r.id)
}
//清空规则
const clearRules = () => {
  selectedModel.value = []
}
</script>

<style scoped>
/* 单元格输入框：模拟 a-input 的观感，但避免每格挂载一个组件实例 */
.cell-input {
  width: 100%;
  min-width: 0;
  padding: 4px 8px;
  font-size: 13px;
  line-height: 20px;
  color: #435149;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 6px;
  outline: none;
  transition: border-color .15s, background-color .15s;
}
.cell-input:hover {
  background: #f4f7f3;
}
.cell-input:focus {
  background: #fff;
  border-color: #79ad96;
  box-shadow: 0 0 0 2px rgba(121, 173, 150, .15);
}
</style>
