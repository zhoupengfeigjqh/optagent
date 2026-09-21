/** z-table 表格列配置 */
export interface ColumnsType {
  /** 列别名，用于个性化设置中的显示名称（可选） */
  alias?: string;
  /** 列内容对齐方式，默认 left（可选） */
  align?: 'center' | 'left' | 'right';
  /** 个性化条件格式配置列表，用于按条件设置单元格字体/背景色（可选） */
  conditions?: any[];
  /** 自定义渲染单元格 */
  customRender?: Function;
  /** 列字段名，对应数据行中的属性 key */
  dataIndex: string;
  /** 禁用搜索 */
  disabledFilter?: boolean;
  /** 列显示顺序，由表格个性化配置同步（可选） */
  displayOrder?: number;
  /** 超出列宽时是否省略显示，默认 true（可选） */
  ellipsis?: boolean;
  /**
   * 筛选数据源：远程下拉为请求函数；字典下拉为 dictCode字符串（可选）
   *
   * 与 filterType 为 apiSelect、dictSelect、treeSelect 等配合使用
   */
  filterApi?: Function | string;
  /**
   * 列控件类型（可选）
   *
   * - apiSelect：远程接口下拉
   * - date：日期
   * - dictSelect：字典下拉（filterApi 填 dictCode）
   * - inputNumber：数字输入
   * - onlyIn：包含于 / 成员匹配
   * - textarea：文本
   * - time：时间
   * - treeSelect：树形选择（筛选规则同 onlyIn）
   */
  filterType?:
    | 'apiSelect'
    | 'date'
    | 'dateTime'
    | 'dictSelect'
    | 'inputNumber'
    | 'onlyIn'
    | 'textarea'
    | 'time'
    | 'treeSelect';
  /** 固定列位置：left 左侧、right 右侧，空字符串表示不固定（可选） */
  fixed?: '' | 'left' | 'right';
  /** 数据格式化方法 formatDateTime:日期格式化，formatPast2毫秒转事件*/
  formatter?: 'formatDateTime' | 'formatPast2';
  /** 是否在表格中隐藏该列，true 为隐藏（可选） */
  hideCol?: boolean;
  /** 列唯一标识，拖拽排序用；未传时默认取 dataIndex（可选） */
  key?: string;
  /** 列宽拖拽时的最大宽度，默认 600（可选） */
  maxWidth?: number;
  /** 列宽拖拽时的最小宽度，默认 80（可选） */
  minWidth?: number;
  /** 是否允许拖拽调整列宽，默认 true（可选） */
  resizable?: boolean;
  /** 自定义单元格插槽名，在页面中通过具名插槽渲染列内容（可选） */
  slot?: string;
  /** 远程排序状态：ascend 升序、descend 降序、default 默认（可选，一般由表格内部维护） */
  sortType?: string;
  /** 列标题（表头显示文字） */
  title: string;
  /** 列宽度，未设置时默认 120（可选） */
  width?: number | string;
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
];

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
];

export const actionCol: ColumnsType = {
  title: '操作',
  dataIndex: 'action',
  slot: 'action',
  align: 'center',
  fixed: 'right',
};
export const longActionCol: ColumnsType = {
  title: '操作',
  dataIndex: 'action',
  slot: 'action',
  align: 'center',
  fixed: 'right',
  width: 192,
};

export const alignOpts = [
  { label: '左对齐', value: 'left' },
  { label: '居中', value: 'center' },
  { label: '右对齐', value: 'right' },
];

export const fixOpts = [
  { label: '左侧', value: 'left' },
  { label: '不固定', value: '' },
  { label: '右侧', value: 'right' },
];

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
];

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
];
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
];

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
];

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
];

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
];

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
];

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
];
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
];
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
];

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
];

export const onlyInType = [
  {
    key: 'in',
    label: '包含',
    title: '包含',
  },
];

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
];

export interface Props {
  /** 是否开启表格边框（可选） */
  bordered?: boolean;
  /** 表头 */
  columns: any[];
  /** 表格数据源 */
  dataSource: any[];
  /** 初始时，是否展开所有行 */
  defaultExpandAllRows?: boolean;
  /** 默认排序字段和方式 */
  defaultSortField?: string;
  defaultSortOrder?: 'ascend' | 'descend';
  /** 受控展开行 key 集合（配合 #expandedRowRender 插槽使用，可选） */
  expandedRowKeys?: (number | string)[];
  /**
   * 数据列表获取额外参数配置（可选）
   *
   * fetchListConfig最好是一个固定内存地址的对象（例如ref），否则组件更新（修改表格的数据）会导致传入的数据内存地址发生变化，导致监听到同样的值时watch会认为是不同的值
   */
  fetchListConfig?: {
    /** 额外参数 */
    extraParams: object;
    /** 请求方法 */
    method?: string;
  };
  /** 是否自定义导出（可选） */
  isCustomExport?: boolean;
  /** 是否自定义过滤（可选） */
  isCustomFilter?: boolean;
  /** 禁用进入就初始化 */
  isDisabledDefaLoad?: boolean;
  /** 是否不需要扩展功能 */
  isNoHeader?: boolean;
  /** 是否显示行索引（可选） */
  isNoRowIndex?: boolean;
  /** 是否不显示数据全选（可选） */
  isNoSelectedAll?: boolean;
  /** 是否不显示行选择框（可选，默认显示） */
  isNoSelection?: boolean;
  /** 需要行合并的字段集合（可选） */
  mergeRows?: any[];
  /** 表格组件编码，通过唯一编码获取及更新该表格的个性化设置 */
  pageCode: string;
  /** 按行禁用勾选：返回 true 时该行复选框置灰不可选（全选时也会自动跳过这些行） */
  rowSelectionDisabled?: (record: any) => boolean;
  /** 工具箱配置 */
  toolBox?: {
    /** 按钮权限标识 */
    accessCode?: string[];
    /** 事件名称（可选） */
    eventName?: string;
    /** 导出文件名称 */
    fileName?: string;
    /** 工具箱图标 */
    icon: any;
    /** 工具箱标题 */
    title: string;
    /** 地址 */
    url?: string;
  }[];
  /** 获取数据接口地址 */
  url: any;
}

export const transformFilterType = (fieldShowType: string) => {
  const dictType = ['DictSelect', 'Switch'];
  const dateType = ['DatePicker'];
  const dateTimeType = ['DateTimePicker'];
  const timeType = ['Time'];
  const numberType = ['InputNumber'];
  const inputType = ['Input', 'Textarea'];
  if (dictType.includes(fieldShowType)) return 'dictSelect';
  if (dateType.includes(fieldShowType)) return 'date';
  if (dateTimeType.includes(fieldShowType)) return 'dateTime';
  if (timeType.includes(fieldShowType)) return 'time';
  if (numberType.includes(fieldShowType)) return 'inputNumber';
  if (inputType.includes(fieldShowType)) return 'textarea';
};
