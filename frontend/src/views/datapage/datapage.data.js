// 排产计划数据表列配置
export const productionPlanColumns = [
  {
    label: '用户ID',
    prop: 'userId',
    width: 150,
  },
  {
    label: '会话ID',
    prop: 'conversationId',
    width: 150,
  },
  {
    label: '来源类型',
    prop: 'sourceType',
    width: 100,
  },
  {
    label: '来源地址',
    prop: 'sourceValue',
    width: 150,

  },
  {
    label: '记录ID',
    prop: 'recordId',
    width: 150,
  },
  {
    label: '记录ID',
    prop: 'recordId',
    width: 150,
  },
  {
    label: '物料ID',
    prop: 'productId',
    width: 150,
  },
  {
    label: '物料名称',
    prop: 'productName',
    width: 150,
  },
  {
    label: '半成品物料ID',
    prop: 'semiFinishedProductId',
    width: 150,
  },
  {
    label: '半成品物料名称',
    prop: 'semiFinishedProductName',
    width: 180,
  },
  {
    label: '三级物料组ID',
    prop: 'thirdMaterialGroupId',
    width: 150,
  },
  {
    label: '三级物料组描述',
    prop: 'thirdMaterialGroupDesc',
    width: 180,
  },
  {
    label: '四级物料组ID',
    prop: 'forthMaterialGroupId',
    width: 150,
  },
  {
    label: '四级物料组描述',
    prop: 'forthMaterialGroupDesc',
    width: 180,
  },
  {
    label: '生产粒径',
    prop: 'productionParticleSize',
    width: 150,
  },
  {
    label: '长径比',
    prop: 'aspectRatio',
    width: 150,
  },
  {
    label: '最早开工时间',
    prop: 'earliestStartTime',
    width: 150,
  },
  {
    label: '最晚完工时间',
    prop: 'latestCompletionTime',
    width: 150,
  },
  {
    label: '蛋白档次',
    prop: 'proteinGradeLevel',
    width: 150,
  },
  {
    label: '包装类型',
    prop: 'packageType',
    width: 150,
  },
  {
    label: '理论环模',
    prop: 'dia',
    width: 150,
  },
  {
    label: '物料优先级',
    prop: 'materialPriority',
    width: 150,
  },
  {
    label: '计划排产量',
    prop: 'plannedProductionQuantity',
    width: 150,
  },
  {
    label: '单吨电耗',
    prop: 'unitElectricityConsumption',
    width: 150,
  },
  {
    label: '加药标识', // ：1-需要加药，0-不需要加药
    prop: 'isDosing',
    width: 150,
  },
  {
    label: '加色标识', //：1-需要加色，0-不需要加色
    prop: 'isColoring',
    width: 150,
  },
  {
    label: '特殊处理分组',
    prop: 'specialProcessType',
    width: 150,
  },
  {
    label: '创建时间',
    prop: 'createTime',
    width: 150,
  },
];

// 产线信息数据表列配置
export const productionLineColumns = [
  /*{
    label: '用户ID',
    prop: 'userId',
    width: 150,
  },
  {
    label: '会话ID',
    prop: 'conversationId',
    width: 150,
  },
  {
    label: '来源类型',
    prop: 'sourceType',
    width: 150,
  },
  {
    label: '来源地址',
    prop: 'sourceValue',
    width: 150,
  },*/
  {
    label: '产线编号',
    prop: 'productionLineId', // 产线编号
    width: 150,
  },
  {
    label: '产线名称',
    prop: 'productionLineName', // 产线名称
    width: 150,
  },
  {
    label: '产线描述',
    prop: 'productionLineDesc', // 产线描述
    width: 180,
  },
  {
    label: '产线剩余生产时长（小时）',
    prop: 'lineRemainingTime', // 产线剩余生产时长（小时）
    width: 150,
  },
  {
    label: '当前产线最后一个物料的记录ID',
    prop: 'recordId', // 当前产线最后一个物料的记录ID
    width: 150,
  },
  {
    label: '当前产线最后一个物料ID',
    prop: 'productId', // 当前产线最后一个物料ID
    width: 150,
  },
  {
    label: '物料名称',
    prop: 'productName',
    width: 150,
  },
  {
    label: '半成品物料ID',
    prop: 'semiFinishedProductId',
    width: 150,
  },
  {
    label: '半成品物料名称',
    prop: 'semiFinishedProductName',
    width: 180,
  },
  {
    label: '三级物料组ID',
    prop: 'thirdMaterialGroupId',
    width: 150,
  },
  {
    label: '三级物料组描述',
    prop: 'thirdMaterialGroupDesc',
    width: 180,
  },
  {
    label: '四级物料组ID',
    prop: 'forthMaterialGroupId',
    width: 150,
  },
  {
    label: '四级物料组描述',
    prop: 'forthMaterialGroupDesc',
    width: 180,
  },
  {
    label: '生产粒径',
    prop: 'productionParticleSize',
    width: 150,
  },
  {
    label: '长径比',
    prop: 'aspectRatio',
    width: 150,
  },
  {
    label: '包装类型',
    prop: 'packageType',
    width: 150,
  },
  {
    label: '理论环模',
    prop: 'dia',
    width: 150,
  },
  {
    label: '计划排产量',
    prop: 'plannedProductionQuantity',
    width: 150,
  },
  {
    label: '允许超出可用时长',
    prop: 'allowOverTime',
    width: 150,
  },
  {
    label: '混合机（逗号分隔）',
    prop: 'assignedMixers',
    width: 150,
  },
  {
    label: '创建时间',
    prop: 'createTime',
    width: 150,
  },
];

