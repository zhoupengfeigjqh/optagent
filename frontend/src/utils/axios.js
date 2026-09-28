/*
 * @Author: Nose陈建
 * @LastEditTime: 2026-09-16 10:41:59
 */
import axios from "axios";
// import Msg from '@/utils/msg';
import { message } from 'ant-design-vue'
import { getToken } from '@/utils/cookie';

//token 名称（与后端 sa-token token-name 一致：Authentication，见 utils/cookie.js）
const Authentication = 'Authentication'

const service = axios.create({
    //基础URL
    baseURL: import.meta.env.VITE_API_BASE_PREFIX,
    //请求超时30秒
    timeout: 30000
})
//请求拦截器
service.interceptors.request.use(function (config) {
    //携带登录 token
    const token = getToken()
    if (token) {
        config.headers[Authentication] = token
    }
    return config;
}, function (err) {
    //请求错误
    return Promise.reject(err);
});

//响应拦截器
service.interceptors.response.use(function (response) {
    const res = response.data

    // 业务层面的错误判断
    if (res.success === false || (res.code && res.code !== 200)) {
        // 401 业务码也做登录跳转（有些后端业务错误也用 401）
        if (res.code === 401) {
            message.error('登录已过期，请重新登录')
            window.location.href = '/login'
        } else {
            message.error(res.message || '请求失败')
        }
        return Promise.reject(res)
    }

    return res
}, function (res) {
    // HTTP 层面的错误（网络错误、非 2xx 状态码）
    if (res.response && res.response.status === 401) {
        message.error('登录已过期，请重新登录')
        window.location.href = '/login'
        return Promise.reject(res)
    }
    message.error(res.response?.data?.message || res.response?.data || '请求失败')
    return Promise.reject(res);
});

export default service
