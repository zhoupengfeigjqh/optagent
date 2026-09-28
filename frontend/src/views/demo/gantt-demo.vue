<script setup lang="ts">
import ZGantt from '#/components/z-gantt/index.vue';
import ZGanttTable from '#/components/z-gantt-table/index.vue';
import dayjs from 'dayjs';
import { ref, onMounted } from 'vue';


const ganttData = ref<any[]>([
  {
    name: '任务001',
    id: 'task-001',
    start: Date.UTC(2024, 0, 1),
    end: Date.UTC(2024, 0, 8),
    y: 0,
  },
  {
    name: '任务002',
    id: 'task-002',
    start: Date.UTC(2024, 0, 3),
    end: Date.UTC(2024, 0, 15),
    y: 1,
  },
  {
    name: '任务003',
    id: 'task-003',
    start: Date.UTC(2024, 0, 6),
    end: Date.UTC(2024, 0, 20),
    y: 2,
  },
  {
    name: '任务004',
    id: 'task-004',
    start: Date.UTC(2024, 0, 9),
    end: Date.UTC(2024, 0, 25),
    y: 3,
  },
  {
    name: '任务005',
    id: 'task-005',
    start: Date.UTC(2024, 0, 12),
    end: Date.UTC(2024, 0, 30),
    y: 4,
  },
  {
    name: '任务006',
    id: 'task-006',
    start: Date.UTC(2024, 0, 15),
    end: Date.UTC(2024, 1, 5),
    y: 5,
  },
  {
    name: '任务007',
    id: 'task-007',
    start: Date.UTC(2024, 0, 18),
    end: Date.UTC(2024, 1, 10),
    y: 6,
  },
  {
    name: '任务008',
    id: 'task-008',
    start: Date.UTC(2024, 0, 21),
    end: Date.UTC(2024, 1, 15),
    y: 7,
  },
  {
    name: '任务009',
    id: 'task-009',
    start: Date.UTC(2024, 0, 24),
    end: Date.UTC(2024, 1, 20),
    y: 8,
  },
  {
    name: '任务010',
    id: 'task-010',
    start: Date.UTC(2024, 0, 27),
    end: Date.UTC(2024, 1, 25),
    y: 9,
  },
  {
    name: '任务011',
    id: 'task-011',
    start: Date.UTC(2024, 1, 1),
    end: Date.UTC(2024, 1, 12),
    y: 10,
  },
  {
    name: '任务012',
    id: 'task-012',
    start: Date.UTC(2024, 1, 4),
    end: Date.UTC(2024, 1, 18),
    y: 11,
  },
  {
    name: '任务013',
    id: 'task-013',
    start: Date.UTC(2024, 1, 7),
    end: Date.UTC(2024, 2, 1),
    y: 12,
  },
  {
    name: '任务014',
    id: 'task-014',
    start: Date.UTC(2024, 1, 10),
    end: Date.UTC(2024, 2, 6),
    y: 13,
  },
  {
    name: '任务015',
    id: 'task-015',
    start: Date.UTC(2024, 1, 13),
    end: Date.UTC(2024, 2, 11),
    y: 14,
  },
  {
    name: '任务016',
    id: 'task-016',
    start: Date.UTC(2024, 1, 16),
    end: Date.UTC(2024, 2, 16),
    y: 15,
  },
  {
    name: '任务017',
    id: 'task-017',
    start: Date.UTC(2024, 1, 19),
    end: Date.UTC(2024, 2, 21),
    y: 16,
  },
  {
    name: '任务018',
    id: 'task-018',
    start: Date.UTC(2024, 1, 22),
    end: Date.UTC(2024, 2, 26),
    y: 17,
  },
  {
    name: '任务019',
    id: 'task-019',
    start: Date.UTC(2024, 1, 25),
    end: Date.UTC(2024, 3, 3),
    y: 18,
  },
  {
    name: '任务020',
    id: 'task-020',
    start: Date.UTC(2024, 1, 28),
    end: Date.UTC(2024, 3, 8),
    y: 19,
  },
  {
    name: '任务021',
    id: 'task-021',
    start: Date.UTC(2024, 2, 2),
    end: Date.UTC(2024, 3, 13),
    y: 20,
  },
  {
    name: '任务022',
    id: 'task-022',
    start: Date.UTC(2024, 2, 5),
    end: Date.UTC(2024, 3, 18),
    y: 21,
  },
  {
    name: '任务023',
    id: 'task-023',
    start: Date.UTC(2024, 2, 8),
    end: Date.UTC(2024, 3, 23),
    y: 22,
  },
  {
    name: '任务024',
    id: 'task-024',
    start: Date.UTC(2024, 2, 11),
    end: Date.UTC(2024, 3, 28),
    y: 23,
  },
  {
    name: '任务025',
    id: 'task-025',
    start: Date.UTC(2024, 2, 14),
    end: Date.UTC(2024, 4, 2),
    y: 24,
  },
  {
    name: '任务026',
    id: 'task-026',
    start: Date.UTC(2024, 2, 17),
    end: Date.UTC(2024, 4, 7),
    y: 25,
  },
  {
    name: '任务027',
    id: 'task-027',
    start: Date.UTC(2024, 2, 20),
    end: Date.UTC(2024, 4, 12),
    y: 26,
  },
  {
    name: '任务028',
    id: 'task-028',
    start: Date.UTC(2024, 2, 23),
    end: Date.UTC(2024, 4, 17),
    y: 27,
  },
  {
    name: '任务029',
    id: 'task-029',
    start: Date.UTC(2024, 2, 26),
    end: Date.UTC(2024, 4, 22),
    y: 28,
  },
  {
    name: '任务030',
    id: 'task-030',
    start: Date.UTC(2024, 2, 29),
    end: Date.UTC(2024, 4, 27),
    y: 29,
  },
  {
    name: '任务031',
    id: 'task-031',
    start: Date.UTC(2024, 3, 3),
    end: Date.UTC(2024, 5, 2),
    y: 30,
  },
  {
    name: '任务032',
    id: 'task-032',
    start: Date.UTC(2024, 3, 6),
    end: Date.UTC(2024, 5, 7),
    y: 31,
  },
  {
    name: '任务033',
    id: 'task-033',
    start: Date.UTC(2024, 3, 9),
    end: Date.UTC(2024, 5, 12),
    y: 32,
  },
  {
    name: '任务034',
    id: 'task-034',
    start: Date.UTC(2024, 3, 12),
    end: Date.UTC(2024, 5, 17),
    y: 33,
  },
  {
    name: '任务035',
    id: 'task-035',
    start: Date.UTC(2024, 3, 15),
    end: Date.UTC(2024, 5, 22),
    y: 34,
  },
  {
    name: '任务036',
    id: 'task-036',
    start: Date.UTC(2024, 3, 18),
    end: Date.UTC(2024, 5, 27),
    y: 35,
  },
  {
    name: '任务037',
    id: 'task-037',
    start: Date.UTC(2024, 3, 21),
    end: Date.UTC(2024, 6, 1),
    y: 36,
  },
  {
    name: '任务038',
    id: 'task-038',
    start: Date.UTC(2024, 3, 24),
    end: Date.UTC(2024, 6, 6),
    y: 37,
  },
  {
    name: '任务039',
    id: 'task-039',
    start: Date.UTC(2024, 3, 27),
    end: Date.UTC(2024, 6, 11),
    y: 38,
  },
  {
    name: '任务040',
    id: 'task-040',
    start: Date.UTC(2024, 3, 30),
    end: Date.UTC(2024, 6, 16),
    y: 39,
  },
  {
    name: '任务041',
    id: 'task-041',
    start: Date.UTC(2024, 4, 3),
    end: Date.UTC(2024, 6, 21),
    y: 40,
  },
  {
    name: '任务042',
    id: 'task-042',
    start: Date.UTC(2024, 4, 6),
    end: Date.UTC(2024, 6, 26),
    y: 41,
  },
  {
    name: '任务043',
    id: 'task-043',
    start: Date.UTC(2024, 4, 9),
    end: Date.UTC(2024, 7, 1),
    y: 42,
  },
  {
    name: '任务044',
    id: 'task-044',
    start: Date.UTC(2024, 4, 12),
    end: Date.UTC(2024, 7, 6),
    y: 43,
  },
  {
    name: '任务045',
    id: 'task-045',
    start: Date.UTC(2024, 4, 15),
    end: Date.UTC(2024, 7, 11),
    y: 44,
  },
  {
    name: '任务046',
    id: 'task-046',
    start: Date.UTC(2024, 4, 18),
    end: Date.UTC(2024, 7, 16),
    y: 45,
  },
  {
    name: '任务047',
    id: 'task-047',
    start: Date.UTC(2024, 4, 21),
    end: Date.UTC(2024, 7, 21),
    y: 46,
  },
  {
    name: '任务048',
    id: 'task-048',
    start: Date.UTC(2024, 4, 24),
    end: Date.UTC(2024, 7, 26),
    y: 47,
  },
  {
    name: '任务049',
    id: 'task-049',
    start: Date.UTC(2024, 4, 27),
    end: Date.UTC(2024, 8, 1),
    y: 48,
  },
  {
    name: '任务050',
    id: 'task-050',
    start: Date.UTC(2024, 4, 30),
    end: Date.UTC(2024, 8, 6),
    y: 49,
  },
]);

