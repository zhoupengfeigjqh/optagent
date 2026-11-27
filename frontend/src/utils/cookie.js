import Cookies from 'universal-cookie'

const cookie = new Cookies()

export const Authentication = 'Authentication'

export function getToken() {
  return cookie.get(Authentication)
}

export function setToken(token) {
  return cookie.set(Authentication, token)
}

export function removeToken() {
  return cookie.remove(Authentication)
}
