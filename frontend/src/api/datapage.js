import axios from '@/utils/axios'



const API_PREFIX = '/dataApi'



/**============================目标优先级配置============================== */
//编辑目标优先级配置
export function editTargetPriorityConfigApi(data) {
    return axios.put(API_PREFIX + '/target-priority-config/update', data)
}

//获取列表数据
export function getTargetPriorityConfigListApi(data) {
    return axios.get(API_PREFIX + '/target-priority-config/page', {params: data})
}

//删除
export function deleteTargetPriorityConfigApi(data) {  
    return axios.delete(API_PREFIX + '/target-priority-config/delete', {params: data})
}

/**============================工单切换时间============================== */
//编辑工单切换时间
export function editSwitchTimeApi(data) {
    return axios.put(API_PREFIX + '/switch-time/update', data)
}

//获取列表数据
export function getSwitchTimeListApi(data) {
    return axios.get(API_PREFIX + '/switch-time/page', {params: data})
}

//删除
export function deleteSwitchTimeApi(data) {  
    return axios.delete(API_PREFIX + '/switch-time/delete', {params: data})
}

/**============================求解时间配置============================== */
//编辑求解时间配置
export function editSolvingTimeApi(data) {
    return axios.put(API_PREFIX + '/solving-time/update', data)
}

//获取列表数据
export function getSolvingTimeListApi(data) {
    return axios.get(API_PREFIX + '/solving-time/page', {params: data})
}

//删除
export function deleteSolvingTimeApi(data) {  
    return axios.delete(API_PREFIX + '/solving-time/delete', {params: data})
}

/**============================排产计划============================== */
//编辑排产计划
export function editProductionPlanApi(data) {
    return axios.put(API_PREFIX + '/production-plan/update', data)
}

//获取列表数据
export function getProductionPlanListApi(data) {
    return axios.get(API_PREFIX + '/production-plan/page', {params: data})
}

//删除
export function deleteProductionPlanApi(data) {  
    return axios.delete(API_PREFIX + '/production-plan/delete', {params: data})
}

/**============================产线信息============================== */
//编辑产线信息
export function editProductionLineApi(data) {
    return axios.put(API_PREFIX + '/production-line/update', data)
}

//获取列表数据
export function getProductionLineListApi(data) {
    return axios.get(API_PREFIX + '/production-line/page', {params: data})
}

//删除
export function deleteProductionLineApi(data) {  
    return axios.delete(API_PREFIX + '/production-line/delete', {params: data})
}

/**============================产线电价信息============================== */
//编辑产线电价信息
export function editProductionLineElectricityApi(data) {
    return axios.put(API_PREFIX + '/production-line-electricity/update', data)
}

//获取列表数据
export function getProductionLineElectricityListApi(data) {
    return axios.get(API_PREFIX + '/production-line-electricity/page', {params: data})
}

//删除
export function deleteProductionLineElectricityApi(data) {  
    return axios.delete(API_PREFIX + '/production-line-electricity/delete', {params: data})
}

/**============================产能信息============================== */
//编辑产能信息
export function editProductionCapacityApi(data) {
    return axios.put(API_PREFIX + '/production-capacity/update', data)
}

//获取列表数据
export function getProductionCapacityListApi(data) {
    return axios.get(API_PREFIX + '/production-capacity/page', {params: data})
}

//删除
export function deleteProductionCapacityApi(data) {  
    return axios.delete(API_PREFIX + '/production-capacity/delete', {params: data})
}



/**============================排产任务结果============================== */

//算法排产结果回调
export function schedulingCallbackApi(data) {
    return axios.post(API_PREFIX + '/scheduling/callback', data)
}

//工单加工计划分页查询
export function getOverallPlanListApi(data) {
    return axios.get(API_PREFIX + '/scheduling/overall-plan/page', {params: data})
}

//排产结果指标
export function getMetricsApi(data) {
    return axios.get(API_PREFIX + '/scheduling/metrics', {params: data})
}

//产线利用率分页查询
export function getLineUsageRateListApi(data) {
    return axios.get(API_PREFIX + '/scheduling/line-usage-rate/page', {params: data})
}

//产线加工计划分页查询
export function getLinePlanListApi(data) {
    return axios.get(API_PREFIX + '/scheduling/line-plan/page', {params: data})
}

//排产结果甘特图
export function getGanttApi(data) {
    return axios.get(API_PREFIX + '/scheduling/gantt', {params: data})
}

//排产结果 Excel 导出（blob 文件流，由页面触发浏览器下载）
export function exportSchedulingApi(data) {
    return axios.get(API_PREFIX + '/scheduling/export', {params: data, responseType: 'blob'})
}