ganttData.value = [];

const colors = [
  '#FF6B6B',
  '#4ECDC4',
  '#45B7D1',
  '#96CEB4',
  '#FECA57',
  '#FF9FF3',
  '#54A0FF',
  '#5F27CD',
  '#00D2D3',
  '#FF9F43',
];

const ganttOption = {
  // 全局图表样式
  chart: {
    spacingTop: 10,
    spacingBottom: 10,
    // 移除所有间距和边距
    spacingRight: 0,
    // marginLeft: 1, // 关键
    marginRight: 0,
    // 关键：强制绘图区域左移到最左边
    plotLeft: 0,
    scrollablePlotArea: {
      opacity: 0.5,
      minWidth: 1000, // 内容的最小宽度
      minHeight: 400,
      scrollPositionX: 0, // 初始水平滚动位置
    },
  },
  boost: {
    useGPUTranslations: true, // GPU硬件加速，WebGL绘制替代SVG
    boostThreshold: 3000, // 超过3000条自动切Boost画布渲染
  },
  tooltip: {
    enabled: false,
  },
  plotOptions: {
    gantt: {
      turboThreshold: 0, // 取消DOM节点数量限制，关键配置
      animation: false,
      pointPadding: 0.1,
    },
    series: {
      dragDrop: {
        draggableX: true, // 是否可以左右拖动
        draggableY: false, // 是否可以上下拖动
      },
    },
  },
  rangeSelector: {
    enabled: true,
    verticalAlign: 'top',
    y: 0,
    floating: false,
  },
  // navigator: {
  //   enabled: true,
  //   height: 36, // 导航条高度自定义
  //   margin: 12, // navigator与下方甘特绘图区间距
  //   series: {
  //     type: 'gantt',
  //     fillOpacity: 0.35,
  //     pointPadding: 0.1,
  //   },
  // },
  yAxis: {
    type: 'category',
    // 移除 categories 配置，避免空间预留
    categories: Array.from({ length: 10 }, (_, index) => `任务${index}`),
    min: 0,
    max: 20,
    // lineWidth: 1,
  },
  series: [
    {
      turboThreshold: 0,
      name: '示例项目',
      data: ganttData.value.map((item: any) => ({
        ...item,
        color: colors[Math.floor(Math.random() * colors.length)],
      })),
    },
  ],
};

