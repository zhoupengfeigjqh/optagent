<!--
 * @Author: Nose陈建
 * @LastEditTime: 2026-09-18 16:26:53
-->
<script setup lang="ts">
import { ref } from 'vue';

import { message } from 'ant-design-vue';

import ExpandSection from '#/components/expand-section/expand-section.vue';
import ZGanttTable from '#/components/z-gantt-table/index.vue';

import {
  afterGanttData,
  afterGanttRows,
  beforeGanttData,
  beforeGanttRows,
  buildGanttOption,
  ganttCompareCols,
  ganttStatusColor,
  statusTextMap,
} from '../urgent-insert-result.data';

/**
 * 排产前后甘特图对比区（对应原型「排产前后甘特图对比」卡片）
 * - 上下两个 ZGanttTable：排产前（版本 V1.0）/ 排产后（版本 V2.0）
 * - 左侧表格列：设备/工序、状态（彩色标签）、进度（进度条），通过列 slot 渲染
 * - 甘特图内部：按状态取色、进度局部填充、受影响工序橙色描边、周末灰底、悬浮 tooltip
 * - 底部图例：六种状态色 + 受影响/紧急插单说明
 */

const expanded = ref(true);

// 上下两个甘特图的 Highcharts 配置（数据与配置均为静态，初始化一次即可）
const beforeGanttOption = buildGanttOption(beforeGanttData);
const afterGanttOption = buildGanttOption(afterGanttData);

// 左侧表格列（两个甘特图共用，ZGanttTable 拖拽调宽时会回写）
const compareCols = ref(ganttCompareCols);

// 左侧表格数据：设备 + 行级状态/进度（与甘特图行按 y 序对应）
const beforeTableData = beforeGanttRows.map((d) => ({
  id: d.id,
  name: d.name,
  progress: d.progress,
  status: d.status,
}));
const afterTableData = afterGanttRows.map((d) => ({
  id: d.id,
  name: d.name,
  progress: d.progress,
  status: d.status,
}));

/** 导出对比图 */
const handleExport = () => {
  message.success('已导出对比图');
};

/**
 * 进度条颜色映射（对应原型 getProgressClass：
 * 完工绿 / 执行蓝 / 计划灰 / 预警橙 / 延期红 / 紧急橙）
 */
const progressColorMap: Record<string, string> = {
  completed: '#52c41a',
  inprogress: '#1890ff',
  planned: '#d9d9d9',
  warning: '#fa8c16',
  delayed: '#ff4d4f',
  urgent: '#fa8c16',
};

// 底部图例：与原型一致，「紧急」在图例中展示为「紧急插单」
const legendItems = [
  'completed',
  'inprogress',
  'planned',
  'warning',
  'delayed',
  'urgent',
].map((key) => ({
  color: ganttStatusColor[key],
  key,
  label: key === 'urgent' ? '紧急插单' : statusTextMap[key],
}));
</script>

<template>
  <ExpandSection v-model:expanded="expanded" title="排产前后甘特图对比">
    <template #extra>
      <a-button size="small" @click="handleExport">导出对比图</a-button>
    </template>

    <!--  排产前甘特图（原计划）  -->
    <div class="mb-4  w-full ">
      <div class="mb-1 flex items-center justify-between pr-2">
          <span class="text-sm font-medium">排产前（原计划）</span>
          <a-tag class="!m-0 !bg-gray-100 !px-2 !text-gray-400">
            版本 V1.0
          </a-tag>
        </div>
        <ZGanttTable
          v-model:cols="compareCols"
          :gantt-data="beforeGanttData"
          :gantt-option="beforeGanttOption"
          :table-data="beforeTableData"
          row-key="id"
          :is-fixed-btn="true"
        >
          <!-- 设备/工序：编号 + 名称两行展示（对应原型 cell-task-name） -->
          <template #device="{ record }">
            <div>
              <span class="font-mono text-xs text-gray-500">{{
                record.id
              }}</span>
              <span>{{ record.name }}</span>
            </div>
          </template>
          <!-- 状态：按状态取色的标签 -->
          <template #status="{ record }">
            <a-tag :color="ganttStatusColor[record.status]">
              {{ statusTextMap[record.status] ?? record.status }}
            </a-tag>
          </template>
          <!-- 进度：按状态取色的进度条 -->
          <template #progress="{ record }">
            <div class="h-1.5 w-full overflow-hidden rounded bg-gray-100">
              <div
                class="h-full rounded"
                :style="{
                  width: record.progress + '%',
                  background: progressColorMap[record.status] ? progressColorMap[record.status] : '#d9d9d9',
                }"
              ></div>
            </div>
          </template>
        </ZGanttTable>
    </div>
    <!--  图例  -->
    <div
      class="mt-2 flex flex-wrap items-center gap-4 px-1 text-xs text-gray-600"
    >
      <span
        v-for="item in legendItems"
        :key="item.key"
        class="flex items-center gap-1"
      >
        <span
          class="inline-block h-3 w-3 rounded-sm"
          :style="{ backgroundColor: item.color }"
        ></span>
        {{ item.label }}
      </span>
      <span class="ml-auto text-gray-400">
        橙色边框：受影响工序（计划调整）；紫色：紧急插单工序
      </span>
    </div>
  </ExpandSection>
</template>
