export interface ColumnsType {
  alias?: string
  align?: 'center' | 'left' | 'right'
  conditions?: any[]
  customRender?: Function
  dataIndex: string
  disabledFilter?: boolean
  displayOrder?: number
  ellipsis?: boolean
  filterApi?: Function | string
  filterType?:
    | 'apiSelect'
    | 'date'
    | 'dateTime'
    | 'dictSelect'
    | 'inputNumber'
    | 'onlyIn'
    | 'textarea'
    | 'time'
    | 'treeSelect'
  fixed?: '' | 'left' | 'right'
  /** 数据格式化方法 formatDateTime:日期格式化，formatPast2毫秒转事件*/
  formatter?: 'formatDateTime' | 'formatPast2'
  hideCol?: boolean
  key?: string
  maxWidth?: number
  minWidth?: number
  resizable?: boolean
  slot?: string
  sortType?: string
  title: string
  width?: number | string
}

export const dragColumns = [
  {
    title: '列名',
    dataIndex: 'title',
    key: 'title',
    width: '20%',
  },
  {
    title: '别名',
    dataIndex: 'alias',
    key: 'alias',
    width: '20%',
    slot: 'alias',
  },
  {
    title: '对齐方式',
    dataIndex: 'align',
    key: 'align',
    width: '20%',
    slot: 'align',
  },
  {
    title: '隐藏列',
    dataIndex: 'hideCol',
    slot: 'hideCol',
    key: 'hideCol',
    align: 'center',
    width: '20%',
  },
  {
    title: '固定列',
    dataIndex: 'fixed',
    key: 'fixed',
    align: 'center',
    width: '20%',
    slot: 'fixed',
  },
]

export const commonCols: ColumnsType[] = [
  {
    title: '创建人',
    dataIndex: 'createBy',
    hideCol: true,
    align: 'left',
    filterType: 'textarea',
  },
  {
    title: '创建时间',
    dataIndex: 'createTime',
    hideCol: true,
    align: 'left',
    filterType: 'dateTime',
  },
  {
    title: '修改人',
    dataIndex: 'updateBy',
    hideCol: true,
    align: 'left',
    filterType: 'textarea',
  },
  {
    title: '修改时间',
    dataIndex: 'updateTime',
    hideCol: true,
    align: 'left',
    filterType: 'dateTime',
  },
  {
    title: '创建组织',
    dataIndex: 'sysOrgCode_dictText',
    hideCol: true,
    align: 'left',
  },
]

export const actionCol: ColumnsType = {
  title: '操作',
  dataIndex: 'action',
  slot: 'action',
  align: 'center',
  fixed: 'right',
}
export const longActionCol: ColumnsType = {
  title: '操作',
  dataIndex: 'action',
  slot: 'action',
  align: 'center',
  fixed: 'right',
  width: 192,
}

export const alignOpts = [
  { label: '左对齐', value: 'left' },
  { label: '居中', value: 'center' },
  { label: '右对齐', value: 'right' },
]

export const fixOpts = [
  { label: '左侧', value: 'left' },
  { label: '不固定', value: '' },
  { label: '右侧', value: 'right' },
]

export const filterTools = [
  {
    title: '包含',
    key: 'in',
  },
  {
    title: '不包含',
    key: 'not_in',
  },
  {
    title: '等于',
    key: 'eq',
  },
  {
    title: '不等于',
    key: 'ne',
  },
  {
    title: '重置当前',
    key: 'resetCurrentFilter',
  },
  {
    title: '重置所有',
    key: 'resetAllFilter',
  },
]

export const cuSettingCols = [
  {
    title: '表头名称',
    dataIndex: 'title',
    ellipsis: true,
    width: 100,
  },
  {
    title: '别名',
    dataIndex: 'alias',
    ellipsis: true,
    width: 100,
  },
  {
    title: '字段名称',
    dataIndex: 'dataIndex',
    ellipsis: true,
    width: 120,
  },
]
export const cuColorCols = [
  {
    title: '条件名称',
    dataIndex: 'conditionName',
    key: 'conditionName',
    ellipsis: true,
  },
  {
    title: '字体颜色',
    dataIndex: 'fontColor',
    key: 'fontColor',
    width: 80,
  },
  {
    title: '背景颜色',
    dataIndex: 'bgColor',
    key: 'bgColor',
    width: 80,
  },
  {
    title: '表达式',
    dataIndex: 'expression',
    key: 'expression',
    width: 300,
  },
]

export const expOpts = [
  {
    label: '值范围',
    value: 'range',
  },
  {
    label: '包含',
    value: 'includes',
  },
  {
    label: '不包含',
    value: 'notIncludes',
  },
  {
    label: '等于',
    value: 'equal',
  },
  {
    label: '不等于',
    value: 'notEqual',
  },
  {
    label: '动态表达式',
    value: 'dynamic',
  },
]

export const matchOpts = [
  {
    label: 'AND',
    value: 'AND',
    help: '所有条件匹配',
  },
  {
    label: 'OR',
    value: 'OR',
    help: '任意条件匹配',
  },
]

