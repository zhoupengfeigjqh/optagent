# 阶段 1 数据模型：账号域功能对齐

**输入**：[spec.md](./spec.md) §需求·关键实体、[research.md](./research.md) R1/R4/R5/R6
**DDL 唯一来源**：[schema.sql](../028-account-mysql-binding/schema.sql)（本特性只做增量修订，不另建一份）

## 实体与字段

### 账号（`users`）

| 字段 | 必填 | 约束 | 说明 |
|---|---|---|---|
| `user_id` | 是 | 全局唯一，`u_` + 12 位十六进制（注册生成）或管理员手填（如 `admin`） | 登录标识之一；运行环境用户目录名 |
| `phone` | 否 | 唯一，允许空（多空不冲突） | 11 位数字；手机号登录标识 |
| `display_name` | 否 | ≤64 字符，空串等价未设置 | 展示名 |
| `role` | 是 | `admin` / `user`，缺省 `user` | 管理台准入依据 |
| `password` | 否 | scrypt 摘要对象；空 = 不可登录 | 与文件字段同名（2026-11-28 由 `password_record` 更名）；不落明文、不进响应 |
| `agents` | 是 | 字符串数组，缺省空数组 | **授权 = 关联**，唯一真相源 |
| `source_agent_code` | 否 | 引用服务编码（无数据库外键，见 R4） | 注册来源 |
| `created_at` / `updated_at` | 是 | 时间字符串 | 表侧默认值；文件无源，**不参与搬运与对账**（见必迁列清单） |

**校验规则**（领域层，两种存储共用）：手机号 `^1\d{10}$`；展示名 2–64 字符（空允许）；密码 6–128；`agents` 去重后写入。

**移除字段**：`status`（启用/禁用）—— 见 R6。

### 会话登记（`sessions`）

| 字段 | 必填 | 约束 | 说明 |
|---|---|---|---|
| `user_id` | 是 | 主键，唯一；删除账号时级联删除（R5） | 一个账号一行 |
| `session_id` | 是 | 覆盖写 | 当前唯一有效会话 |
| `issued_at` | 是 | 时间 | 签发时间（仅审计） |

### 数字人服务（`agent_services`）

| 字段 | 必填 | 约束 | 说明 |
|---|---|---|---|
| `code` | 是 | 全局唯一，`DH-` + 5 位去混淆 Base32 或导入的可读码；创建后不可改 | 注册链接、审计、来源引用键 |
| `name` | 是 | 1–128 字符 | 展示名 |
| `platform_agent_name` | 是 | 必须存在于设计态数字人 | 部署落点 |
| `status` | 是 | `enabled` / `disabled` | 停用的服务不可生成/使用链接 |
| `created_at` / `updated_at` | 是 | 时间 | 创建时间在更新时不得被改写 |

### 注册链接（`register_links`）

| 字段 | 必填 | 约束 | 说明 |
|---|---|---|---|
| `token` | 是 | 全局唯一，24 字节随机串 base64url | URL 携带 |
| `agent_code` | 是 | 引用服务编码（**无数据库外键**，见 R4），有索引 | 所属服务 |
| `expires_at` | 否 | 空 = 长期有效 | 有效期 |
| `revoked_at` | 否 | 空 = 未撤销；只写不删 | 软撤销 |
| `use_count` | 是 | 非负整数，自增（R8） | 注册次数 |
| `created_by` | 否 | 管理员标识，当前恒空（管理台鉴权后置） | 审计 |
| `created_at` | 是 | 时间；列表排序键（R9） | 创建时间 |

## 必迁列清单（搬运与对账的唯一口径）

搬运脚本、对账校验、用例断言一律引用本表，**不得在别处另写列数**。左列是文件键（搬运的读取来源），右列是表列。

**命名规则（硬约束）**：

1. 文件模式里存在的字段，在表中**必须同名同义**，不得另起别名（如 `password_record` 这类改名一律禁止）；
2. 表**允许额外列**（如 `id`、`created_at`、`updated_at`），但额外列不得表达与文件字段相冲突的语义；
3. 额外列不得被当作业务键或业务判定依据（例如 `id` 只作聚簇主键、`users.created_at` 不参与对账）。

**账号（文件键 7 个 → 表列 7 个）**

| 文件键 | 表列 | 备注 |
|---|---|---|
| `user_id` | `user_id` | 主键语义（表的自增 `id` 不参与搬运） |
| `phone` | `phone` | 缺省 = `NULL` |
| `display_name` | `display_name` | 缺省 = 空串 |
| `role` | `role` | 缺省 = `user` |
| `password` | `password` | 同名同义（MySQL **不允许**为共享字段另起别名；原 `password_record` 已改名） |
| `agents` | `agents` | 缺省 = 空数组 |
| `source_agent_code` | `source_agent_code` | 缺省 = `NULL` |

