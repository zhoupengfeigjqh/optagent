<!--
 * @Author: Nose陈建
 * @LastEditTime: 2026-09-18 09:59:58
-->
<template>
  <a-modal v-model:open="dialogFormVisible" title="编辑" width="920px">
    <div class="max-h-[500px] overflow-x-hidden overflow-y-auto">
      <a-form :model="formData" :rules="formRules" ref="formRef" :label-col="{ style: { width: formLabelWidth } }">
      <a-row :gutter="10" v-if="formDataItems.length > 10">
        <a-col v-for="item in formDataItems" :key="item.prop" :span="12">
          <a-form-item :label="item.label" :name="item.prop">
            <a-input v-model:value="formData[item.prop]" autocomplete="off" />
          </a-form-item>
        </a-col>
      </a-row>
      <a-form-item v-else v-for="item in formDataItems" :key="item.prop" :label="item.label" :name="item.prop">
        <a-input v-model:value="formData[item.prop]" autocomplete="off" />
      </a-form-item>

    </a-form>
    </div>
    <template #footer>
      <div class="dialog-footer">
        <a-button @click="closeDialog">取消</a-button>
        <a-button type="primary" @click="submitDialog">
          确定
        </a-button>
      </div>
    </template>
  </a-modal>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { message } from 'ant-design-vue'

import {
  editTargetPriorityConfigApi, editSwitchTimeApi, editSolvingTimeApi, editProductionPlanApi, editProductionLineApi, editProductionLineElectricityApi, editProductionCapacityApi,
} from '@/api/datapage'
const emit = defineEmits(['save'])

const dialogFormVisible = ref(false)
const formLabelWidth = '123px'
const formRef = ref(null)
const formData = reactive({})
const formDataItems = ref([])
const pageid = ref("")

//根据当前表列动态生成校验规则（required + 最大长度兜底）
const formRules = reactive({})

//打开弹窗
const openDialog = (pageObj, row, id) => {
  dialogFormVisible.value = true
  pageid.value = id;
  formDataItems.value = pageObj.columns || []
  //动态生成规则：所有列必填
  formDataItems.value.forEach(item => {
    formRules[item.prop] = [{ required: true, message: `请输入${item.label}`, trigger: 'blur' }]
  })
  //清空旧字段后合并新行（formData 是 reactive，不能直接赋值替换）
  Object.keys(formData).forEach(k => delete formData[k])
  Object.assign(formData, row || {})
}
//关闭弹窗
const closeDialog = () => {
  dialogFormVisible.value = false
}

//提交表单
const submitDialog = async () => {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  let res = null
  const row={ ...formData };
  switch (pageid.value) {
    case 'target-priority-config':
      res = await editTargetPriorityConfigApi(row)
      break;
    case 'switch-time':
      res = await editSwitchTimeApi(row)
      break;
    case 'solving-time':
      res = await editSolvingTimeApi(row)
      break;
    case 'production-plan':
      res = await editProductionPlanApi(row)
      break;
    case 'production-line':
      res = await editProductionLineApi(row)
      break;
    case 'production-line-electricity':
      res = await editProductionLineElectricityApi(row)
      break;
    case 'production-capacity':
      res = await editProductionCapacityApi(row)
      break;
  }
  if (res.code === 200) {
    message.success('修改成功')
    emit('save', true)
    closeDialog()
  }

}

defineExpose({
  openDialog,
  closeDialog
})
</script>

<style lang="scss" scoped></style>