const commonFilterTypies = [
  {
    key: 'eq',
    label: '等于',
    title: '等于',
  },
  {
    key: 'ne',
    label: '不等于',
    title: '不等于',
  },
  {
    key: 'empty',
    label: '为空',
    title: '为空',
  },
  {
    key: 'not_empty',
    label: '不为空',
    title: '不为空',
  },
]

export const textFilterTypies = [
  ...commonFilterTypies,
  {
    key: 'like_with_or',
    label: '多词模糊匹配',
    title: '多词模糊匹配',
  },
  {
    key: 'like',
    label: '模糊搜索',
    title: '模糊搜索',
  },
  {
    key: 'right_like',
    label: '以...开始',
    title: '以...开始',
  },
  {
    key: 'left_like',
    label: '以...结尾',
    title: '以...结尾',
  },
]

export const inputNumberTypies = [
  ...commonFilterTypies,
  {
    key: 'range',
    label: '值范围',
    title: '值范围',
  },
  {
    key: 'gt',
    label: '大于',
    title: '大于',
  },
  {
    key: 'ge',
    label: '大于等于',
    title: '大于等于',
  },
  {
    key: 'lt',
    label: '小于',
    title: '小于',
  },
  {
    key: 'le',
    label: '小于等于',
    title: '小于等于',
  },
]
export const dateTypies = [
  ...commonFilterTypies,
  {
    key: 'range',
    label: '日期范围',
    title: '日期范围',
  },
  {
    key: 'gt',
    label: '大于',
    title: '大于',
  },
  {
    key: 'ge',
    label: '大于等于',
    title: '大于等于',
  },
  {
    key: 'lt',
    label: '小于',
    title: '小于',
  },
  {
    key: 'le',
    label: '小于等于',
    title: '小于等于',
  },
]
export const timeTypies = [
  ...commonFilterTypies,
  {
    key: 'range',
    label: '时间范围',
    title: '时间范围',
  },
  {
    key: 'gt',
    label: '大于',
    title: '大于',
  },
  {
    key: 'ge',
    label: '大于等于',
    title: '大于等于',
  },
  {
    key: 'lt',
    label: '小于',
    title: '小于',
  },
  {
    key: 'le',
    label: '小于等于',
    title: '小于等于',
  },
]

export const selectTypies = [
  ...commonFilterTypies,
  {
    key: 'like',
    label: '包含',
    title: '包含',
  },
  {
    key: 'not_in',
    label: '不包含',
    title: '不包含',
  },
]

export const onlyInType = [
  {
    key: 'in',
    label: '包含',
    title: '包含',
  },
]

export const pageSizeOpts = [
  {
    label: '10条/页',
    value: 10,
  },
  {
    label: '20条/页',
    value: 20,
  },
  {
    label: '50条/页',
    value: 50,
  },
  {
    label: '100条/页',
    value: 100,
  },
  {
    label: '500条/页',
    value: 500,
  },
]

export interface Props {
  bordered?: boolean
  columns: any[]
  dataSource: any[]
  defaultExpandAllRows?: boolean
  defaultSortField?: string
  defaultSortOrder?: 'ascend' | 'descend'
  expandedRowKeys?: (number | string)[]
  /**
   * 数据列表获取额外参数配置（可选）
   *
   * fetchListConfig最好是一个固定内存地址的对象（例如ref），否则组件更新（修改表格的数据）会导致传入的数据内存地址发生变化，导致监听到同样的值时watch会认为是不同的值
   */
  fetchListConfig?: {
    extraParams: object
    method?: string
  }
  isCustomExport?: boolean
  isCustomFilter?: boolean
  isDisabledDefaLoad?: boolean
  isNoHeader?: boolean
  isNoRowIndex?: boolean
  isNoSelectedAll?: boolean
  isNoSelection?: boolean
  mergeRows?: any[]
  pageCode: string
  /** 按行禁用勾选：返回 true 时该行复选框置灰不可选（全选时也会自动跳过这些行） */
  rowSelectionDisabled?: (record: any) => boolean
  toolBox?: {
    accessCode?: string[]
    eventName?: string
    fileName?: string
    icon: any
    title: string
    url?: string
  }[]
  url: any
}

export const transformFilterType = (fieldShowType: string) => {
  const dictType = ['DictSelect', 'Switch']
  const dateType = ['DatePicker']
  const dateTimeType = ['DateTimePicker']
  const timeType = ['Time']
  const numberType = ['InputNumber']
  const inputType = ['Input', 'Textarea']
  if (dictType.includes(fieldShowType)) return 'dictSelect'
  if (dateType.includes(fieldShowType)) return 'date'
  if (dateTimeType.includes(fieldShowType)) return 'dateTime'
  if (timeType.includes(fieldShowType)) return 'time'
  if (numberType.includes(fieldShowType)) return 'inputNumber'
  if (inputType.includes(fieldShowType)) return 'textarea'
}