const tableData = ref(
  Array.from(
    { length: 21 },
    (_, index) => `任务${index}sdsdssssssssssssssssssssssssssss`,
  ).map((item) => ({
    test: item,
    test2: 'fake data',
  })),
);

const ganttTalbeOption = {
  ...ganttOption,
};

const handlePointClickMouseY = (event: any) => {
  console.log('abcefg', event);
};

// setTimeout(() => {
//   const baseStart = ganttData.value[ganttData.value.length - 1].start;
//   const baseEnd = ganttData.value[ganttData.value.length - 1].end;
//   const oneDay = 24 * 3600 * 1000;
//   let data = [];
//   for (let i = 0; i < 10000; i++) {
//     data.push({
//       name: `任务${baseStart + oneDay * (i + 1)}`,
//       id: `task${baseStart + oneDay * (i + 1)}`,
//       start: baseStart + oneDay * (i + 1),
//       end: baseEnd + oneDay * (i + 1),
//       y: i % 3,
//     });
//   }
//   ganttData.value = [...ganttData.value, ...data];
// }, 3000);
let times = 0;
let timer: any = null;

const setData = () => {
  timer = setInterval(() => {
    if (times > 1) {
      clearInterval(timer);
      return;
    }
    // 每次只是在原数据的基础上做简单变动（如模拟进度偏移，或深拷贝），避免重复创建
    const baseStart =
      ganttData.value[ganttData.value.length - 1]?.start || dayjs();
    const baseEnd = ganttData.value[ganttData.value.length - 1]?.end || dayjs();
    const oneDay = 24 * 3600 * 1000;
    let data = [];
    for (let i = 0; i < 20; i++) {
      data.push({
        name: `任务${baseStart + oneDay * (i + 1)}`,
        id: `task${baseStart + oneDay * (i + 1)}`,
        start: baseStart + oneDay * (i + 1),
        end: baseStart + oneDay * (i + 2),
        y:
          Math.floor(Math.random() * 11) > 10
            ? 10
            : Math.floor(Math.random() * 11),
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
    ganttData.value = [...ganttData.value, ...data];
    times++;
  }, 1000);
};

onMounted(() => {
  setData();
});

const cols = ref([
  {
    dataIndex: 'test',
    title: '设备',
    slot: 'test',
    resizable: true,
    maxWidth: 1000,
    minWidth: 80,
    ellipsis: true,
  },
  // {
  //   dataIndex: 'test2',
  //   title: '测试2',
  //   resizable: true,
  //   maxWidth: 1000,
  //   minWidth: 80,
  //   ellipsis: true,
  // },
]);

const activeKey = ref('1');

const handleTabChange = (key: string) => {
  activeKey.value = key;
  setTimeout(() => {
    testKey.value++;
  }, 1000);
};

const formState = ref({
  timeNav: '1',
});

const ganttTableRef = ref();
const testKey = ref(1);
const handleTimeNavChange = (value: string) => {
  // formState.value.timeNav = value;
  testKey.value = 0;
  testKey.value = 1;
};
</script>

<template>
  <div>
    <a-tabs :active-key="activeKey" @change="handleTabChange">
      <a-tab-pane tab="甘特图" key="1">
        <main class="flex">
          <div class="min-w-0 bg-white p-2">
            <ZGantt :option="ganttOption" :data="ganttData" @handlePointClickMouseY="handlePointClickMouseY"
              :is-top-nav="false" style="min-width: 0" />
          </div>

          <div style="
              width: 4px;
              height: 1000px;
              background-color: rgba(217, 233, 251, 0.2);
            "></div>
          <div class="min-w-0 bg-white p-2">
            <ZGantt :option="ganttOption" :data="ganttData" @handlePointClickMouseY="handlePointClickMouseY"
              :is-top-nav="false" style="min-width: 0" />
          </div>
        </main>
      </a-tab-pane>
      <a-tab-pane tab="甘特图表格" key="2">
        <main class="bg-white p-4">
          <a-form :model="formState" :label-col="{ span: 4 }" :wrapper-col="{ span: 14 }">
            <a-form-item label="时间导航栏">
              <a-radio-group v-model:value="formState.timeNav" button-style="solid" @change="handleTimeNavChange">
                <a-radio-button value="1">置底</a-radio-button>
                <a-radio-button value="2">置顶</a-radio-button>
              </a-radio-group>
            </a-form-item>
          </a-form>
          <ZGanttTable v-model:cols="cols" :gantt-data="ganttData" :gantt-option="ganttTalbeOption"
            :table-data="tableData" :nav-position="formState.timeNav === '1' ? 'bottom' : 'top'" v-if="testKey"
            ref="ganttTableRef">
            <template #test>123</template>
          </ZGanttTable>
        </main>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>
