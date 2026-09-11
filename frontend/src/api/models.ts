/**
 * 模型接口（`contracts/backend-api.md` §2）
 *
 * `is_default` 由后端逐项比较 `config.yaml` 的默认模型名得出；
 * **正常配置下恰一项为 `true`**，但配置出现重复模型名时可能多项——
 * 前端不得假设唯一（展示时以第一项为准）。
 */

import type { HttpClient } from './http'
import type { Model, ModelListResponse } from './types'

/** 模型 API 接口。 */
export interface ModelsApi {
  /** `GET /api/models` → 解包后的模型数组 */
  list(): Promise<Model[]>
}

/** 创建模型 API。 */
export function createModelsApi(client: HttpClient): ModelsApi {
  return {
    list: async () => {
      const response = await client.get<ModelListResponse>('/api/models')
      return response.models ?? []
    },
  }
}