> 文件里**没有** `created_at` / `updated_at`：这两列不搬运，由表默认值填充，也不参与对账（无源可对）。

**会话（3 列）**：`user_id`、`session_id`、`issued_at`。

**数字人服务（6 列）**：`code`、`name`、`platform_agent_name`、`status`、`created_at`、`updated_at`（表自增 `id` 不搬运）。

**注册链接（7 列）**：`token`、`agent_code`、`created_by`、`expires_at`、`revoked_at`、`use_count`、`created_at`（表自增 `id` 不搬运）。

**合计 23 个业务列**（账号 7 + 会话 3 + 服务 6 + 链接 7）。对账必须逐列比较；`updated_at`（服务）、`issued_at`、`created_by` 不得因为"看起来不重要"而漏迁——这正是上一轮分析发现的口径漏洞。

**空值归一**：文件形态省略字段 ↔ 表形态 `NULL`/空串，比较前统一按"缺省 = 未设置"归一，避免把"省略"误判为差异。

## 配置版本（不随账号入库）

| 项 | 内容 |
|---|---|
| 存放 | 文件系统（设计态根目录下的版本文件），由平台存储负责读写 |
| 语义 | 账号的"新建（无版本）/改授权/删号"推进；"改密"保持；基于过期版本的写入被拒绝 |
| 为何不入库 | 版本覆盖的不只是账号（还有数字人设计态），入库会让两类数据的一致性无法收敛（research R3） |
| 本特性的义务 | 数据库模式下仍推进同一份版本，保证前端已有的冲突提示继续有效 |

## 状态迁移

```text
注册链接：有效 --过期--> 已过期 --撤销--> 已撤销（撤销优先展示）
                    \--撤销--> 已撤销
会话登记：无 --登录--> 有(session A) --再登录--> 有(session B，A 立即失效) --登出/改密/删号--> 无
账号：    不存在 --注册/新建--> 存在 --删除--> 不存在（同时撤部署、断会话）
服务：    启用 --停用--> 停用 --启用--> 启用；删除：仅当无有效链接且无用户关联
```

## 不变量

1. `agents[]` 是授权的唯一真相源；不存在独立的授权表。
2. 一个账号至多一条会话登记；后登踢前登。
3. 注册链接记录只软撤销、不物理删除（审计可追溯）。
4. 服务编码全局唯一且不可变；`platform_agent_name` 与设计态数字人一一对应（存量可能多条，删除时必须一并处理）。
5. 对外展示与库内存储统一为本地时间字符串 `YYYY-MM-DD HH:MM:SS[.mmm]`；唯一例外是会话文件的 `issued_at`（ISO/UTC，实测 `2026-11-27T12:53:55.461Z`），搬运时按本地时区转换为同一格式，转换后参与对账；该转换必须只有一个实现点，不得散落。

## 存储映射（便于对拍）

| 实体 | 文件形态 | 表形态 | 关键差异处置 |
|---|---|---|---|
| 账号 | `accounts/users/{user_id}.json` | `users` 行 | 无扩展字段时省略 vs 空串/`user` 缺省：读取时统一按"空等价未设置"归一（R6 已移除 `status`） |
| 会话 | `accounts/sessions/{user_id}.json` | `sessions` 行 | `issued_at` 文件为 ISO（UTC）、库为本地时间字符串 → 搬运时按本地时区格式化为 `YYYY-MM-DD HH:MM:SS.mmm` 后写入；对账比较**转换后**的字符串 |
| 服务 | `accounts/agent-services.json`（数组） | `agent_services` 行 | 文件按插入序；读取后按 `code` 排序（两驱动一致） |
| 链接 | `accounts/register-links.json`（数组） | `register_links` 行 | 排序统一按 `created_at` 升序 + `token`（R9） |

## 索引与外键策略

| 表 | 保留索引 | 外键 |
|---|---|---|
| `users` | `uk_users_user_id`、`uk_users_phone`、`idx_users_source` | **无**（R4） |
| `sessions` | 主键 `user_id` | `user_id → users(user_id) ON DELETE CASCADE`（R5） |
| `agent_services` | `uk_agent_services_code`、`idx_agent_services_platform` | **无** |
| `register_links` | `uk_register_links_token`、`idx_register_links_agent`、`idx_register_links_valid` | **无**（R4） |
