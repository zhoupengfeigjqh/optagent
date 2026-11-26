import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Antd from 'ant-design-vue'

import App from './App.vue'
import router from './router'
import './styles/preview-style.css'
import 'ant-design-vue/dist/reset.css'
import './styles/tokens.css'
import './styles/base.css'

createApp(App).use(Antd).use(createPinia()).use(router).mount('#app')
