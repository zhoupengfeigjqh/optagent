import axios from 'axios'
import { message } from 'ant-design-vue'
import { getToken } from '@/utils/cookie'

const Authentication = 'Authentication'

const service = axios.create({
  //基础URL：必须为空（同源相对路径），理由见文件头注释
  baseURL: '',
  //请求超时30秒
  timeout: 30000,
})
service.interceptors.request.use(
  function (config) {
    const token = getToken()
    if (token) {
      config.headers[Authentication] = token
    }
    return config
  },
  function (err) {
    return Promise.reject(err)
  },
)

service.interceptors.response.use(
  function (response) {
    const res = response.data

    if (res.success === false || (res.code && res.code !== 200)) {
      if (res.code === 401) {
        message.error('登录已过期，请重新登录')
        window.location.href = '/login'
      } else {
        message.error(res.message || '请求失败')
      }
      return Promise.reject(res)
    }

    return res
  },
  function (res) {
    if (res.response && res.response.status === 401) {
      message.error('登录已过期，请重新登录')
      window.location.href = '/login'
      return Promise.reject(res)
    }
    message.error(res.response?.data?.message || res.response?.data || '请求失败')
    return Promise.reject(res)
  },
)

export default service
