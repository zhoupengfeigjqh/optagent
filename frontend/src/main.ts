/*
 * @Author: Nose陈建
 * @LastEditTime: 2026-10-12 17:43:59
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Antd from 'ant-design-vue'

import App from './App.vue'
import router from './router'
import 'ant-design-vue/dist/reset.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/preview-style.css'

createApp(App).use(Antd).use(createPinia()).use(router).mount('#app')
