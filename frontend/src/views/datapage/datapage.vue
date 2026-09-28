<template>
  <div class="pagebox">
    <div class="text-[20px] font-bold mb-5">{{ pageObj.name || '表格数据' }}</div>
    <!-- <div class="mb-3 flex items-center justify-between gap-3">
      <a-button type="primary" @click="addRow">
        <iconify-icon icon="solar:add-circle-linear" width="15"></iconify-icon>
        <span class="ml-1">新增一行</span>
      </a-button>
    </div> -->
    <a-table :columns="columns" :data-source="tableData.data" row-key="id" :scroll="{ x: 'max-content' }" :pagination="false">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === '__action'">
          <a-button type="link" size="small" title="编辑" @click="editRow(record)">
            <EditOutlined />
          </a-button>
          <a-button type="link" danger size="small" title="删除" @click="deleteRow(record.id)">
            <DeleteOutlined />
          </a-button>
        </template>
      </template>
    </a-table>
    <div class="mt-3 flex items-center justify-between">
      <div class="text-xs text-[#7c8981]">第 {{ pageState.pageNum }} / {{ total }} 页，共 {{
        total
        }} 条</div>
      <a-pagination v-model:current="pageState.pageNum" :page-size="pageState.pageSize" :total="total"
        @change="fetchData" />
    </div>
    <AddEditDialog ref="addEditDialogRef" @close="closeAddEditDialog" @save="saveHandle" />
  </div>
</template>

<script setup>
import { reactive, computed, onMounted, ref } from 'vue'
import { Modal, message } from 'ant-design-vue'
import { EditOutlined, DeleteOutlined } from '@ant-design/icons-vue';
import { getTableNames } from '@/views/datapage/datapage.data'
import {
  getTargetPriorityConfigListApi, getSwitchTimeListApi, getSolvingTimeListApi, getProductionPlanListApi, getProductionLineListApi, getProductionLineElectricityListApi, getProductionCapacityListApi,

  deleteTargetPriorityConfigApi, deleteSwitchTimeApi, deleteSolvingTimeApi, deleteProductionPlanApi, deleteProductionLineApi, deleteProductionLineElectricityApi, deleteProductionCapacityApi,

  editTargetPriorityConfigApi, editSwitchTimeApi, editSolvingTimeApi, editProductionPlanApi, editProductionLineApi, editProductionLineElectricityApi, editProductionCapacityApi,

} from '@/api/datapage'
import AddEditDialog from './datapage.dialog.vue'
import { useRoute } from 'vue-router'
const route = useRoute()



const props = defineProps({
  //选中的规则ID集合（由父组件持有，供标签高亮同步）
  selectedRuleIds: { type: Array, default: () => [] }
})

const pageid = ref('')
const pageObj = ref('')

const emit = defineEmits(['update:selectedRuleIds'])

/****************** v-model 代理 ******************/

//选中的规则ID集合
const selectedModel = computed({
  get: () => props.selectedRuleIds,
  set: (value) => emit('update:selectedRuleIds', value)
})

/****************** 分页状态 ******************/
//分页状态：{表名: {page}}，page 为 0 基下标
const total = ref(0)
const pageState = reactive({
  pageNum: 1,
  pageSize: 10,
  userId: 111,
  conversationId: '',
  sourceType: '',
  sourceValue: '',
})
const tableData = ref({
  headers: [],
  data: [],
})

//a-table 列配置：由动态表头生成，末尾追加固定右侧的操作列（ellipsis 等价于 show-overflow-tooltip）
const columns = computed(() => [
  ...(tableData.value.headers || []).map(h => ({
    title: h.label,
    dataIndex: h.prop,
    key: h.prop,
    ellipsis: true
  })),
  { title: '操作', key: '__action', fixed: 'right', width: 100, align: 'center' }
])


//获取数据
const fetchData = async () => {
  if (!pageid.value) {
    return
  }
  pageObj.value = getTableNames(pageid.value)
  if (!pageObj.value) {
    return
  }
  tableData.value.headers = pageObj.value.columns || [];

  let res = null
  switch (pageid.value) {
    case 'target-priority-config':
      res = await getTargetPriorityConfigListApi({
        ...pageState
      })
      break;
    case 'switch-time':
      res = await getSwitchTimeListApi({
        ...pageState
      })
      break;
    case 'solving-time':
      res = await getSolvingTimeListApi({
        ...pageState
      })
      break;
    case 'production-plan':
      res = await getProductionPlanListApi({
        ...pageState
      })
      break;
    case 'production-line':
      res = await getProductionLineListApi({
        ...pageState
      })
      break;
    case 'production-line-electricity':
      res = await getProductionLineElectricityListApi({
        ...pageState
      })
      break;
    case 'production-capacity':
      res = await getProductionCapacityListApi({
        ...pageState
      })
      break;
  }

  if (res.code === 200) {
    const data = res.data || {}
    tableData.value.data = data.records || []
    total.value = data.total || 0
    pageState.pageNum = data.pageNum || 1
    pageState.pageSize = data.pageSize || 10
  }
}



/****************** 表格操作 ******************/
//编辑单元格（与原实现一致：@change 时写入数据源）
const editCell = (rowIdx, colIdx, value) => {
  tableData.value.data[rowIdx][colIdx] = value
}
//新增一行
const addRow = () => {
  const ds = tableData.value
  ds.data.push(ds.headers.map(() => ''))
  pageState.pageNum = Math.floor(ds.data.length / pageState.pageSize)
}

//编辑弹框对话框
const addEditDialogRef = ref(null)
const editRow = (row) => {
  addEditDialogRef.value.openDialog(pageObj.value, row,pageid.value)
}
//关闭编辑弹框对话框
const closeAddEditDialog = () => {
  addEditDialogRef.value.closeDialog()
}
const saveHandle = async (status) => {
  fetchData()
}


//删除一行（确认弹窗使用 ant-design-vue 的 Modal.confirm）
const deleteRow = (id) => {
  Modal.confirm({
    title: '删除数据',
    content: '确认删除该行数据？',
    okText: '删除',
    cancelText: '取消',
    okType: 'danger',
    onOk: async () => {
      let res = null
      switch (pageid.value) {
        case 'target-priority-config':
          res = await deleteTargetPriorityConfigApi({
            id: id
          })
          break;
        case 'switch-time':
          res = await deleteSwitchTimeApi({
            id: id
          })
          break;
        case 'solving-time':
          res = await deleteSolvingTimeApi({
            id: id
          })
          break;
        case 'production-plan':
          res = await deleteProductionPlanApi({
            id: id
          })
          break;
        case 'production-line':
          res = await deleteProductionLineApi({
            id: id
          })
          break;
        case 'production-line-electricity':
          res = await deleteProductionLineElectricityApi({
            id: id
          })
          break;
        case 'production-capacity':
          res = await deleteProductionCapacityApi({
            id: id
          })
          break;
      }
      if (res && res.code === 200) {
        message.success('删除成功')
        fetchData()
      }
    }
  })
}


//初始化各表分页状态
onMounted(() => {
  const pageidParam = route.params.pageid
  if (pageidParam) {
    pageid.value = pageidParam
    const { userId, conversationId, sourceType, sourceValue } = route.query
    pageState.userId = userId || 111
    pageState.conversationId = conversationId || ''
    pageState.sourceType = sourceType || ''
    pageState.sourceValue = sourceValue || ''
    fetchData()
  }
})

</script>

<style scoped>
.pagebox {
  padding: 20px;
  height: 100%;
}
</style>
