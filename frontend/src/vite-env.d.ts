/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端 API 基础地址；留空时走同源相对路径（开发期由 Vite 代理转发 /api） */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
