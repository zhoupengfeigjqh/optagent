# 契约增量：账号域（029）

**性质**：**零增量的行为契约**。本特性不新增端点、不新增字段、不新增错误码；本文只固化"两种存储必须表现相同"的行为约定，端点形态仍以既有契约为唯一来源：

- 端点与字段：[001 contracts/admin-api.md](../../001-digital-human-platform/contracts/admin-api.md) §13、§0.4
- 注册/登录/会话：[024 contracts/auth-api.md](../../024-user-login-auth/contracts/auth-api.md)
- 数据口径与错误码表：[028 方案与契约](../028-account-mysql-binding/方案与契约.md) §4.3、§5

## 1. 差异清单（本特性只定义"变化"，不重复定义端点）

**唯一真相源**：端点、方法、请求/响应字段、成功状态码以 §开头所列的既有契约为准；本文**不复述**字段与结构，只固化下面 4 项行为差异/口径。

| 编号 | 受影响端点 | 差异内容 |
|---|---|---|
| D-1 | `POST/PUT /api/admin/users*` | 配置版本语义恢复为与文件存储一致（详见 §2）；此前数据库模式会静默忽略 `revision` |
| D-2 | `DELETE /api/admin/agent-services/:code` | 依据"有效链接或用户关联"判定，**不再因历史失效链接失败**（此前 500） |
| D-3 | `GET /api/admin/register-links` | 顺序固定为 `created_at` 升序、同刻按 `token`（此前数据库模式为倒序） |
| D-4 | `GET /api/admin/platform/health` | 仅数据库模式新增 `database` 字段，结构固定为 `{ reachable: boolean, host: string, database: string, error: string \| null }`；文件模式响应不变。探测超时按 `reachable:false` 表达，不抛 500 |

## 2. 配置版本（`revision`）语义 — 必须与文件存储相同

| 操作 | 请求 | 版本行为 |
|---|---|---|
| 新建账号 | 不带 `revision` | 成功即推进，响应返回新版本 |
| 新建账号 | 带 `revision` | 不符 → `409 ADM_CONFIG_REVISION_CONFLICT`；相符 → 写入并推进 |
| 修改授权 | `revision` 必填 | 不符 → 409 且不写入；相符 → 写入并推进 |
| 重置密码 | 不带 `revision` | **不推进** |
| 删除账号 | — | 推进会 |

## 3. 不变的行为（回归断言项，不重新定义）

1. 登录凭据错误统一"凭据无效"；登录成功覆盖旧会话；登出幂等。
2. 注册：链接无效（不存在/撤销/过期/服务停用）统一 `ADM_INVALID_LINK`；手机号重复 `ADM_PHONE_TAKEN`；成功 201 且不下发 Cookie、`use_count +1`；后续步骤失败回滚已建账号。
3. 账户列表分页与字段集合、`deployed_at`/`abnormal` 的判定来源。
4. `my-agents` = 已授权 ∩ 已部署，`pending` 恒空。
5. 服务编码省略时由平台生成、以响应为准；`code` 与落点不可改。
6. 删除数字人：先软撤销未撤销链接（记录保留），再删服务与设计态；影响面统计与实际撤销数一致。

## 4. 受影响端点索引（仅路径，字段见既有契约）

`auth/login`、`auth/logout`、`auth/me`、`auth/session/valid`、`auth/register`、`auth/register-links/:token`、`auth/my-agents`、`users`（GET/POST）、`users/:user_id`（PUT/DELETE）、`users/:user_id/password`、`agent-services`（GET/POST）、`agent-services/:code`（PUT/DELETE）、`register-links`（GET/POST）、`register-links/:token`（DELETE）、`agents`（POST）、`agents/:name/deletion-impact`、`agents/:name`（DELETE）、`platform/health`

## 4. 错误码（不新增）

沿用：`ADM_INVALID_LINK`、`ADM_PHONE_TAKEN`、`ADM_USER_NOT_FOUND`、`ADM_USER_ID_TAKEN`、`ADM_AGENT_SERVICE_NOT_FOUND`、`ADM_AGENT_SERVICE_IN_USE`、`ADM_CONFIG_REVISION_CONFLICT`、`ADM_STORAGE_UNAVAILABLE`、`VALIDATION_FAILED`、`INTERNAL_ERROR`。

**唯一变化**：`ADM_STORAGE_UNAVAILABLE` 不再因"删除仍有历史链接的服务"而出现（该场景此前是错误行为，见 research R4）。

## 5. 不可变更清单

- 路径、方法、请求/响应字段名、成功状态码。
- Cookie 名与凭据格式（024 契约）。
- 前端调用方式（两个前端零改动）。
- 设计态与部署产物仍走文件系统。
