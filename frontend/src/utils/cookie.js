import Cookies from 'universal-cookie'

const cookie = new Cookies()

//token key（与后端 sa-token token-name 一致：Authentication）
export const Authentication = 'Authentication'

//获取token
export function getToken() {
    return cookie.get(Authentication)
}

//设置token
export function setToken(token) {
    return cookie.set(Authentication, token)
}

//清除token
export function removeToken() {
    return cookie.remove(Authentication)
}
