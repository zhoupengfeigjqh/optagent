# 快速验证：账号域 MySQL 模式功能对齐

**用途**：证明本特性的"两种存储行为一致"成立，并给出切换与回滚的实际步骤。
**前置产物**：[spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/account-api.md](./contracts/account-api.md)

## 0. 前置条件

| 项 | 要求 |
|---|---|
| Node | ≥ 20；`admin-backend` 依赖已安装 |
| 数据库 | 本机或可达的 MySQL 8.0+；建库 `optagent`（生产口径）与 `optagent_test`（测试口径） |
| 数据 | `admin-backend/.platform-data/accounts/**` 已备份到仓库外 |
| 写入 | 切换窗口内停止写入（不新建账号、不改授权、不生成链接） |

当前基线数据（2026-11-28）：账号 2、会话 2、服务 7、注册链接 36（已撤销 7）。

## 1. 建表（幂等）

```powershell
cd admin-backend
npm run db:init            # 执行 schema.sql：建库建表 + 5 条服务种子
```

**期望**：命令成功退出；重复执行不报错。表清单为 `users` / `sessions` / `agent_services` / `register_links`，`users` 无 `status` 列。

## 2. 搬运数据（可重复执行）

```powershell
npm run migrate:mysql
```

**期望输出**：四类数据的写入条数摘要，以及逐项对账结论（账号 2 / 会话 2 / 服务 7 / 链接 36）；退出码 0。
**失败判定**：退出码非 0、或打印任何"不一致/缺少"条目 → 停止，不要切换。

## 3. 切换

在 `admin-backend/.env.local` 中设置：

```text
STORAGE_DRIVER=mysql
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=<user>
MYSQL_PASSWORD=<password>
MYSQL_DATABASE=optagent
```

```powershell
npm run dev
```

**期望**：启动日志出现 `storage.driver=mysql`；MySQL 不可达时**拒绝启动**（不静默退回文件）。

## 4. 冒烟验证（非交互）

按顺序执行，每步都应有明确响应：

| # | 验证 | 命令 / 操作 | 期望 |
|---|---|---|---|
| 1 | 健康检查 | `Invoke-RestMethod http://127.0.0.1:3001/api/admin/platform/health` | 含 `platform_data`、`opt_agent`、`database.reachable=true` |
| 2 | 管理员登录 | `POST /api/admin/auth/login`（`{user_id:"admin", password:<原密码>}`） | 200 且下发 Cookie |
| 3 | 身份探针 | `GET /api/admin/auth/me`（带 Cookie） | `role="admin"`、`display_name` 与切换前一致 |
| 4 | 账户列表 | `GET /api/admin/users?page=1` | 总数与切换前一致；行内含 `phone`、`role`、`source_agent_code` |
| 5 | 服务清单 | `GET /api/admin/agent-services` | 7 条；`registered_users` 与切换前一致 |
| 6 | 链接清单 | `GET /api/admin/register-links` | 36 条；顺序为创建时间升序 |
| 7 | 有效链接校验 | `GET /api/admin/auth/register-links/<切换前的有效 token>` | 200 且返回对应数字人 |
| 8 | 用户登录 | 用切换前可登录的普通用户手机号登录 | 200 |
| 9 | 停用服务 → 生成链接 | `PUT /agent-services/:code {status:"disabled"}` 后 `POST /register-links` | 400 |
| 10 | 仅剩失效链接时删服务 | 对只有已撤销链接的服务执行 `DELETE` | 204（此前为 500） |

## 5. 双驱动对拍（口径验证）

同一组操作在 `STORAGE_DRIVER=file` 与 `=mysql` 下各跑一次，比较响应 JSON（时间字段只比格式与相对顺序）。用例编号与 `spec.md` SC-002 一一对应：

| 编号 | 场景 |
|---|---|
| U01 | 账户列表分页（字段与排序） |
| U02 | 新建账号（含手机号、角色、来源数字人） |
| U03 | 新建账号（无版本号）→ 响应返回新版本 |
| U04 | 改授权（携带正确版本） |
| U05 | 改授权（携带过期版本）→ 409 且不写入 |
| U06 | 改授权成功 → 用改前版本请求部署 → 409 |
| U07 | 重置密码 → 旧 Cookie 访问 `/me` → 401 |
| U08 | 删除账号（依次断会话、撤部署、删记录） |
| U09 | 删除账号中途失败 → 如实报错且账号仍在 |
| U10 | 注册成功（自动关联、不自动登录、计数 +1） |
| U11 | 注册手机号重复 → 409 |
| U12 | 注册链接已撤销 / 已过期 / 服务停用 → 同一"链接无效" |
| U13 | 同一手机号并发注册 → 仅一个成功 |
| U14 | 同一链接并发注册 → 计数准确 +2 |
| U15 | 生成链接（7 天 / 30 天 / 长期） |
| U16 | 停止注册（逐条撤销 / 一次性全部撤销） |
| U17 | 链接清单顺序（创建时间升序，同刻按标识） |
| U18 | 删除服务（仍有有效链接）→ 409 |
| U19 | 删除服务（仅有失效链接）→ 204 |
| U20 | 删除数字人（含多条历史服务记录）→ 链接统一软撤销、服务删除 |
| U21 | 服务编码省略时自动生成；重复编码 → 400 |
| U22 | 会话：登录 → 换设备再登录（前一个失效）→ 登出 |
| U23 | 健康检查（文件模式无 `database`；数据库模式有且可达） |
| U24 | 时间口径：`created_at` 格式一致、有效期判定不受时区影响 |

**期望**：24 个用例响应一致率 100%；差异必须登记原因，否则视为未完成。

## 6. 搬运中断与重跑

1. 在第 2 步执行到一半时按 `Ctrl+C` 中断。
2. 重新执行 `npm run migrate:mysql`。
3. **期望**：命令成功、对账通过、退出码 0；表中无重复行；源文件未被修改。

## 7. 回滚

```text
STORAGE_DRIVER=file
```

```powershell
npm run dev
```

**期望**：管理台可登录、列表与服务清单可读（原始文件未被搬运改动）。

**切换后新增数据**（回调 file 前必须导出，否则会丢）。按 `data-model.md` 必迁列清单导出：

```powershell
mysql -u <user> -p optagent -e "SELECT * FROM users WHERE created_at >= '<切换时刻>'" > users-new.tsv
mysql -u <user> -p optagent -e "SELECT * FROM register_links WHERE created_at >= '<切换时刻>'" > links-new.tsv
mysql -u <user> -p optagent -e "SELECT * FROM agent_services WHERE created_at >= '<切换时刻>'" > services-new.tsv
```

**注意**：以上文件为人工回填依据，回滚本身不自动合并；若切换后新增数据较多，优先考虑"修好数据库侧再切回"，而不是回滚。

## 8. 自动化门禁

```powershell
cd admin-backend
npm run lint; npm run typecheck; npm run test; npm run check:lines; npm run check:contract

# 前端零改动证据（SC-008）：两侧单测与构建必须仍然通过，且源码变更数为 0
cd ../frontend;           npm run test; npm run build
cd ../admin-frontend;     npm run test; npm run build
git -C .. diff --stat -- frontend admin-frontend    # 期望：无输出
```

**期望**：全部通过；数据库相关用例在没有可用数据库时打印"已跳过"后再跳过（不得静默跳过）；`git diff --stat` 对两个前端目录无输出。