// 切换时间信息数据表列配置
export const switchTimeColumns = [
  /*{
    label: '用户ID',
    prop: 'userId',
    width: 150,
  },
  {
    label: '会话ID',
    prop: 'conversationId',
    width: 150,
  },
  {
    label: '来源类型',
    prop: 'sourceType',
    width: 150,
  },
  {
    label: '来源地址',
    prop: 'sourceValue',
    width: 150,
  },*/
  {
    label: '前序工单记录ID',
    prop: 'previousOrderRecordId', // 前序工单记录ID
    width: 150,
  },
  {
    label: '后序工单记录ID',
    prop: 'postOrderRecordId', // 后序工单记录ID
    width: 150,
  },
  {
    label: '切换时间',
    prop: 'switchTime', // 切换时间
    width: 150,
  },
  {
    label: '创建时间',
    prop: 'createTime',
    width: 150,
  },
];

// 产能信息数据表列配置
export const productionCapacityColumns = [
  /*{
    label: '用户ID',
    prop: 'userId',
    width: 150,
  },
  {
    label: '会话ID',
    prop: 'conversationId',
    width: 150,
  },
  {
    label: '来源类型',
    prop: 'sourceType',
    width: 150,
  },
  {
    label: '来源地址',
    prop: 'sourceValue',
    width: 150,
  },*/
  {
    label: '车间ID',
    prop: 'orgId', // 车间ID
    width: 150,
  },

  {
    label: '产品ID',
    prop: 'productId', // 产品ID
    width: 150,
  },
  {
    label: '产线ID',
    prop: 'productionLineId', // 产线ID
    width: 150,
  },

  {
    label: '产线名称',
    prop: 'productionLineName', // 产线名称
    width: 150,
  },

  {
    label: '产线描述',
    prop: 'productionLineDesc', // 产线描述
  },

  {
    label: '生产产能（吨/小时）',
    prop: 'capacity',
    width: 150,
  },
  {
    label: '最小起订量',
    prop: 'minimumOrderQuantity',
    width: 150,
  },
  {
    label: '产线优先级',
    prop: 'productionLinePriority', 
    width: 150,
  },
];

// 求解时间列配置
export const solvingTimeColumns = [
  /*{
    label: '用户ID',
    prop: 'userId',
    width: 150,
  },
  {
    label: '会话ID',
    prop: 'conversationId',
    width: 150,
  },
  {
    label: '来源类型',
    prop: 'sourceType',
    width: 150,
  },
  {
    label: '来源地址',
    prop: 'sourceValue',
    width: 150,
  },*/
  {
    label: '求解时间',
    prop: 'solvingTime', // 求解时间
    width: 150,
  },
  {
    label: '创建时间',
    prop: 'createTime',
    width: 150,
  },
  {
    label: '更新时间',
    prop: 'updateTime',
    width: 150,
  },
];

// 产线电价信息数据表列配置
export const productionLineElectricityColumns = [
  /*{
    label: '用户ID',
    prop: 'userId',
    width: 150,
  },
  {
    label: '会话ID',
    prop: 'conversationId',
    width: 150,
  },
  {
    label: '来源类型',
    prop: 'sourceType',
    width: 150,
  },
  {
    label: '来源地址',
    prop: 'sourceValue',
    width: 150,
  },*/
  {
    label: '产线ID',
    prop: 'productionLineId', // 产线ID
    width: 150,
  },
  {
    label: '开始时间（小时，0-23）',
    prop: 'electricityStartTime', // 开始时间（小时，0-23）
    width: 150,
  },

  {
    label: '结束时间（小时，0-23）',
    prop: 'electricityEndTime', // 结束时间（小时，0-23）
    width: 150,
  },
  {
    label: '创建时间',
    prop: 'createTime',
    width: 150,
  },
  {
    label: '更新时间',
    prop: 'updateTime',
    width: 150,
  },
];

// 目标优先级配置数据表列配置
export const targetPriorityConfigColumns = [
  /*{
    label: '用户ID',
    prop: 'userId',
    width: 150,
  },
  {
    label: '会话ID',
    prop: 'conversationId',
    width: 150,
  },
  {
    label: '来源类型',
    prop: 'sourceType',
    width: 150,
  },
  {
    label: '来源地址',
    prop: 'sourceValue',
    width: 150,
  },*/
  {
    label: '规则编码',
    prop: 'ruleId',
    width: 150,
  },
  {
    label: '规则描述',
    prop: 'ruleDescription',
    width: 150,
  },
  {
    label: '规则优先级',
    prop: 'rulePriority',
    width: 150,
  },
  {
    label: '创建时间',
    prop: 'createTime',
    width: 150,
  },
];

export const getTableNames = val => {
  switch (val) {
    case 'production-plan':
      return {
        name: '生产计划数据表',
        columns: productionPlanColumns,
      };
    case 'production-line':
      return {
        name: '产线信息数据表',
        columns: productionLineColumns,
      };
    case 'switch-time':
      return {
        name: '切换时间信息数据表',
        columns: switchTimeColumns,
      };
    case 'production-capacity':
      return {
        name: '产能信息数据表',
        columns: productionCapacityColumns,
      };
    // case 'solving-time':
    //   return {
    //     name: '求解时间',
    //     columns: solvingTimeColumns,
    //   };
    case 'production-line-electricity':
      return {
        name: '产线电价信息数据表',
        columns: productionLineElectricityColumns,
      };
    // case 'target-priority-config':
    //   return {
    //     name: '目标优先级配置表',
    //     columns: targetPriorityConfigColumns,
    //   };
  }
};
