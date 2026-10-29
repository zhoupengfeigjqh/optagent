# 契约增量：工作空间目录项的 `predefined` 字段

**Feature**: `014-chat-onboarding-hint` | **Endpoint**: `GET /api/files/workspace`

本文件只记录本次**增量**。端点其余行为（三空间结构、字段约束、上传类型、错误码）不变，权威文档仍为
`specs/001-digital-human-platform/contracts/runtime-api-delta.md`（实现时须在该文件同步本字段说明）。

## 1. 响应增量

`spaces[].dirs[]` 新增一个**必填**布尔字段 `predefined`：

```jsonc
{
  "scenario": "全量",
  "spaces": [
    {
      "name": "数据准备",
      "agent_writable": false,
      "upload_extensions": [".csv", ".xlsx"],
      "dirs": [
        {
          "dir": "数据准备/算法规则",
          "label": "算法规则",
          "deletable": true,
          "files": [],
          "fields": [],
          "upload_extensions": [".csv", ".xlsx"],
          "predefined": true
        },
        {
          "dir": "数据准备/生产计划",
          "label": "生产计划",
          "deletable": true,
          "files": [{ "filename": "计划.csv", "size": 1024, "updated_at": "2026-10-29T02:00:00.000Z" }],
          "fields": [{ "name": "产线编号", "type": "string", "required": true }],
          "upload_extensions": [".csv", ".xlsx"],
          "predefined": false
        }
      ]
    },
    {
      "name": "共享空间",
      "agent_writable": false,
      "upload_extensions": [".csv", ".xlsx", ".pdf"],
      "dirs": [
        {
          "dir": "共享空间",
          "label": "共享空间",
          "deletable": false,
          "files": [],
          "fields": [],
          "upload_extensions": [".csv", ".xlsx", ".pdf"],
          "predefined": false
        }
      ]
    }
  ]
}
```

## 2. 字段语义

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `predefined` | `boolean` | 是 | `true` = 平台预定义二级目录（恒存在、不可移除，当前仅 `算法规则`）；其余一切目录恒为 `false` |

- 只对「数据准备」下的二级目录可能出现 `true`；共享空间 / 临时空间的目录项恒为 `false`。
- 该字段描述**目录性质**，不代表目录内是否有文件；空预定义目录同样是 `true`。
- 该字段**只读**：不接受写入，不进入 `scenario.json`，不参与部署产物。

## 3. 兼容与错误

- **向后兼容**：纯增字段，既有消费方忽略即可。
- **错误码不变**：`AGENT_NOT_SELECTED` / `AGENT_NOT_AVAILABLE` / `SCENARIO_NOT_CONFIGURED` 语义与状态码全部沿用，不新增错误码。
- **缺场景**：该端点仍返回 503，不返回部分字段。

## 4. 测试断言口径

- 单测（`agent-backend/tests/unit/workspace-view.spec.ts`）：
  - `算法规则` → `predefined: true`；
  - 管理员配置目录 → `false`；
  - 共享空间 / 临时空间目录项 → `false`；
  - 空目录的文件清单为 `[]` 且 `predefined` 不受影响。
- 集成（`agent-backend/tests/integration/files-scenario.spec.ts`）：
  - 场景含 `算法规则` 时，响应中存在且仅存在该项 `predefined === true`；
  - 切换数字人后该标记随新场景的目录清单变化。
- 前端类型（`frontend/src/api/types.ts`）：`WorkspaceDir.predefined: boolean`（必填），夹具同步补齐。
